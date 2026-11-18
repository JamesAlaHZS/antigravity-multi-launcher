import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathExists } from "./fs-utils.js";
import {
  APP_NAME,
  findWindowsCodexAppxDesktopApp,
  getAppPaths,
  getRuntimePlatform,
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
    if (typeof originalFs?.promises?.cp === "function") {
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

async function isValidCachedApp(
  cachedAppPath: string,
  cachedExecutablePath: string,
  nativeFs: typeof fs
): Promise<boolean> {
  try {
    const [appStat, exeStat, asarStat] = await Promise.all([
      nativeFs.promises.stat(cachedAppPath),
      nativeFs.promises.stat(cachedExecutablePath),
      nativeFs.promises.stat(path.join(cachedAppPath, "resources", "app.asar"))
    ]);
    return appStat.isDirectory() && exeStat.isFile() && asarStat.isFile();
  } catch {
    return false;
  }
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
  const localAppData = getAppPaths().localAppData;
  const exeBaseName = path.basename(appx.executablePath);

  // Check both our own cache root and any existing Codex Profile Manager cache root to avoid 300MB duplicate copy
  const candidateRoots = [
    path.join(localAppData, APP_NAME, "WindowsAppsCache"),
    path.join(localAppData, "Codex Profile Manager", "WindowsAppsCache")
  ];

  for (const root of candidateRoots) {
    const exactDir = path.join(root, safeSegment(appx.packageFullName), "app");
    const exactExe = path.join(exactDir, exeBaseName);
    if (await isValidCachedApp(exactDir, exactExe, nativeFs)) {
      return {
        ...appx,
        cachedAppPath: exactDir,
        cachedExecutablePath: exactExe
      };
    }
  }

  // Extract fresh copy into our cache root
  const targetRoot = candidateRoots[0];
  const cachedAppPath = path.join(targetRoot, safeSegment(appx.packageFullName), "app");
  const cachedExecutablePath = path.join(cachedAppPath, exeBaseName);
  const sourceAppDir = path.dirname(appx.executablePath);
  const tempPath = `${cachedAppPath}.tmp-${Date.now()}`;

  await nativeFs.promises.rm(tempPath, { recursive: true, force: true }).catch(() => undefined);
  await nativeFs.promises.mkdir(path.dirname(tempPath), { recursive: true });

  try {
    await nativeFs.promises.cp(sourceAppDir, tempPath, {
      recursive: true,
      force: true,
      errorOnExist: false
    });
    await nativeFs.promises.rm(cachedAppPath, { recursive: true, force: true }).catch(() => undefined);
    await nativeFs.promises.rename(tempPath, cachedAppPath);
    return {
      ...appx,
      cachedAppPath,
      cachedExecutablePath
    };
  } catch (err) {
    await nativeFs.promises.rm(tempPath, { recursive: true, force: true }).catch(() => undefined);
    // Fallback to any compatible older cached version across candidate roots
    for (const root of candidateRoots) {
      if (!(await pathExists(root))) continue;
      const entries = await nativeFs.promises.readdir(root, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => b.name.localeCompare(a.name))) {
        if (!entry.isDirectory() || !entry.name.startsWith(`${appx.packageName}_`)) continue;
        const fallbackDir = path.join(root, entry.name, "app");
        const fallbackExe = path.join(fallbackDir, exeBaseName);
        if (await isValidCachedApp(fallbackDir, fallbackExe, nativeFs)) {
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
