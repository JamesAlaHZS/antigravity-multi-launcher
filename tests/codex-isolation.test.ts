import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCodexLaunchSpec } from "../electron/main/codex-config.js";
import {
  detectLegacyCodexProfiles,
  importLegacyCodexProfiles
} from "../electron/main/legacy-import.js";
import { isWindowsCodexGuiExecutable, resolveCodexApp } from "../electron/main/paths.js";
import { createProfile, migrateProfileStorage } from "../electron/main/profile-service.js";
import { listProfiles, updateSettings } from "../electron/main/registry.js";
import { matchesUserDataDir } from "../electron/main/runtime.js";
import { getProfileSecret } from "../electron/main/secrets.js";

describe("Codex Isolation & Legacy Profile Import", () => {
  let tempHome = "";

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-launcher-test-"));
    process.env.MULTI_LAUNCHER_HOME_OVERRIDE = tempHome;
    process.env.MULTI_LAUNCHER_PLATFORM_OVERRIDE = "win32";
  });

  afterEach(async () => {
    delete process.env.MULTI_LAUNCHER_HOME_OVERRIDE;
    delete process.env.MULTI_LAUNCHER_PLATFORM_OVERRIDE;
    if (tempHome) {
      await fs.rm(tempHome, { recursive: true, force: true });
    }
  });

  it("writes isolated config.toml, auth.json, and sets CODEX_ELECTRON_USER_DATA_PATH", async () => {
    const { profile } = await createProfile({
      name: "Su8 Proxy",
      engine: "codex",
      authMode: "third_party_responses",
      inheritDefaultConfig: false,
      provider: {
        displayName: "Su8 Relay",
        baseUrl: "https://relay.example.com/v1",
        model: "gpt-5.2",
        apiKey: "sk-relay-999",
        reasoningEffort: "high"
      }
    });

    expect(profile.name).toBe("cx-Su8 Proxy");
    expect(profile.id).toBe("cx-su8-proxy");

    const toml = await fs.readFile(path.join(profile.paths.profileHome, "config.toml"), "utf8");
    expect(toml).toContain('model_provider = "proxy"');
    expect(toml).toContain('base_url = "https://relay.example.com/v1"');
    expect(toml).toContain('model_reasoning_effort = "high"');

    const secret = await getProfileSecret(profile.id);
    expect(secret).toBe("sk-relay-999");

    const spec = buildCodexLaunchSpec(profile, "C:\\Codex\\Codex.exe", secret);
    expect(spec.env.CODEX_HOME).toBe(profile.paths.profileHome);
    expect(spec.env.CODEX_ELECTRON_USER_DATA_PATH).toBe(profile.paths.userDataDir);
    expect(matchesUserDataDir(`"C:\\Codex\\Codex.exe" --user-data-dir="${profile.paths.userDataDir}"`, profile.paths.userDataDir)).toBe(true);
  });

  it("detects and non-destructively imports existing Codex Profile Manager profiles", async () => {
    const legacyDir = path.join(tempHome, "AppData", "Roaming", "Codex Profile Manager");
    const legacyHome = path.join(tempHome, ".codex-profiles", "james", "codex-home");
    const legacyUserData = path.join(tempHome, "AppData", "Roaming", "Codex Profiles", "james", "user-data");
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.mkdir(legacyHome, { recursive: true });
    await fs.mkdir(legacyUserData, { recursive: true });

    await fs.writeFile(
      path.join(legacyHome, "auth.json"),
      JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-legacy-imported" }),
      "utf8"
    );

    await fs.writeFile(
      path.join(legacyDir, "profiles.json"),
      JSON.stringify({
        schemaVersion: 1,
        profiles: [
          {
            id: "james",
            name: "James Main",
            status: "active",
            paths: {
              codexHome: legacyHome,
              userDataDir: legacyUserData
            },
            provider: {
              type: "third_party_responses",
              displayName: "Proxy",
              baseUrl: "https://api.proxy.test/v1",
              envKeyName: "CODEX_PROFILE_JAMES_API_KEY",
              model: "gpt-5.2"
            },
            auth: { mode: "api_key" }
          }
        ]
      }),
      "utf8"
    );

    const detected = await detectLegacyCodexProfiles();
    expect(detected).toHaveLength(1);
    expect(detected[0].alreadyImported).toBe(false);

    const imported = await importLegacyCodexProfiles(["james"]);
    expect(imported.importedCount).toBe(1);

    const all = await listProfiles();
    expect(
      all.some((p) => p.id === "james" && p.name === "cx-James Main" && p.paths.profileHome === legacyHome)
    ).toBe(true);
    expect(await getProfileSecret("james")).toBe("sk-legacy-imported");

    // Migrate storage to custom target drive folder and verify old directory is cleaned up
    const customDriveRoot = path.join(tempHome, "CustomDriveF", "codex-profiles");
    await updateSettings({ codexStorageRoot: customDriveRoot });
    const migrated = await migrateProfileStorage("james");
    expect(migrated.profile.paths.profileHome).toBe(
      path.join(customDriveRoot, "james", "codex-home")
    );
    expect(migrated.profile.paths.userDataDir).toBe(
      path.join(customDriveRoot, "james", "user-data")
    );
    await expect(
      fs.access(path.join(migrated.profile.paths.profileHome, "auth.json"))
    ).resolves.toBeUndefined();
    await expect(fs.access(legacyHome)).rejects.toThrow();
  });

  it("rejects the ~20KB Codex.exe updater trampoline and prefers sibling ChatGPT.exe", async () => {
    const mockAppDir = path.join(tempHome, "MockCodexApp");
    await fs.mkdir(mockAppDir, { recursive: true });
    const tinyTrampoline = path.join(mockAppDir, "Codex.exe");
    const realGuiExe = path.join(mockAppDir, "ChatGPT.exe");
    await fs.writeFile(tinyTrampoline, Buffer.alloc(20 * 1024, 0x41));
    await fs.writeFile(realGuiExe, Buffer.alloc(300 * 1024, 0x42));

    expect(isWindowsCodexGuiExecutable(tinyTrampoline)).toBe(false);
    expect(isWindowsCodexGuiExecutable(realGuiExe)).toBe(true);

    const resolvedFromStub = resolveCodexApp(tinyTrampoline);
    expect(resolvedFromStub.executablePath).toBe(realGuiExe);

    const resolvedFromDir = resolveCodexApp(mockAppDir);
    expect(resolvedFromDir.executablePath).toBe(realGuiExe);
  });
});
