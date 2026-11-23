import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAntigravityLaunchSpec } from "../electron/main/antigravity-config.js";
import {
  allocateHansDebugPort,
  ensureChineseGeminiRules,
  evaluateViaCdpWebSocket,
  extractRemoteDebuggingPort,
  findFreeLoopbackPort,
  isHansTargetPage,
  releaseHansDebugPort
} from "../electron/main/antigravity-hans.js";
import { parseElevatedAntigravityArg } from "../electron/main/windows-antigravity-elevation.js";
import type { ProfileRecord } from "../src/shared/types.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agy-hans-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  releaseHansDebugPort("prof-a");
  releaseHansDebugPort("prof-b");
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
});

function makeProfile(overrides: Partial<ProfileRecord> = {}): ProfileRecord {
  const now = new Date().toISOString();
  return {
    id: "prof-a",
    name: "Profile A",
    engine: "antigravity",
    antigravityVariant: "antigravity_app",
    status: "active",
    credentialScope: "agy-profile-prof-a",
    paths: {
      appPath: "C:\\Apps\\Antigravity\\Antigravity.exe",
      profileHome: "F:\\antigravity\\profiles\\prof-a\\home",
      userDataDir: "F:\\antigravity\\profiles\\prof-a\\user-data",
      launcherPath: "F:\\antigravity\\launchers\\prof-a.cmd"
    },
    auth: { mode: "google_account" },
    provider: {
      displayName: "Google Account",
      model: "gemini-2.5-pro",
      envKeyName: "GEMINI_API_KEY"
    },
    appearance: { iconBackgroundColor: "#4F46E5" },
    launch: {
      lastLaunchedAt: null,
      lastKnownPid: null,
      lastKnownUserDataDir: "F:\\antigravity\\profiles\\prof-a\\user-data"
    },
    timestamps: { createdAt: now, updatedAt: now },
    ...overrides
  };
}

describe("Antigravity-Hans multi-instance CDP localization", () => {
  it("injects --remote-debugging-port into launch args for both isolated and default-home profiles", () => {
    const isolatedSpec = buildAntigravityLaunchSpec(
      makeProfile(),
      "C:\\Apps\\Antigravity\\Antigravity.exe",
      null,
      { remoteDebuggingPort: 58321 }
    );
    expect(isolatedSpec.args).toContain("--user-data-dir=F:\\antigravity\\profiles\\prof-a\\user-data");
    expect(isolatedSpec.args).toContain("--remote-debugging-port=58321");

    const defaultHomeSpec = buildAntigravityLaunchSpec(
      makeProfile({ useDefaultHome: true }),
      "C:\\Apps\\Antigravity\\Antigravity.exe",
      null,
      { remoteDebuggingPort: 58323 }
    );
    expect(defaultHomeSpec.args).toContain("--remote-debugging-port=58323");
    expect(defaultHomeSpec.args.some((a) => a.startsWith("--user-data-dir="))).toBe(false);
  });

  it("allocates distinct loopback CDP ports for concurrent profiles", async () => {
    const portA = await allocateHansDebugPort("prof-a", "antigravity_app");
    const portB = await allocateHansDebugPort("prof-b", "antigravity_app");
    expect(portA).toBeGreaterThan(0);
    expect(portB).toBeGreaterThan(0);
    expect(portA).not.toBe(portB);

    const freePort = await findFreeLoopbackPort(portA, new Set([portA, portB]));
    expect(freePort).not.toBe(portA);
    expect(freePort).not.toBe(portB);
  });

  it("only matches verified local Antigravity App and IDE target pages", () => {
    expect(isHansTargetPage("http://127.0.0.1:41234/index.html", "antigravity_app")).toBe(true);
    expect(isHansTargetPage("http://localhost:3000/", "antigravity_app")).toBe(true);
    expect(isHansTargetPage("data:text/html;charset=utf-8,<html></html>", "antigravity_app")).toBe(true);
    expect(isHansTargetPage("https://evil.example.com/", "antigravity_app")).toBe(false);

    expect(
      isHansTargetPage("vscode-file://vscode-app/c:/app/workbench.html", "antigravity_ide")
    ).toBe(true);
    expect(
      isHansTargetPage("file:///Applications/Antigravity/workbench-jetski-agent.html", "antigravity_ide")
    ).toBe(true);
    expect(isHansTargetPage("http://127.0.0.1:41234/index.html", "antigravity_ide")).toBe(false);
  });

  it("idempotently ensures Simplified Chinese rules in GEMINI.md without overwriting user content", async () => {
    const dir = await makeTempDir();
    const geminiMd = path.join(dir, "GEMINI.md");

    // 1. Creates new GEMINI.md when absent
    expect(await ensureChineseGeminiRules(dir)).toBe(true);
    const created = await fs.readFile(geminiMd, "utf8");
    expect(created).toContain("简体中文");

    // 2. Idempotent when already present
    expect(await ensureChineseGeminiRules(dir)).toBe(false);

    // 3. Appends cleanly to existing custom GEMINI.md without losing content
    await fs.writeFile(geminiMd, "# My Custom Rule\n- Always write tests.\n", "utf8");
    expect(await ensureChineseGeminiRules(dir)).toBe(true);
    const merged = await fs.readFile(geminiMd, "utf8");
    expect(merged).toContain("Always write tests.");
    expect(merged).toContain("简体中文");
  });

  it("extracts valid remote debugging ports from Antigravity command lines", () => {
    expect(
      extractRemoteDebuggingPort(
        '"C:\\Apps\\Antigravity.exe" --user-data-dir=F:\\profiles\\a --remote-debugging-port=58321'
      )
    ).toBe(58321);
    expect(extractRemoteDebuggingPort('"C:\\Apps\\Antigravity.exe" --remote-debugging-port=80')).toBeNull();
    expect(extractRemoteDebuggingPort('"C:\\Apps\\Antigravity.exe" --remote-debugging-port=99999')).toBeNull();
    expect(extractRemoteDebuggingPort('"C:\\Apps\\Antigravity.exe" --user-data-dir=F:\\profiles\\a')).toBeNull();
  });

  it("parses elevated Antigravity arguments with optional CDP port", () => {
    const encoded = Buffer.from("antigravity-work-yun").toString("base64url");
    expect(
      parseElevatedAntigravityArg([
        "app.exe",
        `--elevated-antigravity-profile=${encoded}`,
        "--elevated-hans-port=58321"
      ])
    ).toEqual({
      profileId: "antigravity-work-yun",
      stop: false,
      hansPort: 58321
    });

    expect(
      parseElevatedAntigravityArg(["app.exe", `--elevated-antigravity-stop=${encoded}`])
    ).toEqual({
      profileId: "antigravity-work-yun",
      stop: true,
      hansPort: undefined
    });
  });

  it("evaluates scripts over a loopback RFC 6455 WebSocket server and rejects non-loopback hosts", async () => {
    expect(await evaluateViaCdpWebSocket("ws://example.com:9222/devtools/page/1", "1+1")).toBe(false);

    const startMockWsServer = (replyPayload: string) =>
      new Promise<{ port: number; receivedRequests: string[]; close: () => Promise<void> }>(
        (resolve) => {
          const receivedRequests: string[] = [];
          const server = net.createServer((socket) => {
            let buf: Buffer = Buffer.alloc(0);
            let upgraded = false;
            socket.on("data", (chunk: Buffer) => {
              buf = Buffer.concat([buf, chunk]);
              if (!upgraded) {
                const idx = buf.indexOf("\r\n\r\n");
                if (idx === -1) return;
                const reqHeaders = buf.subarray(0, idx).toString("utf8");
                const keyMatch = /sec-websocket-key:\s*([^\r\n]+)/i.exec(reqHeaders);
                const accept = crypto
                  .createHash("sha1")
                  .update((keyMatch?.[1]?.trim() ?? "") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
                  .digest("base64");
                socket.write(
                  [
                    "HTTP/1.1 101 Switching Protocols",
                    "Upgrade: websocket",
                    "Connection: Upgrade",
                    `Sec-WebSocket-Accept: ${accept}`,
                    "",
                    ""
                  ].join("\r\n")
                );
                upgraded = true;
                buf = buf.subarray(idx + 4);
              }

              while (buf.length >= 2) {
                const masked = (buf[1] & 0x80) !== 0;
                let len = buf[1] & 0x7f;
                let offset = 2;
                if (len === 126) {
                  if (buf.length < 4) return;
                  len = buf.readUInt16BE(2);
                  offset = 4;
                }
                const maskLen = masked ? 4 : 0;
                if (buf.length < offset + maskLen + len) return;
                const payload = Buffer.from(
                  buf.subarray(offset + maskLen, offset + maskLen + len)
                );
                if (masked) {
                  const maskKey = buf.subarray(offset, offset + 4);
                  for (let i = 0; i < payload.length; i += 1) {
                    payload[i] ^= maskKey[i & 3];
                  }
                }
                buf = buf.subarray(offset + maskLen + len);
                receivedRequests.push(payload.toString("utf8"));

                const respBuf = Buffer.from(replyPayload, "utf8");
                const respHeader =
                  respBuf.length < 126
                    ? Buffer.from([0x81, respBuf.length])
                    : Buffer.from([0x81, 126, (respBuf.length >> 8) & 0xff, respBuf.length & 0xff]);
                socket.write(Buffer.concat([respHeader, respBuf]));
              }
            });
          });
          server.listen(0, "127.0.0.1", () => {
            const addr = server.address() as net.AddressInfo;
            resolve({
              port: addr.port,
              receivedRequests,
              close: () => new Promise<void>((res) => server.close(() => res()))
            });
          });
        }
      );

    const okServer = await startMockWsServer(
      JSON.stringify({ id: 1, result: { result: { type: "undefined" } } })
    );
    try {
      const ok = await evaluateViaCdpWebSocket(
        `ws://127.0.0.1:${okServer.port}/devtools/page/test`,
        "window.__antigravityZhPatchInstalled = true;"
      );
      expect(ok).toBe(true);
      expect(okServer.receivedRequests[0]).toContain('"Runtime.evaluate"');
      expect(okServer.receivedRequests[0]).toContain("__antigravityZhPatchInstalled");
    } finally {
      await okServer.close();
    }

    const errServer = await startMockWsServer(
      JSON.stringify({ id: 1, result: { exceptionDetails: { text: "Uncaught Error" } } })
    );
    try {
      const ok = await evaluateViaCdpWebSocket(
        `ws://127.0.0.1:${errServer.port}/devtools/page/test`,
        "throw new Error('boom')"
      );
      expect(ok).toBe(false);
    } finally {
      await errServer.close();
    }
  });
});
