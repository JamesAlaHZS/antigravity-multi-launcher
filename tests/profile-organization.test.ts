import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getProfileAvatarLabel,
  normalizeProfileName,
  sortProfiles,
  stripEnginePrefix,
  switchEnginePrefix
} from "../src/shared/profile-utils.js";
import type { ProfileRecord } from "../src/shared/types.js";
import { getAppPaths, launcherFileName } from "../electron/main/paths.js";
import {
  createProfile,
  rebuildProfileLauncher,
  softDeleteProfile,
  updateProfile
} from "../electron/main/profile-service.js";
import { listProfiles, loadRegistry } from "../electron/main/registry.js";

function makeStubProfile(
  id: string,
  name: string,
  engine: "antigravity" | "codex",
  status: "active" | "deleted" = "active"
): ProfileRecord {
  const now = "2026-11-25T00:00:00.000Z";
  return {
    id,
    name,
    engine,
    ...(engine === "antigravity" ? { antigravityVariant: "antigravity_app" as const } : {}),
    status,
    paths: {
      appPath: engine === "antigravity" ? "C:\\Apps\\Antigravity.exe" : "C:\\Apps\\ChatGPT.exe",
      profileHome: `C:\\profiles\\${id}\\home`,
      userDataDir: `C:\\profiles\\${id}\\user-data`,
      launcherPath: `C:\\launchers\\${id}.cmd`
    },
    auth: {
      mode: engine === "antigravity" ? "google_account" : "chatgpt_account"
    },
    provider: {
      displayName: engine === "antigravity" ? "Google Antigravity" : "OpenAI",
      model: engine === "antigravity" ? "gemini-2.5-pro" : "gpt-5.2",
      envKeyName: engine === "antigravity" ? "GEMINI_API_KEY" : "OPENAI_API_KEY",
      reasoningEffort: "medium"
    },
    appearance: {
      iconBackgroundColor: engine === "antigravity" ? "#4F46E5" : "#10B981"
    },
    launch: {
      lastLaunchedAt: null,
      lastKnownPid: null,
      lastKnownUserDataDir: `C:\\profiles\\${id}\\user-data`
    },
    timestamps: {
      createdAt: now,
      updatedAt: now
    }
  };
}

describe("Profile prefix normalization and engine ordering", () => {
  let tempHome = "";

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "agy-org-test-"));
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

  it("normalizes anti- and cx- prefixes idempotently without duplicating prefixes", () => {
    expect(normalizeProfileName("ALA", "antigravity")).toBe("anti-ALA");
    expect(normalizeProfileName("YUN-ALA", "antigravity")).toBe("anti-YUN-ALA");
    expect(normalizeProfileName("anti-ALA", "antigravity")).toBe("anti-ALA");
    expect(normalizeProfileName("ANTI_work", "antigravity")).toBe("anti-work");
    expect(normalizeProfileName("anti  James168", "antigravity")).toBe("anti-James168");
    expect(normalizeProfileName("Antigravity Work", "antigravity")).toBe("anti-Antigravity Work");
    expect(normalizeProfileName("anti", "antigravity")).toBe("anti");

    expect(normalizeProfileName("yun", "codex")).toBe("cx-yun");
    expect(normalizeProfileName("AY", "codex")).toBe("cx-AY");
    expect(normalizeProfileName("cx-yun", "codex")).toBe("cx-yun");
    expect(normalizeProfileName("CX_ala", "codex")).toBe("cx-ala");
    expect(normalizeProfileName("cx  james", "codex")).toBe("cx-james");
    expect(normalizeProfileName("cx", "codex")).toBe("cx");
    expect(normalizeProfileName("   ", "codex")).toBe("");
  });

  it("strips and switches prefixes cleanly and computes distinct avatar labels", () => {
    expect(stripEnginePrefix("anti-YUN-ALA", "antigravity")).toBe("YUN-ALA");
    expect(stripEnginePrefix("cx-yun", "codex")).toBe("yun");
    expect(stripEnginePrefix("Antigravity Work", "antigravity")).toBe("Antigravity Work");

    expect(switchEnginePrefix("anti-Work", "codex")).toBe("cx-Work");
    expect(switchEnginePrefix("cx-Work", "antigravity")).toBe("anti-Work");
    expect(switchEnginePrefix("plain-name", "codex")).toBe("plain-name");

    expect(getProfileAvatarLabel({ name: "cx-yun", engine: "codex" })).toBe("Y");
    expect(getProfileAvatarLabel({ name: "anti-James168", engine: "antigravity" })).toBe("J");
    expect(getProfileAvatarLabel({ name: "anti-ALA", engine: "antigravity" })).toBe("A");
  });

  it("sorts Antigravity profiles before Codex profiles, active before deleted, and naturally by name", () => {
    const unsorted = [
      makeStubProfile("codex-10", "cx-acc10", "codex"),
      makeStubProfile("agy-del", "anti-AAA", "antigravity", "deleted"),
      makeStubProfile("codex-2", "cx-acc2", "codex"),
      makeStubProfile("agy-yun", "anti-YUN-ALA", "antigravity"),
      makeStubProfile("codex-ay", "cx-AY", "codex"),
      makeStubProfile("agy-ala", "anti-ALA", "antigravity"),
      makeStubProfile("agy-james", "anti-James168", "antigravity")
    ];

    const sorted = sortProfiles(unsorted);
    expect(sorted.map((p) => `${p.engine}:${p.status}:${p.name}`)).toEqual([
      "antigravity:active:anti-ALA",
      "antigravity:active:anti-James168",
      "antigravity:active:anti-YUN-ALA",
      "antigravity:deleted:anti-AAA",
      "codex:active:cx-acc2",
      "codex:active:cx-acc10",
      "codex:active:cx-AY"
    ]);
  });

  it("auto-normalizes and sorts legacy unsorted registry profiles while preserving existing IDs and paths", async () => {
    const { profilesFile } = getAppPaths();
    await fs.mkdir(path.dirname(profilesFile), { recursive: true });
    await fs.writeFile(
      profilesFile,
      JSON.stringify(
        {
          schemaVersion: 2,
          profiles: [
            makeStubProfile("ala-2", "ala", "codex"),
            makeStubProfile("yun-2", "yun", "codex"),
            makeStubProfile("ay", "AY", "codex"),
            makeStubProfile("antigravity-work-yun", "YUN-ALA", "antigravity"),
            makeStubProfile("ala", "ALA", "antigravity"),
            makeStubProfile("james", "james", "codex"),
            makeStubProfile("antigravity-work", "James168", "antigravity")
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    const listed = await listProfiles(true);
    expect(listed.map((p) => ({ id: p.id, name: p.name, engine: p.engine }))).toEqual([
      { id: "ala", name: "anti-ALA", engine: "antigravity" },
      { id: "antigravity-work", name: "anti-James168", engine: "antigravity" },
      { id: "antigravity-work-yun", name: "anti-YUN-ALA", engine: "antigravity" },
      { id: "ala-2", name: "cx-ala", engine: "codex" },
      { id: "ay", name: "cx-AY", engine: "codex" },
      { id: "james", name: "cx-james", engine: "codex" },
      { id: "yun-2", name: "cx-yun", engine: "codex" }
    ]);

    // Existing profileHome & userDataDir must remain intact
    const yunCodex = listed.find((p) => p.id === "yun-2");
    expect(yunCodex?.paths.profileHome).toBe("C:\\profiles\\yun-2\\home");

    // Changes are persisted back to profiles.json
    const persisted = await loadRegistry();
    expect(persisted.profiles.map((p) => p.name)).toEqual([
      "anti-ALA",
      "anti-James168",
      "anti-YUN-ALA",
      "cx-ala",
      "cx-AY",
      "cx-james",
      "cx-yun"
    ]);
  });

  it("enforces prefixes on create, update, launcher rebuild, and avoids ID collisions across engines", async () => {
    const createdCodex = await createProfile({
      name: "SharedName",
      engine: "codex",
      authMode: "chatgpt_account",
      inheritDefaultConfig: false,
      provider: { displayName: "OpenAI", model: "gpt-5.2" }
    });
    const createdAgy = await createProfile({
      name: "SharedName",
      engine: "antigravity",
      antigravityVariant: "antigravity_app",
      authMode: "google_account",
      inheritDefaultConfig: false,
      provider: { displayName: "Google Antigravity", model: "gemini-2.5-pro" }
    });

    expect(createdCodex.profile.name).toBe("cx-SharedName");
    expect(createdCodex.profile.id).toBe("cx-sharedname");
    expect(path.basename(createdCodex.launcherPath)).toBe("cx-SharedName.cmd");

    expect(createdAgy.profile.name).toBe("anti-SharedName");
    expect(createdAgy.profile.id).toBe("anti-sharedname");
    expect(path.basename(createdAgy.launcherPath)).toBe("anti-SharedName.cmd");

    // Registry order puts Antigravity first even though Codex was created first
    const ordered = await listProfiles(true);
    expect(ordered.map((p) => p.name)).toEqual(["anti-SharedName", "cx-SharedName"]);

    // Renaming without prefix automatically re-applies prefix and cleans up old launcher file
    const oldLauncher = createdCodex.launcherPath;
    const updated = await updateProfile({
      profileId: createdCodex.profile.id,
      name: "Alpha",
      provider: { displayName: "OpenAI", model: "gpt-5.2" }
    });
    expect(updated.profile.name).toBe("cx-Alpha");
    expect(path.basename(updated.launcherPath)).toBe("cx-Alpha.cmd");
    await expect(fs.access(updated.launcherPath)).resolves.toBeUndefined();
    await expect(fs.access(oldLauncher)).rejects.toThrow();

    // Soft delete moves deleted item after active items in same engine
    await softDeleteProfile(createdAgy.profile.id);
    const rebuilt = await rebuildProfileLauncher(createdCodex.profile.id);
    expect(path.basename(rebuilt.launcherPath)).toBe(launcherFileName("Alpha", "codex"));
  });
});
