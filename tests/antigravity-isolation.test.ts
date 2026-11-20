import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildAntigravityLaunchSpec,
  countAntigravityConversations,
  syncAntigravityConversations
} from "../electron/main/antigravity-config.js";
import {
  createProfile,
  getProfileStats,
  listProfileBackups,
  permanentlyDeleteProfile,
  restoreProfileBackup,
  updateProfile
} from "../electron/main/profile-service.js";
import { matchesProfileProcess } from "../electron/main/runtime.js";
import { getProfileSecret } from "../electron/main/secrets.js";

describe("Antigravity Multi-Instance Isolation Engine", () => {
  let tempHome = "";

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "agy-launcher-test-"));
    process.env.MULTI_LAUNCHER_HOME_OVERRIDE = tempHome;
    process.env.MULTI_LAUNCHER_PLATFORM_OVERRIDE = "win32";

    // Seed default ~/.gemini/config & conversations + .gitconfig
    const defaultGeminiConfig = path.join(tempHome, ".gemini", "config");
    const defaultAgyData = path.join(tempHome, ".gemini", "antigravity", "conversations");
    await fs.mkdir(path.join(defaultGeminiConfig, "skills", "demo-skill"), { recursive: true });
    await fs.mkdir(defaultAgyData, { recursive: true });

    await fs.writeFile(
      path.join(defaultGeminiConfig, "mcp_config.json"),
      JSON.stringify({ mcpServers: { demo: { command: "node" } } }),
      "utf8"
    );
    await fs.writeFile(
      path.join(defaultGeminiConfig, "skills", "demo-skill", "SKILL.md"),
      "# Demo Skill\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(defaultAgyData, "conv-1.pb"),
      "sample-conv",
      "utf8"
    );
    await fs.writeFile(path.join(tempHome, ".gitconfig"), "[user]\n\tname = Tester\n", "utf8");
  });

  afterEach(async () => {
    delete process.env.MULTI_LAUNCHER_HOME_OVERRIDE;
    delete process.env.MULTI_LAUNCHER_PLATFORM_OVERRIDE;
    if (tempHome) {
      await fs.rm(tempHome, { recursive: true, force: true });
    }
  });

  it("creates isolated Antigravity 2.0 Google OAuth profile with inherited MCP/skills & conversation sync", async () => {
    const { profile, launcherPath } = await createProfile({
      name: "Work Account A",
      engine: "antigravity",
      antigravityVariant: "antigravity_app",
      authMode: "google_account",
      inheritDefaultConfig: true,
      syncHistory: { enabled: true },
      provider: {
        displayName: "Google Antigravity",
        model: "gemini-2.5-pro",
        wslDistro: "Ubuntu-24.04"
      }
    });

    expect(profile.id).toBe("work-account-a");
    expect(profile.credentialScope).toBe("agy-profile-work-account-a");
    expect(launcherPath).toContain("[AGY] Work Account A.cmd");

    // Inherited MCP config, skill, gitconfig, and conversation must exist inside isolated profileHome
    const inheritedMcp = path.join(
      profile.paths.profileHome,
      ".gemini",
      "config",
      "mcp_config.json"
    );
    const inheritedSkill = path.join(
      profile.paths.profileHome,
      ".gemini",
      "config",
      "skills",
      "demo-skill",
      "SKILL.md"
    );
    const syncedConv = path.join(
      profile.paths.profileHome,
      ".gemini",
      "antigravity",
      "conversations",
      "conv-1.pb"
    );
    const copiedGitconfig = path.join(profile.paths.profileHome, ".gitconfig");

    await expect(fs.access(inheritedMcp)).resolves.toBeUndefined();
    await expect(fs.access(inheritedSkill)).resolves.toBeUndefined();
    await expect(fs.access(syncedConv)).resolves.toBeUndefined();
    await expect(fs.access(copiedGitconfig)).resolves.toBeUndefined();

    // Verify launch spec isolates --user-data-dir, USERPROFILE/HOME, and ANTIGRAVITY_CREDENTIAL_SCOPE while preserving APPDATA
    const spec = buildAntigravityLaunchSpec(
      profile,
      "C:\\Program Files\\Antigravity\\Antigravity.exe",
      null
    );
    expect(spec.args).toContain(`--user-data-dir=${profile.paths.userDataDir}`);
    expect(spec.args).toContain("--wsl-distro=Ubuntu-24.04");
    expect(spec.env.USERPROFILE).toBe(profile.paths.profileHome);
    expect(spec.env.HOME).toBe(profile.paths.profileHome);
    expect(spec.env.ANTIGRAVITY_CREDENTIAL_SCOPE).toBe("agy-profile-work-account-a");
    expect(spec.env.SSH_CONNECTION).toBe("127.0.0.1 0 127.0.0.1 22");
    expect(spec.env.APPDATA).toBe(path.join(tempHome, "AppData", "Roaming"));
  });

  it("encrypts custom gateway API key, supports Antigravity IDE --extensions-dir, and manages config backups", async () => {
    const { profile } = await createProfile({
      name: "AGY IDE Gateway",
      engine: "antigravity",
      antigravityVariant: "antigravity_ide",
      authMode: "custom_gateway",
      inheritDefaultConfig: false,
      provider: {
        displayName: "My Gateway",
        baseUrl: "https://gateway.example.com/v1",
        model: "gemini-2.5-pro",
        apiKey: "agy-secret-token-123",
        proxyUrl: "http://127.0.0.1:7890"
      }
    });

    expect(profile.paths.extensionsDir).toBeTruthy();
    const decrypted = await getProfileSecret(profile.id);
    expect(decrypted).toBe("agy-secret-token-123");

    const spec = buildAntigravityLaunchSpec(
      profile,
      "C:\\Antigravity IDE\\Antigravity IDE.exe",
      decrypted
    );
    expect(spec.args).toContain(`--extensions-dir=${profile.paths.extensionsDir}`);
    expect(spec.env.AGY_LLM_GATEWAY_URL).toBe("https://gateway.example.com/v1");
    expect(spec.env.AGY_LLM_GATEWAY_API_KEY).toBe("agy-secret-token-123");
    expect(spec.env.HTTPS_PROXY).toBe("http://127.0.0.1:7890");

    // Updating creates a config backup that can be listed and restored
    await updateProfile({
      profileId: profile.id,
      provider: {
        displayName: "My Gateway",
        baseUrl: "https://gateway.example.com/v1",
        model: "gemini-2.5-flash"
      }
    });

    const backups = await listProfileBackups(profile.id);
    expect(backups.length).toBe(1);
    await restoreProfileBackup({ profileId: profile.id, backupPath: backups[0].backupPath });

    // Permanent delete wipes directories and encrypted secrets
    await permanentlyDeleteProfile(profile.id);
    expect(await getProfileSecret(profile.id)).toBeNull();
  });

  it("syncs SQLite WAL conversations, brain, annotations, non-sidecar projects, and merges safely", async () => {
    const defaultGemini = path.join(tempHome, ".gemini");
    const defaultAgy = path.join(defaultGemini, "antigravity");
    await fs.mkdir(path.join(defaultAgy, "brain", "conv-a"), { recursive: true });
    await fs.mkdir(path.join(defaultAgy, "annotations"), { recursive: true });
    await fs.mkdir(path.join(defaultGemini, "config", "projects"), { recursive: true });

    await fs.writeFile(path.join(defaultAgy, "conversations", "conv-a.db"), "sqlite-a", "utf8");
    await fs.writeFile(path.join(defaultAgy, "conversations", "conv-a.db-wal"), "wal-a", "utf8");
    await fs.writeFile(path.join(defaultAgy, "conversations", "conv-a.db-shm"), "shm-a", "utf8");
    await fs.writeFile(path.join(defaultAgy, "conversation_summaries.db"), "summary-src", "utf8");
    await fs.writeFile(path.join(defaultAgy, "agyhub_summaries_proto.pb"), "pb-src", "utf8");
    await fs.writeFile(path.join(defaultAgy, "brain", "conv-a", "note.md"), "# Note A", "utf8");
    await fs.writeFile(path.join(defaultAgy, "annotations", "a.json"), "{}", "utf8");
    await fs.writeFile(
      path.join(defaultGemini, "config", "projects", "outside-of-project.json"),
      JSON.stringify({ id: "outside-of-project", name: "Outside" }),
      "utf8"
    );
    await fs.writeFile(
      path.join(defaultGemini, "config", "projects", "sidecar-board.json"),
      JSON.stringify({ id: "board", sidecar: { sidecarId: "swarm/swarm_board" } }),
      "utf8"
    );

    const { profile } = await createProfile({
      name: "ALA Sync",
      engine: "antigravity",
      antigravityVariant: "antigravity_app",
      authMode: "google_account",
      inheritDefaultConfig: false,
      provider: { displayName: "Google Antigravity", model: "gemini-2.5-pro" }
    });

    // Place a stale -shm on empty target to ensure sync cleans it
    const targetAgy = path.join(profile.paths.profileHome, ".gemini", "antigravity");
    await fs.writeFile(path.join(targetAgy, "conversation_summaries.db-shm"), "stale-shm", "utf8");

    const firstSync = await syncAntigravityConversations(profile, defaultGemini, "merge");
    expect(firstSync.syncedConversations).toBe(2); // conv-1.pb + conv-a.db

    // .db and .db-wal copied, .db-shm skipped, summary copied directly on empty target
    await expect(fs.access(path.join(targetAgy, "conversations", "conv-a.db"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(targetAgy, "conversations", "conv-a.db-wal"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(targetAgy, "conversations", "conv-a.db-shm"))).rejects.toThrow();
    await expect(fs.access(path.join(targetAgy, "conversation_summaries.db"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(targetAgy, "conversation_summaries.db-shm"))).rejects.toThrow();
    await expect(fs.access(path.join(targetAgy, "brain", "conv-a", "note.md"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(targetAgy, "annotations", "a.json"))).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(profile.paths.profileHome, ".gemini", "config", "projects", "outside-of-project.json"))
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(profile.paths.profileHome, ".gemini", "config", "projects", "sidecar-board.json"))
    ).rejects.toThrow();

    // Now add a unique conversation on target AND a new conversation on source, then merge
    await fs.writeFile(path.join(targetAgy, "conversations", "target-only.db"), "sqlite-t", "utf8");
    await fs.writeFile(path.join(defaultAgy, "conversations", "conv-b.db"), "sqlite-b", "utf8");

    const mergeSync = await syncAntigravityConversations(profile, defaultGemini, "merge");
    expect(mergeSync.syncedConversations).toBe(1); // only conv-b.db
    // Both target-only.db and conv-b.db exist, and summary DB is cleared for Antigravity reconciliation
    expect(await countAntigravityConversations(path.join(profile.paths.profileHome, ".gemini"))).toBe(4);
    await expect(fs.access(path.join(targetAgy, "conversations", "target-only.db"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(targetAgy, "conversations", "conv-b.db"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(targetAgy, "conversation_summaries.db"))).rejects.toThrow();
  });

  it("supports native default Antigravity binding without clobbering or deleting ~/.gemini, and ignores orphan sidecars", async () => {
    const { profile } = await createProfile({
      name: "Primary ALA",
      engine: "antigravity",
      antigravityVariant: "antigravity_app",
      useDefaultHome: true,
      authMode: "google_account",
      inheritDefaultConfig: false,
      provider: { displayName: "Google Antigravity", model: "gemini-2.5-pro" }
    });

    expect(profile.useDefaultHome).toBe(true);
    const stats = await getProfileStats(profile.id);
    expect(stats.conversationCount).toBe(1);
    expect(stats.defaultConversationCount).toBe(1);

    const spec = buildAntigravityLaunchSpec(
      profile,
      "C:\\Program Files\\Antigravity\\Antigravity.exe",
      null
    );
    expect(spec.args.some((a) => a.startsWith("--user-data-dir="))).toBe(false);
    expect(spec.env.ANTIGRAVITY_GEMINI_DIR).toBeUndefined();
    expect(spec.env.ANTIGRAVITY_CREDENTIAL_SCOPE).toBeUndefined();

    // Process matching: matches default Antigravity, ignores isolated profiles and orphan sidecars
    expect(
      matchesProfileProcess('"C:\\Programs\\antigravity\\Antigravity.exe"', profile, {
        name: "Antigravity.exe",
        executablePath: "C:\\Programs\\antigravity\\Antigravity.exe"
      })
    ).toBe(true);
    expect(
      matchesProfileProcess(
        'C:\\Programs\\antigravity\\Antigravity.exe --user-data-dir=F:\\antigravity\\profiles\\yun\\user-data',
        profile,
        { name: "Antigravity.exe" }
      )
    ).toBe(false);
    expect(
      matchesProfileProcess(
        '"C:\\Programs\\antigravity\\Antigravity.exe" --import=file:///F:/antigravity/profiles/ala/home/.gemini/antigravity/lib/node_modules/sidecar_sdk/register_loader.js main.mjs',
        profile,
        { name: "Antigravity.exe" }
      )
    ).toBe(false);

    // Deleting a default-bound profile must NEVER delete ~/.gemini
    await permanentlyDeleteProfile(profile.id);
    await expect(
      fs.access(path.join(tempHome, ".gemini", "antigravity", "conversations", "conv-1.pb"))
    ).resolves.toBeUndefined();
  });
});
