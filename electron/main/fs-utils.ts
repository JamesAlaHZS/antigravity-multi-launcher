import fs from "node:fs/promises";
import nodeFs from "node:fs";
import path from "node:path";

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function fileExistsSync(targetPath: string): boolean {
  try {
    return nodeFs.existsSync(targetPath);
  } catch {
    return false;
  }
}

export async function isWritableDirectory(dirPath: string): Promise<boolean> {
  try {
    await ensureDir(dirPath);
    const probe = path.join(dirPath, `.write-probe-${process.pid}-${Date.now()}`);
    await fs.writeFile(probe, "ok", "utf8");
    await fs.unlink(probe).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return structuredClone(fallback);
  }
}

export async function writeJsonFile<T>(filePath: string, data: T): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    await fs.rename(tmpPath, filePath);
  } catch {
    await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.unlink(tmpPath).catch(() => undefined);
  }
}

export async function copyEntryIfExists(src: string, dst: string): Promise<boolean> {
  if (!(await pathExists(src))) {
    return false;
  }
  await ensureDir(path.dirname(dst));
  const stat = await fs.lstat(src);
  if (stat.isSymbolicLink()) {
    const realSrc = await fs.realpath(src).catch(() => null);
    if (!realSrc) {
      return false;
    }
    await fs.cp(realSrc, dst, { recursive: true, force: true });
    return true;
  }
  await fs.cp(src, dst, { recursive: true, force: true });
  return true;
}

export async function ensureDirectoryLinkOrCopy(srcDir: string, dstDir: string): Promise<void> {
  if (!(await pathExists(srcDir)) || (await pathExists(dstDir))) {
    return;
  }
  await ensureDir(path.dirname(dstDir));
  const linkType = process.platform === "win32" ? "junction" : "dir";
  try {
    await fs.symlink(srcDir, dstDir, linkType);
  } catch {
    await fs.cp(srcDir, dstDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
