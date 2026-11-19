import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createRequire } from "node:module";
import { pathExists } from "./fs-utils.js";
import {
  APP_NAME,
  findWindowsCodexAppxDesktopApp,
  getAppPaths,
  getRuntimePlatform,
  isWindowsCodexGuiExecutable,
  type WindowsAppxInfo
} from "./paths.js";

const require = createRequire(import.meta.url);

export interface CachedWindowsAppx extends WindowsAppxInfo {
  cachedAppPath: string;
  cachedExecutablePath: string;
}

function getNativeFs(): typeof fs {
  try {
    const originalFs = require("original-fs") as typeof fs;
    if (typeof originalFs?.promises?.stat === "function") {
      return originalFs;
    }
  } catch {
    // Running outside Electron (e.g., vitest)
  }
  return fs;
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_");
}

async function resolveValidCachedGuiExecutable(
  cachedAppPath: string,
  preferredExeName: string,
  nativeFs: typeof fs
): Promise<string | null> {
  try {
    const [appStat, asarStat] = await Promise.all([
      nativeFs.promises.stat(cachedAppPath),
      nativeFs.promises.stat(path.join(cachedAppPath, "resources", "app.asar"))
    ]);
    if (!appStat.isDirectory() || !asarStat.isFile()) {
      return null;
    }

    // Always prefer ChatGPT.exe (4.4MB Electron binary) over Codex.exe (~20KB updater trampoline)
    const exeCandidates = Array.from(
      new Set(["ChatGPT.exe", preferredExeName, "Codex.exe"].filter(Boolean))
    );
    for (const exeName of exeCandidates) {
      const exePath = path.join(cachedAppPath, exeName);
      try {
        const exeStat = await nativeFs.promises.stat(exePath);
        if (exeStat.isFile() && isWindowsCodexGuiExecutable(exePath)) {
          return exePath;
        }
      } catch {
        // try next
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Copies a WindowsApps directory using ReadStream -> WriteStream instead of Win32 CopyFileEx (`fs.cp`),
 * because `CopyFileEx` fails with `UNKNOWN` across volumes (e.g. C:\Program Files\WindowsApps -> F:\)
 * on NTFS WOF-projected Store package files.
 */
async function copyDirectoryWithStreams(
  srcDir: string,
  dstDir: string,
  nativeFs: typeof fs,
  concurrency = 8
): Promise<void> {
  const filesToCopy: Array<{ src: string; dst: string }> = [];

  async function collect(curSrc: string, curDst: string): Promise<void> {
    await nativeFs.promises.mkdir(curDst, { recursive: true });
    const entries = await nativeFs.promises.readdir(curSrc, { withFileTypes: true });
    for (const entry of entries) {
      const s = path.join(curSrc, entry.name);
      const d = path.join(curDst, entry.name);
      if (entry.isDirectory()) {
        await collect(s, d);
      } else if (entry.isFile()) {
        filesToCopy.push({ src: s, dst: d });
      }
    }
  }

  await collect(srcDir, dstDir);

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < filesToCopy.length) {
      const item = filesToCopy[cursor++];
      await pipeline(
        nativeFs.createReadStream(item.src, { highWaterMark: 1024 * 1024 }),
        nativeFs.createWriteStream(item.dst, { highWaterMark: 1024 * 1024 })
      );
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, filesToCopy.length)) }, () =>
    worker()
  );
  await Promise.all(workers);
}

export async function ensureWindowsAppxDesktopCache(): Promise<CachedWindowsAppx | null> {
  if (getRuntimePlatform() !== "win32") {
    return null;
  }
  const appx = findWindowsCodexAppxDesktopApp();
  if (!appx) {
    return null;
  }

  const nativeFs = getNativeFs();
  const appPaths = getAppPaths();
  const exeBaseName = path.basename(appx.executablePath);

  // Prefer non-C drive appDataDir\WindowsAppsCache when appDataDir is on F: drive, plus reuse existing cache
  const candidateRoots = [
    path.join(appPaths.appDataDir, "WindowsAppsCache"),
    path.join(appPaths.localAppData, APP_NAME, "WindowsAppsCache"),
    path.join(appPaths.localAppData, "Codex Profile Manager", "WindowsAppsCache")
  ];

  // 1. Check for exact version match across candidate cache roots
  for (const root of candidateRoots) {
    const exactDir = path.join(root, safeSegment(appx.packageFullName), "app");
    const exactExe = await resolveValidCachedGuiExecutable(exactDir, exeBaseName, nativeFs);
    if (exactExe) {
      return {
        ...appx,
        cachedAppPath: exactDir,
        cachedExecutablePath: exactExe
      };
    }
  }

  // 2. Extract fresh copy into our cache root (on F: drive when available) using stream-based copy
  const targetRoot = candidateRoots[0];
  const cachedAppPath = path.join(targetRoot, safeSegment(appx.packageFullName), "app");
  const sourceAppDir = path.dirname(appx.executablePath);
  const tempPath = `${cachedAppPath}.tmp-${Date.now()}`;

  await nativeFs.promises.rm(tempPath, { recursive: true, force: true }).catch(() => undefined);
  await nativeFs.promises.mkdir(path.dirname(tempPath), { recursive: true });

  try {
    await copyDirectoryWithStreams(sourceAppDir, tempPath, nativeFs);
    await nativeFs.promises.rm(cachedAppPath, { recursive: true, force: true }).catch(() => undefined);
    await nativeFs.promises.rename(tempPath, cachedAppPath);
    const extractedExe = await resolveValidCachedGuiExecutable(cachedAppPath, exeBaseName, nativeFs);
    if (!extractedExe) {
      throw new Error(`Extracted WindowsApps cache did not contain a valid GUI executable in ${cachedAppPath}`);
    }
    return {
      ...appx,
      cachedAppPath,
      cachedExecutablePath: extractedExe
    };
  } catch (err) {
    await nativeFs.promises.rm(tempPath, { recursive: true, force: true }).catch(() => undefined);
    // 3. Fallback to any compatible valid older cached version across candidate roots
    for (const root of candidateRoots) {
      if (!(await pathExists(root))) continue;
      const entries = await nativeFs.promises.readdir(root, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))) {
        if (!entry.isDirectory() || !entry.name.startsWith(`${appx.packageName}_`)) continue;
        const fallbackDir = path.join(root, entry.name, "app");
        const fallbackExe = await resolveValidCachedGuiExecutable(fallbackDir, exeBaseName, nativeFs);
        if (fallbackExe) {
          return {
            ...appx,
            cachedAppPath: fallbackDir,
            cachedExecutablePath: fallbackExe
          };
        }
      }
    }
    throw err;
  }
}
