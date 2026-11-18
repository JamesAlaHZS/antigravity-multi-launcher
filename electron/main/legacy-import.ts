import path from "node:path";
import type {
  CodexAuthMode,
  LegacyCodexProfileCandidate,
  ProfileRecord
} from "../../src/shared/types.js";
import { pathExists, readJsonFile } from "./fs-utils.js";
import { generateProfileLauncher } from "./launcher.js";
import { getAppPaths, launcherFileName, resolveCodexApp } from "./paths.js";
import {
  DEFAULT_ICON_COLORS,
  getEffectiveStorageRoots,
  getSettings,
  insertImportedProfileRecord,
  listProfiles
} from "./registry.js";
import { upsertProfileSecret } from "./secrets.js";

interface LegacyCodexProfileRaw {
  id: string;
  name: string;
  status?: string;
  paths?: {
    codexAppPath?: string;
    codexHome?: string;
    userDataDir?: string;
    launcherPath?: string;
  };
  provider?: {
    type?: string;
    displayName?: string;
    baseUrl?: string;
    envKeyName?: string;
    model?: string;
    reasoningEffort?: "low" | "medium" | "high";
  };
  auth?: {
    mode?: string;
  };
  appearance?: {
    iconBackgroundColor?: string;
  };
  timestamps?: {
    createdAt?: string;
    updatedAt?: string;
  };
}

function mapLegacyAuthMode(raw: LegacyCodexProfileRaw): CodexAuthMode {
  if (raw.auth?.mode === "chatgpt_account") {
    return "chatgpt_account";
  }
  if (raw.provider?.type === "official_openai") {
    return "official_openai";
  }
  return "third_party_responses";
}

function getLegacyRegistryCandidatePaths(): string[] {
  const { roaming } = getAppPaths();
  return [
    path.join(roaming, "Codex Profile Manager", "profiles.json"),
    path.join(roaming, "codex-profile-manager", "profiles.json")
  ];
}

async function loadLegacyRawProfiles(): Promise<LegacyCodexProfileRaw[]> {
  for (const candidate of getLegacyRegistryCandidatePaths()) {
    if (await pathExists(candidate)) {
      const parsed = await readJsonFile<{ profiles?: LegacyCodexProfileRaw[] }>(candidate, {});
      if (Array.isArray(parsed.profiles)) {
        return parsed.profiles.filter((p) => p && p.id);
      }
    }
  }
  return [];
}

export async function detectLegacyCodexProfiles(): Promise<LegacyCodexProfileCandidate[]> {
  const [legacyProfiles, currentProfiles] = await Promise.all([
    loadLegacyRawProfiles(),
    listProfiles(true)
  ]);
  const existingIds = new Set(currentProfiles.map((p) => p.id));
  const existingHomes = new Set(
    currentProfiles.map((p) => path.resolve(p.paths.profileHome).toLowerCase())
  );

  return legacyProfiles.map((raw) => {
    const codexHome = raw.paths?.codexHome || "";
    const alreadyImported =
      existingIds.has(raw.id) ||
      (Boolean(codexHome) && existingHomes.has(path.resolve(codexHome).toLowerCase()));
    return {
      id: raw.id,
      name: raw.name || raw.id,
      legacyStatus: raw.status === "deleted" ? "deleted" : "active",
      authMode: mapLegacyAuthMode(raw),
      model: raw.provider?.model || "gpt-5.2",
      providerName: raw.provider?.displayName || "Codex",
      codexHome,
      userDataDir: raw.paths?.userDataDir || "",
      alreadyImported
    };
  });
}

export async function importLegacyCodexProfiles(
  selectedIds?: string[]
): Promise<{ importedCount: number }> {
  const [legacyProfiles, currentProfiles, settings, roots] = await Promise.all([
    loadLegacyRawProfiles(),
    listProfiles(true),
    getSettings(),
    getEffectiveStorageRoots()
  ]);
  const existingIds = new Set(currentProfiles.map((p) => p.id));
  const filterSet = selectedIds?.length ? new Set(selectedIds) : null;

  let importedCount = 0;
  for (const raw of legacyProfiles) {
    if (filterSet && !filterSet.has(raw.id)) continue;
    if (!filterSet && raw.status === "deleted") continue;
    if (existingIds.has(raw.id)) continue;
    if (!raw.paths?.codexHome || !raw.paths?.userDataDir) continue;

    const authMode = mapLegacyAuthMode(raw);
    const resolvedCodex = resolveCodexApp(raw.paths.codexAppPath || settings.defaultCodexAppPath);
    const launcherPath = path.join(
      roots.launcherRoot,
      launcherFileName(raw.name || raw.id, "codex")
    );
    const now = new Date().toISOString();

    const importedRecord: ProfileRecord = {
      id: raw.id,
      name: raw.name || raw.id,
      engine: "codex",
      status: raw.status === "deleted" ? "deleted" : "active",
      paths: {
        appPath: resolvedCodex.appPath,
        profileHome: raw.paths.codexHome,
        userDataDir: raw.paths.userDataDir,
        launcherPath
      },
      auth: {
        mode: authMode
      },
      provider: {
        displayName: raw.provider?.displayName || "Codex",
        baseUrl: raw.provider?.baseUrl,
        model: raw.provider?.model || "gpt-5.2",
        envKeyName: raw.provider?.envKeyName || "OPENAI_API_KEY",
        reasoningEffort: raw.provider?.reasoningEffort || "medium"
      },
      appearance: {
        iconBackgroundColor: raw.appearance?.iconBackgroundColor || DEFAULT_ICON_COLORS.codex,
        notes: "Imported from Codex Profile Manager"
      },
      launch: {
        lastLaunchedAt: null,
        lastKnownPid: null,
        lastKnownUserDataDir: raw.paths.userDataDir
      },
      timestamps: {
        createdAt: raw.timestamps?.createdAt || now,
        updatedAt: now
      }
    };

    const authJsonPath = path.join(raw.paths.codexHome, "auth.json");
    if (authMode !== "chatgpt_account" && (await pathExists(authJsonPath))) {
      const authJson = await readJsonFile<{ OPENAI_API_KEY?: string }>(authJsonPath, {});
      if (authJson.OPENAI_API_KEY?.trim()) {
        await upsertProfileSecret(importedRecord.id, authJson.OPENAI_API_KEY.trim());
      }
    }

    await insertImportedProfileRecord(importedRecord);
    if (importedRecord.status === "active") {
      await generateProfileLauncher(importedRecord);
    }
    existingIds.add(importedRecord.id);
    importedCount += 1;
  }

  return { importedCount };
}
