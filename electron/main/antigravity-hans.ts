import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import type { AntigravityHansStatus, AntigravityVariant } from "../../src/shared/types.js";
import { ensureDir, pathExists, readJsonFile, writeJsonFile } from "./fs-utils.js";
import { getAppPaths } from "./paths.js";

export const ANTIGRAVITY_HANS_DEFAULT_APP_PORT = 58321;
export const ANTIGRAVITY_HANS_DEFAULT_IDE_PORT = 58322;
export const HANS_OVERLAY_SENTINEL = "__antigravityZhPatchInstalled";

const MAX_OVERLAY_BYTES = 2 * 1024 * 1024;
const HANS_RAW_BASE_URL = "https://raw.githubusercontent.com/yuexps/Antigravity-Hans/main";
const HANS_OVERLAY_FILENAME = "antigravity-hans-overlay.js";
const HANS_META_FILENAME = "meta.json";
const WS_MAGIC_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const CHINESE_GEMINI_RULE_BLOCK = `# 全局语言偏好

- 语言偏好：无论用户使用何种语言提问（除非用户明确要求其他语言），你的所有解释、回复、代码注释以及生成的文档内容，均使用**简体中文**。
`;

interface HansCacheMeta {
  version: string | null;
  updatedAt: string | null;
}

interface CdpTarget {
  id: string;
  type: string;
  title?: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

interface ActiveHansSession {
  profileId: string;
  port: number;
  variant: AntigravityVariant;
  timer: NodeJS.Timeout;
  injectedTargets: Map<string, string>;
  hasConnected: boolean;
  consecutiveMisses: number;
  polling: boolean;
}

const activeSessions = new Map<string, ActiveHansSession>();
const reservedPorts = new Map<string, number>();

export function getHansCacheDir(): string {
  return path.join(getAppPaths().appDataDir, "hans-cache");
}

function getHansOverlayPath(): string {
  return path.join(getHansCacheDir(), HANS_OVERLAY_FILENAME);
}

function getHansMetaPath(): string {
  return path.join(getHansCacheDir(), HANS_META_FILENAME);
}

function isLoopbackHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower === "localhost" || lower === "127.0.0.1" || lower === "::1" || lower === "[::1]";
}

export function extractRemoteDebuggingPort(commandLine: string): number | null {
  const match = /--remote-debugging-port=(\d{2,5})/i.exec(commandLine);
  if (!match) return null;
  const port = Number(match[1]);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : null;
}

export function isHansTargetPage(rawUrl: string, variant: AntigravityVariant): boolean {
  if (!rawUrl) return false;
  const lower = rawUrl.toLowerCase();

  if (variant === "antigravity_ide") {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.username || parsed.password) return false;
      const isLocalFile =
        parsed.protocol === "file:" &&
        (!parsed.hostname || parsed.hostname.toLowerCase() === "localhost");
      const isVscodeFile =
        parsed.protocol === "vscode-file:" && parsed.hostname.toLowerCase() === "vscode-app";
      if (!isLocalFile && !isVscodeFile) return false;
      const base = path.posix.basename(parsed.pathname).toLowerCase();
      return base === "workbench.html" || base === "workbench-jetski-agent.html";
    } catch {
      return false;
    }
  }

  if (lower.startsWith("data:text/html")) {
    return true;
  }

  try {
    const parsed = new URL(rawUrl);
    if (parsed.username || parsed.password) return false;
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      isLoopbackHost(parsed.hostname)
    );
  } catch {
    return false;
  }
}

export function isLoopbackPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => {
      resolve(false);
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

export async function findFreeLoopbackPort(
  preferredPort: number,
  excludePorts: Set<number> = new Set()
): Promise<number> {
  for (let offset = 0; offset < 64; offset += 1) {
    const candidate = preferredPort + offset;
    if (excludePorts.has(candidate)) {
      continue;
    }
    if (await isLoopbackPortFree(candidate)) {
      return candidate;
    }
  }
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : preferredPort;
      server.close(() => resolve(port));
    });
  });
}

export async function allocateHansDebugPort(
  profileId: string,
  variant: AntigravityVariant
): Promise<number> {
  const preferred =
    variant === "antigravity_ide"
      ? ANTIGRAVITY_HANS_DEFAULT_IDE_PORT
      : ANTIGRAVITY_HANS_DEFAULT_APP_PORT;
  const exclude = new Set<number>();
  for (const [id, port] of reservedPorts.entries()) {
    if (id !== profileId) exclude.add(port);
  }
  for (const [id, session] of activeSessions.entries()) {
    if (id !== profileId) exclude.add(session.port);
  }
  const port = await findFreeLoopbackPort(preferred, exclude);
  reservedPorts.set(profileId, port);
  return port;
}

export function releaseHansDebugPort(profileId: string): void {
  reservedPorts.delete(profileId);
}

export function hasActiveHansMonitor(profileId: string): boolean {
  return activeSessions.has(profileId);
}

export async function getAntigravityHansStatus(): Promise<AntigravityHansStatus> {
  const overlayPath = getHansOverlayPath();
  const installed = await pathExists(overlayPath);
  const meta = await readJsonFile<HansCacheMeta>(getHansMetaPath(), {
    version: null,
    updatedAt: null
  });
  return {
    installed,
    version: installed ? meta.version : null,
    updatedAt: installed ? meta.updatedAt : null,
    cachePath: getHansCacheDir(),
    activeSessions: activeSessions.size
  };
}

export async function downloadAntigravityHansOverlay(): Promise<AntigravityHansStatus> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const [overlayRes, versionRes] = await Promise.all([
      fetch(`${HANS_RAW_BASE_URL}/${HANS_OVERLAY_FILENAME}`, {
        signal: controller.signal,
        headers: { "User-Agent": "Antigravity-Multi-Launcher" }
      }),
      fetch(`${HANS_RAW_BASE_URL}/VERSION`, {
        signal: controller.signal,
        headers: { "User-Agent": "Antigravity-Multi-Launcher" }
      }).catch(() => null)
    ]);

    if (!overlayRes.ok) {
      throw new Error(`下载 Antigravity-Hans 汉化脚本失败 (HTTP ${overlayRes.status})`);
    }

    const overlayJs = await overlayRes.text();
    const byteLength = Buffer.byteLength(overlayJs, "utf8");
    if (byteLength > MAX_OVERLAY_BYTES) {
      throw new Error(`汉化脚本体积异常 (${byteLength} 字节)，已拒绝保存`);
    }
    if (!overlayJs.includes(HANS_OVERLAY_SENTINEL)) {
      throw new Error("下载的脚本缺少 Antigravity-Hans 校验标记，已拒绝保存");
    }

    let version: string | null = null;
    if (versionRes && versionRes.ok) {
      const rawVer = (await versionRes.text()).trim();
      if (rawVer) {
        version = rawVer.startsWith("v") ? rawVer : `v${rawVer}`;
      }
    }

    const cacheDir = getHansCacheDir();
    await ensureDir(cacheDir);
    await fs.writeFile(getHansOverlayPath(), overlayJs, "utf8");
    await writeJsonFile<HansCacheMeta>(getHansMetaPath(), {
      version,
      updatedAt: new Date().toISOString()
    });

    return getAntigravityHansStatus();
  } finally {
    clearTimeout(timeout);
  }
}

export async function ensureHansOverlaySource(): Promise<string | null> {
  const overlayPath = getHansOverlayPath();
  if (!(await pathExists(overlayPath))) {
    try {
      await downloadAntigravityHansOverlay();
    } catch {
      return null;
    }
  }
  try {
    const source = await fs.readFile(overlayPath, "utf8");
    if (
      Buffer.byteLength(source, "utf8") <= MAX_OVERLAY_BYTES &&
      source.includes(HANS_OVERLAY_SENTINEL)
    ) {
      return source;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchCdpTargets(port: number): Promise<CdpTarget[] | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json`, {
      signal: controller.signal
    });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? (data as CdpTarget[]) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function encodeClientWsFrame(opcode: number, payload: Buffer): Buffer {
  const mask = crypto.randomBytes(4);
  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | payload.length;
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  const masked = Buffer.allocUnsafe(payload.length);
  for (let i = 0; i < payload.length; i += 1) {
    masked[i] = payload[i] ^ mask[i & 3];
  }
  return Buffer.concat([header, mask, masked]);
}

/**
 * Minimal zero-dependency RFC 6455 loopback WebSocket client for CDP Runtime.evaluate.
 * Works across all Node.js / Electron versions (including Electron 34 / Node 20 without global WebSocket).
 */
export async function evaluateViaCdpWebSocket(
  wsUrl: string,
  expression: string
): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(wsUrl);
    if (parsed.protocol !== "ws:" || !isLoopbackHost(parsed.hostname)) {
      return false;
    }
  } catch {
    return false;
  }

  const port = Number(parsed.port || 80);
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  const key = crypto.randomBytes(16).toString("base64");
  const expectedAccept = crypto
    .createHash("sha1")
    .update(key + WS_MAGIC_GUID)
    .digest("base64");

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let handshakeDone = false;
    let buffer: Buffer = Buffer.alloc(0);
    let fragmentedChunks: Buffer[] = [];
    let fragmentedOpcode = 0;

    const socket = net.connect(port, host);
    const timer = setTimeout(() => finish(false), 6000);

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.end();
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(ok);
    };

    const handleTextMessage = (text: string) => {
      try {
        const msg = JSON.parse(text) as {
          id?: number;
          error?: unknown;
          result?: { exceptionDetails?: unknown };
        };
        if (msg.id === 1) {
          finish(!msg.error && !msg.result?.exceptionDetails);
        }
      } catch {
        // ignore non-JSON or unrelated frames
      }
    };

    socket.on("connect", () => {
      const request = [
        `GET ${parsed.pathname}${parsed.search} HTTP/1.1`,
        `Host: ${parsed.host}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
        "",
        ""
      ].join("\r\n");
      socket.write(request);
    });

    socket.on("data", (chunk: Buffer) => {
      if (settled) return;
      buffer = Buffer.concat([buffer, chunk]);

      if (!handshakeDone) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        const headerText = buffer.subarray(0, headerEnd).toString("utf8");
        const statusLine = headerText.split("\r\n")[0] ?? "";
        const acceptMatch = /sec-websocket-accept:\s*([^\r\n]+)/i.exec(headerText);
        if (!statusLine.includes(" 101 ") || acceptMatch?.[1]?.trim() !== expectedAccept) {
          finish(false);
          return;
        }
        handshakeDone = true;
        buffer = buffer.subarray(headerEnd + 4);

        const payload = Buffer.from(
          JSON.stringify({
            id: 1,
            method: "Runtime.evaluate",
            params: {
              expression,
              silent: true
            }
          }),
          "utf8"
        );
        socket.write(encodeClientWsFrame(0x1, payload));
      }

      while (buffer.length >= 2 && !settled) {
        const fin = (buffer[0] & 0x80) !== 0;
        const opcode = buffer[0] & 0x0f;
        const masked = (buffer[1] & 0x80) !== 0;
        let payloadLen = buffer[1] & 0x7f;
        let offset = 2;

        if (payloadLen === 126) {
          if (buffer.length < 4) return;
          payloadLen = buffer.readUInt16BE(2);
          offset = 4;
        } else if (payloadLen === 127) {
          if (buffer.length < 10) return;
          payloadLen = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }

        const maskLen = masked ? 4 : 0;
        if (buffer.length < offset + maskLen + payloadLen) return;

        let payload = buffer.subarray(offset + maskLen, offset + maskLen + payloadLen);
        if (masked) {
          const maskKey = buffer.subarray(offset, offset + 4);
          const unmasked = Buffer.allocUnsafe(payload.length);
          for (let i = 0; i < payload.length; i += 1) {
            unmasked[i] = payload[i] ^ maskKey[i & 3];
          }
          payload = unmasked;
        }
        buffer = buffer.subarray(offset + maskLen + payloadLen);

        if (opcode === 0x8) {
          finish(false);
          return;
        }
        if (opcode === 0x9) {
          socket.write(encodeClientWsFrame(0xa, payload));
          continue;
        }
        if (opcode === 0xa) {
          continue;
        }
        if (opcode === 0x1 || opcode === 0x2) {
          if (fin) {
            if (opcode === 0x1) {
              handleTextMessage(payload.toString("utf8"));
            }
          } else {
            fragmentedOpcode = opcode;
            fragmentedChunks = [payload];
          }
        } else if (opcode === 0x0 && fragmentedOpcode !== 0) {
          fragmentedChunks.push(payload);
          if (fin) {
            if (fragmentedOpcode === 0x1) {
              handleTextMessage(Buffer.concat(fragmentedChunks).toString("utf8"));
            }
            fragmentedChunks = [];
            fragmentedOpcode = 0;
          }
        }
      }
    });

    socket.on("error", () => finish(false));
    socket.on("close", () => finish(false));
  });
}

export function stopProfileHansMonitor(profileId: string): void {
  const existing = activeSessions.get(profileId);
  if (existing) {
    clearInterval(existing.timer);
    activeSessions.delete(profileId);
  }
  reservedPorts.delete(profileId);
}

export function stopAllHansMonitors(): void {
  for (const profileId of Array.from(activeSessions.keys())) {
    stopProfileHansMonitor(profileId);
  }
}

export async function startProfileHansMonitor(
  profileId: string,
  port: number,
  variant: AntigravityVariant
): Promise<boolean> {
  const overlayJs = await ensureHansOverlaySource();
  if (!overlayJs) {
    releaseHansDebugPort(profileId);
    return false;
  }

  stopProfileHansMonitor(profileId);
  reservedPorts.set(profileId, port);

  const session: ActiveHansSession = {
    profileId,
    port,
    variant,
    timer: setInterval(() => {
      void pollSession();
    }, 1500),
    injectedTargets: new Map<string, string>(),
    hasConnected: false,
    consecutiveMisses: 0,
    polling: false
  };

  const pollSession = async () => {
    if (session.polling || !activeSessions.has(profileId)) return;
    session.polling = true;
    try {
      const targets = await fetchCdpTargets(port);
      if (!targets) {
        session.consecutiveMisses += 1;
        const maxMisses = session.hasConnected ? 10 : 30;
        if (session.consecutiveMisses >= maxMisses) {
          stopProfileHansMonitor(profileId);
        }
        return;
      }

      session.hasConnected = true;
      session.consecutiveMisses = 0;

      const liveIds = new Set<string>();
      for (const target of targets) {
        if (!target.id || !target.webSocketDebuggerUrl) continue;
        liveIds.add(target.id);
        if (!isHansTargetPage(target.url, variant)) continue;

        const prevUrl = session.injectedTargets.get(target.id);
        if (prevUrl === target.url) continue;

        const ok = await evaluateViaCdpWebSocket(target.webSocketDebuggerUrl, overlayJs);
        if (ok) {
          session.injectedTargets.set(target.id, target.url);
        }
      }

      for (const id of Array.from(session.injectedTargets.keys())) {
        if (!liveIds.has(id)) {
          session.injectedTargets.delete(id);
        }
      }
    } finally {
      session.polling = false;
    }
  };

  activeSessions.set(profileId, session);
  void pollSession();
  return true;
}

export async function ensureChineseGeminiRules(geminiDir: string): Promise<boolean> {
  await ensureDir(geminiDir);
  const geminiMdPath = path.join(geminiDir, "GEMINI.md");
  if (await pathExists(geminiMdPath)) {
    const existing = await fs.readFile(geminiMdPath, "utf8");
    if (/简体中文|Simplified Chinese/i.test(existing)) {
      return false;
    }
    const separator = existing.endsWith("\n") ? "\n" : "\n\n";
    await fs.writeFile(geminiMdPath, `${existing}${separator}${CHINESE_GEMINI_RULE_BLOCK}`, "utf8");
    return true;
  }

  await fs.writeFile(geminiMdPath, CHINESE_GEMINI_RULE_BLOCK, "utf8");
  return true;
}
