import fs from "node:fs/promises";
import path from "node:path";

const src = path.resolve("electron/preload/index.cjs");
const dstDir = path.resolve("dist-electron/electron/preload");
await fs.mkdir(dstDir, { recursive: true });
await fs.copyFile(src, path.join(dstDir, "index.cjs"));
console.log("Copied electron/preload/index.cjs -> dist-electron/electron/preload/index.cjs");
