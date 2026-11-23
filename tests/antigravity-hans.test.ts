import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAntigravityLaunchSpec } from "../electron/main/antigravity-config.js";
import {
  allocateHansDebugPort,
  ensureChineseGeminiRules,
  findFreeLoopbackPort,
  isHansTargetPage,
  releaseHansDebugPort
} from "../electron/main/antigravity-hans.js";
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
});
