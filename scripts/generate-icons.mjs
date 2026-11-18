import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = process.cwd();
const ASSETS_DIR = path.join(ROOT, "assets");

const SVG_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="none">
  <defs>
    <linearGradient id="bg" x1="20" y1="16" x2="236" y2="240" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#2563EB"/>
      <stop offset="52%" stop-color="#4F46E5"/>
      <stop offset="100%" stop-color="#0EA5E9"/>
    </linearGradient>
    <linearGradient id="orb" x1="64" y1="64" x2="192" y2="192" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.98"/>
      <stop offset="100%" stop-color="#E0E7FF" stop-opacity="0.9"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="224" height="224" rx="54" fill="url(#bg)"/>
  <circle cx="106" cy="112" r="42" stroke="url(#orb)" stroke-width="14"/>
  <circle cx="154" cy="146" r="42" stroke="#38BDF8" stroke-width="14" stroke-opacity="0.92"/>
  <path d="M128 58L142 94L178 108L142 122L128 158L114 122L78 108L114 94L128 58Z" fill="#FFFFFF"/>
</svg>
`;

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function renderIconPng(size = 256) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const pad = size * 0.0625;
  const radius = size * 0.21;
  const innerSize = size - pad * 2;

  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter None
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 4;
      // Rounded rect SDF
      const qx = Math.abs(x - size / 2) - (innerSize / 2 - radius);
      const qy = Math.abs(y - size / 2) - (innerSize / 2 - radius);
      const dist =
        Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
        Math.min(Math.max(qx, qy), 0) -
        radius;

      if (dist > 1.0) {
        raw[px] = 0;
        raw[px + 1] = 0;
        raw[px + 2] = 0;
        raw[px + 3] = 0;
        continue;
      }

      const edgeAlpha = dist > 0 ? Math.round((1 - dist) * 255) : 255;
      const t = (x + y) / (2 * size);
      let r = Math.round(37 * (1 - t) + 14 * t);
      let g = Math.round(99 * (1 - t) + 165 * t);
      let b = Math.round(235 * (1 - t) + 233 * t);

      // Ring 1 (Antigravity orbit)
      const d1 = Math.abs(Math.hypot(x - size * 0.42, y - size * 0.44) - size * 0.165);
      // Ring 2 (Codex orbit)
      const d2 = Math.abs(Math.hypot(x - size * 0.59, y - size * 0.57) - size * 0.165);
      // Center 4-point spark
      const sx = Math.abs(x - size * 0.5) / (size * 0.17);
      const sy = Math.abs(y - size * 0.43) / (size * 0.17);
      const spark = Math.pow(sx, 0.65) + Math.pow(sy, 0.65);

      if (spark <= 1.0) {
        const blend = Math.min(1, (1.0 - spark) * 4);
        r = Math.round(r * (1 - blend) + 255 * blend);
        g = Math.round(g * (1 - blend) + 255 * blend);
        b = Math.round(b * (1 - blend) + 255 * blend);
      } else if (d1 < size * 0.028) {
        const blend = Math.min(1, (size * 0.028 - d1) / (size * 0.01));
        r = Math.round(r * (1 - blend) + 245 * blend);
        g = Math.round(g * (1 - blend) + 248 * blend);
        b = Math.round(b * (1 - blend) + 255 * blend);
      } else if (d2 < size * 0.028) {
        const blend = Math.min(1, (size * 0.028 - d2) / (size * 0.01));
        r = Math.round(r * (1 - blend) + 125 * blend);
        g = Math.round(g * (1 - blend) + 211 * blend);
        b = Math.round(b * (1 - blend) + 252 * blend);
      }

      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
      raw[px + 3] = edgeAlpha;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

await fs.mkdir(ASSETS_DIR, { recursive: true });
await fs.writeFile(path.join(ASSETS_DIR, "icon.svg"), SVG_ICON, "utf8");
await fs.writeFile(path.join(ASSETS_DIR, "icon.png"), renderIconPng(256));
console.log("Generated assets/icon.svg and assets/icon.png (256x256)");
