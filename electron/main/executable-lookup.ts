import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileExistsSync } from "./fs-utils.js";
import { getRuntimePlatform } from "./paths.js";

const execFileAsync = promisify(execFile);

export interface ExecutableLookupResult {
  path: string | null;
  version: string | null;
}

export async function findExecutable(name: string): Promise<ExecutableLookupResult> {
  const platform = getRuntimePlatform();
  const extensions = platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  const pathDirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);

  let resolvedPath: string | null = null;
  for (const dir of pathDirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, name.endsWith(ext) ? name : `${name}${ext}`);
      if (fileExistsSync(candidate)) {
        resolvedPath = candidate;
        break;
      }
    }
    if (resolvedPath) {
      break;
    }
  }

  if (!resolvedPath) {
    return { path: null, version: null };
  }

  try {
    const isCmd = platform === "win32" && /\.(cmd|bat)$/i.test(resolvedPath);
    const { stdout, stderr } = isCmd
      ? await execFileAsync("cmd.exe", ["/c", resolvedPath, "--version"], { timeout: 4000 })
      : await execFileAsync(resolvedPath, ["--version"], { timeout: 4000 });
    const firstLine = `${stdout || stderr}`.trim().split(/\r?\n/)[0]?.trim() || null;
    return { path: resolvedPath, version: firstLine };
  } catch {
    return { path: resolvedPath, version: null };
  }
}

export async function listWslDistros(): Promise<string[]> {
  if (getRuntimePlatform() !== "win32") {
    return [];
  }
  try {
    const { stdout } = await execFileAsync("wsl.exe", ["-l", "-q"], {
      timeout: 4000,
      encoding: "buffer"
    });
    // wsl.exe outputs UTF-16LE on Windows
    const decoded =
      stdout.includes(0x00) ? stdout.toString("utf16le") : stdout.toString("utf8");
    return decoded
      .split(/\r?\n/)
      .map((line) => line.replace(/\0/g, "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}
