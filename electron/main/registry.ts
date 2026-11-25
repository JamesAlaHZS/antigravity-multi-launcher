import path from "node:path";
import type {
  AppSettings,
  CreateProfileInput,
  ProfilePaths,
  ProfileRecord,
  UpdateProfileInput
} from "../../src/shared/types.js";
import { normalizeProfileName, sortProfiles } from "../../src/shared/profile-utils.js";
import { ensureDir, readJsonFile, writeJsonFile } from "./fs-utils.js";
import {
  getAppPaths,
  launcherFileName,
  resolveAntigravityApp,
  resolveCodexApp,
  slugifyProfileName
} from "./paths.js";

export const DEFAULT_ICON_COLORS = {
  antigravity: "#4F46E5",
  codex: "#10B981"
};

interface RegistryStore {
  schemaVersion: 2;
  profiles: ProfileRecord[];
}

const EMPTY_REGISTRY: RegistryStore = {
  schemaVersion: 2,
  profiles: []
};

const DEFAULT_SETTINGS: AppSettings = {
  language: "zh-CN",
  theme: "light",
  autoRefreshRuntimeSeconds: 5
};

export async function getSettings(): Promise<AppSettings> {
  const { settingsFile } = getAppPaths();
  const saved = await readJsonFile<Partial<AppSettings>>(settingsFile, {});
  return {
    ...DEFAULT_SETTINGS,
    ...saved
  };
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const { settingsFile } = getAppPaths();
  const current = await getSettings();
  const next: AppSettings = {
    ...current,
    ...patch
  };
  await writeJsonFile(settingsFile, next);
  return next;
}

export async function getEffectiveStorageRoots(): Promise<{
  antigravityRoot: string;
  antigravityUserDataRoot: string;
  codexRoot: string;
  codexUserDataRoot: string;
  launcherRoot: string;
}> {
  const appPaths = getAppPaths();
  const settings = await getSettings();

  const customAgy = settings.antigravityStorageRoot?.trim();
  const customCodex = settings.codexStorageRoot?.trim();

  const antigravityRoot = customAgy || appPaths.antigravityProfileRoot;
  const antigravityUserDataRoot = customAgy || appPaths.antigravityUserDataRoot;

  const codexRoot = customCodex || appPaths.codexProfileRoot;
  const codexUserDataRoot = customCodex || appPaths.codexUserDataRoot;

  const launcherRoot = settings.defaultLauncherRoot?.trim() || appPaths.defaultLauncherRoot;

  return {
    antigravityRoot,
    antigravityUserDataRoot,
    codexRoot,
    codexUserDataRoot,
    launcherRoot
  };
}

export async function loadRegistry(): Promise<RegistryStore> {
  const { profilesFile } = getAppPaths();
  return readJsonFile<RegistryStore>(profilesFile, EMPTY_REGISTRY);
}

export async function saveRegistry(store: RegistryStore): Promise<void> {
  const { profilesFile } = getAppPaths();
  await writeJsonFile(profilesFile, store);
}

function organizeProfiles(profiles: ProfileRecord[]): {
  profiles: ProfileRecord[];
  changed: boolean;
} {
  const normalized = profiles.map(normalizeProfile);
  const sorted = sortProfiles(normalized);
  const changed =
    sorted.length !== profiles.length ||
    sorted.some((item, idx) => {
      const orig = profiles[idx];
      return (
        !orig ||
        orig.id !== item.id ||
        orig.name !== item.name ||
        orig.appearance?.iconBackgroundColor !== item.appearance.iconBackgroundColor
      );
    });
  return { profiles: sorted, changed };
}

export async function listProfiles(includeDeleted = false): Promise<ProfileRecord[]> {
  const store = await loadRegistry();
  const { profiles: organized, changed } = organizeProfiles(store.profiles);
  if (changed && store.profiles.length > 0) {
    await saveRegistry({ ...store, profiles: organized });
  }
  return includeDeleted ? organized : organized.filter((p) => p.status !== "deleted");
}

export async function findProfile(profileId: string): Promise<ProfileRecord | null> {
  const store = await loadRegistry();
  const found = store.profiles.find((p) => p.id === profileId);
  return found ? normalizeProfile(found) : null;
}

export async function createProfileRecord(input: CreateProfileInput): Promise<ProfileRecord> {
  const settings = await getSettings();
  const roots = await getEffectiveStorageRoots();
  const store = await loadRegistry();

  const normalizedName = normalizeProfileName(input.name, input.engine);
  const baseSlug = slugifyProfileName(normalizedName);
  const existingIds = new Set(store.profiles.map((p) => p.id));
  let id = baseSlug;
  let counter = 2;
  while (existingIds.has(id)) {
    id = `${baseSlug}-${counter}`;
    counter += 1;
  }

  const now = new Date().toISOString();
  const isAntigravity = input.engine === "antigravity";
  const variant = isAntigravity ? input.antigravityVariant ?? "antigravity_app" : undefined;

  const profileHome = isAntigravity
    ? path.join(roots.antigravityRoot, id, "home")
    : path.join(roots.codexRoot, id, "codex-home");

  const userDataDir = isAntigravity
    ? path.join(roots.antigravityUserDataRoot, id, "user-data")
    : path.join(roots.codexUserDataRoot, id, "user-data");

  const extensionsDir =
    isAntigravity && variant === "antigravity_ide"
      ? path.join(roots.antigravityRoot, id, "extensions")
      : undefined;

  const launcherDir = input.launcherDirectory?.trim() || roots.launcherRoot;
  const launcherPath = path.join(launcherDir, launcherFileName(normalizedName, input.engine));

  const resolvedApp = isAntigravity
    ? resolveAntigravityApp(
        input.appPath ||
          (variant === "antigravity_ide"
            ? settings.defaultAntigravityIdePath
            : settings.defaultAntigravityAppPath),
        variant
      )
    : resolveCodexApp(input.appPath || settings.defaultCodexAppPath);

  const sanitizedEnvSuffix = id.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const envKeyName = isAntigravity
    ? input.authMode === "gemini_api_key"
      ? "GEMINI_API_KEY"
      : `AGY_PROFILE_${sanitizedEnvSuffix}_API_KEY`
    : input.authMode === "official_openai"
      ? "OPENAI_API_KEY"
      : `CODEX_PROFILE_${sanitizedEnvSuffix}_API_KEY`;

  const useDefaultHome = Boolean(isAntigravity && input.useDefaultHome);
  const autoSyncFrom =
    !useDefaultHome && input.autoSyncConversationsFrom?.trim()
      ? input.autoSyncConversationsFrom.trim()
      : undefined;

  const profile: ProfileRecord = {
    id,
    name: normalizedName,
    engine: input.engine,
    ...(variant ? { antigravityVariant: variant } : {}),
    status: "active",
    ...(isAntigravity && !useDefaultHome ? { credentialScope: `agy-profile-${id}` } : {}),
    ...(useDefaultHome ? { useDefaultHome: true } : {}),
    ...(autoSyncFrom ? { autoSyncConversationsFrom: autoSyncFrom } : {}),
    paths: {
      appPath: resolvedApp.appPath,
      profileHome,
      userDataDir,
      ...(extensionsDir ? { extensionsDir } : {}),
      launcherPath
    },
    auth: {
      mode: input.authMode
    },
    provider: {
      displayName:
        input.provider.displayName.trim() ||
        (isAntigravity ? "Google Antigravity" : "OpenAI"),
      baseUrl: input.provider.baseUrl?.trim() || undefined,
      model:
        input.provider.model.trim() ||
        (isAntigravity ? "gemini-2.5-pro" : "gpt-5.2"),
      envKeyName,
      wireProtocol: input.provider.wireProtocol?.trim() || undefined,
      proxyUrl: input.provider.proxyUrl?.trim() || undefined,
      reasoningEffort: input.provider.reasoningEffort ?? "medium",
      wslDistro: input.provider.wslDistro?.trim() || undefined,
      googleCloudProject: input.provider.googleCloudProject?.trim() || undefined
    },
    appearance: {
      iconBackgroundColor: normalizeHexColor(
        input.appearance?.iconBackgroundColor,
        DEFAULT_ICON_COLORS[input.engine]
      ),
      notes: input.appearance?.notes?.trim() || undefined
    },
    launch: {
      lastLaunchedAt: null,
      lastKnownPid: null,
      lastKnownUserDataDir: userDataDir
    },
    timestamps: {
      createdAt: now,
      updatedAt: now
    }
  };

  await Promise.all([
    ensureDir(profileHome),
    ensureDir(userDataDir),
    ensureDir(launcherDir),
    ...(extensionsDir ? [ensureDir(extensionsDir)] : [])
  ]);

  store.profiles = organizeProfiles([...store.profiles, profile]).profiles;
  await saveRegistry(store);
  return profile;
}

export async function updateProfilePathsRecord(
  profileId: string,
  newPaths: Partial<ProfilePaths>
): Promise<ProfileRecord> {
  const store = await loadRegistry();
  const profile = store.profiles.find((p) => p.id === profileId);
  if (!profile) {
    throw new Error(`Profile not found: ${profileId}`);
  }
  profile.paths = {
    ...profile.paths,
    ...newPaths
  };
  if (newPaths.userDataDir) {
    profile.launch.lastKnownUserDataDir = newPaths.userDataDir;
  }
  profile.timestamps.updatedAt = new Date().toISOString();
  store.profiles = organizeProfiles(store.profiles).profiles;
  await saveRegistry(store);
  return normalizeProfile(profile);
}

export async function insertImportedProfileRecord(profile: ProfileRecord): Promise<ProfileRecord> {
  const store = await loadRegistry();
  const normalized = normalizeProfile(profile);
  const existingIdx = store.profiles.findIndex((p) => p.id === normalized.id);
  if (existingIdx >= 0) {
    store.profiles[existingIdx] = normalized;
  } else {
    store.profiles.push(normalized);
  }
  store.profiles = organizeProfiles(store.profiles).profiles;
  await saveRegistry(store);
  return normalized;
}

export async function updateProfileRecord(input: UpdateProfileInput): Promise<ProfileRecord> {
  const store = await loadRegistry();
  const profile = store.profiles.find((p) => p.id === input.profileId);
  if (!profile) {
    throw new Error(`Profile not found: ${input.profileId}`);
  }

  if (input.name?.trim()) {
    const nextName = normalizeProfileName(input.name, profile.engine);
    profile.name = nextName;
    const launcherDir = profile.paths.launcherPath
      ? path.dirname(profile.paths.launcherPath)
      : (await getEffectiveStorageRoots()).launcherRoot;
    profile.paths.launcherPath = path.join(launcherDir, launcherFileName(nextName, profile.engine));
  } else {
    profile.name = normalizeProfileName(profile.name, profile.engine) || profile.name;
  }
  if (input.appPath?.trim()) {
    profile.paths.appPath = input.appPath.trim();
  }
  if (profile.engine === "antigravity" && input.antigravityVariant) {
    profile.antigravityVariant = input.antigravityVariant;
  }
  if (profile.engine === "antigravity" && input.useDefaultHome !== undefined) {
    profile.useDefaultHome = input.useDefaultHome ? true : undefined;
    if (profile.useDefaultHome) {
      profile.autoSyncConversationsFrom = undefined;
    } else if (!profile.credentialScope) {
      profile.credentialScope = `agy-profile-${profile.id}`;
    }
  }
  if (input.autoSyncConversationsFrom !== undefined) {
    const trimmedSync = input.autoSyncConversationsFrom.trim();
    profile.autoSyncConversationsFrom =
      trimmedSync && !profile.useDefaultHome ? trimmedSync : undefined;
  }
  if (input.authMode) {
    profile.auth.mode = input.authMode;
  }

  profile.provider = {
    ...profile.provider,
    displayName: input.provider.displayName.trim() || profile.provider.displayName,
    baseUrl: input.provider.baseUrl?.trim() || undefined,
    model: input.provider.model.trim() || profile.provider.model,
    wireProtocol: input.provider.wireProtocol?.trim() || undefined,
    proxyUrl: input.provider.proxyUrl?.trim() || undefined,
    reasoningEffort: input.provider.reasoningEffort ?? profile.provider.reasoningEffort,
    wslDistro: input.provider.wslDistro?.trim() || undefined,
    googleCloudProject: input.provider.googleCloudProject?.trim() || undefined
  };

  if (input.appearance) {
    profile.appearance = {
      ...profile.appearance,
      ...(input.appearance.iconBackgroundColor
        ? {
            iconBackgroundColor: normalizeHexColor(
              input.appearance.iconBackgroundColor,
              DEFAULT_ICON_COLORS[profile.engine]
            )
          }
        : {}),
      notes: input.appearance.notes?.trim() || undefined
    };
  }

  profile.timestamps.updatedAt = new Date().toISOString();
  store.profiles = organizeProfiles(store.profiles).profiles;
  await saveRegistry(store);
  return normalizeProfile(profile);
}

export async function updateProfileLaunchMetadata(
  profileId: string,
  pid: number | null
): Promise<void> {
  const store = await loadRegistry();
  const profile = store.profiles.find((p) => p.id === profileId);
  if (!profile) return;
  profile.launch.lastLaunchedAt = new Date().toISOString();
  profile.launch.lastKnownPid = pid;
  profile.launch.lastKnownUserDataDir = profile.paths.userDataDir;
  profile.timestamps.updatedAt = new Date().toISOString();
  await saveRegistry(store);
}

export async function softDeleteProfileRecord(profileId: string): Promise<void> {
  const store = await loadRegistry();
  const profile = store.profiles.find((p) => p.id === profileId);
  if (!profile) throw new Error(`Profile not found: ${profileId}`);
  profile.status = "deleted";
  profile.timestamps.updatedAt = new Date().toISOString();
  store.profiles = organizeProfiles(store.profiles).profiles;
  await saveRegistry(store);
}

export async function restoreProfileRecord(profileId: string): Promise<void> {
  const store = await loadRegistry();
  const profile = store.profiles.find((p) => p.id === profileId);
  if (!profile) throw new Error(`Profile not found: ${profileId}`);
  profile.status = "active";
  profile.timestamps.updatedAt = new Date().toISOString();
  store.profiles = organizeProfiles(store.profiles).profiles;
  await saveRegistry(store);
}

export async function removeProfileRecord(profileId: string): Promise<ProfileRecord> {
  const store = await loadRegistry();
  const profile = store.profiles.find((p) => p.id === profileId);
  if (!profile) throw new Error(`Profile not found: ${profileId}`);
  store.profiles = organizeProfiles(store.profiles.filter((p) => p.id !== profileId)).profiles;
  await saveRegistry(store);
  return normalizeProfile(profile);
}

function normalizeProfile(profile: ProfileRecord): ProfileRecord {
  const fallbackColor = DEFAULT_ICON_COLORS[profile.engine] ?? "#4F46E5";
  const normalizedName = normalizeProfileName(profile.name, profile.engine) || profile.name;
  return {
    ...profile,
    name: normalizedName,
    appearance: {
      ...profile.appearance,
      iconBackgroundColor: normalizeHexColor(profile.appearance?.iconBackgroundColor, fallbackColor)
    }
  };
}

export function normalizeHexColor(value: string | undefined, fallback = "#4F46E5"): string {
  if (!value) return fallback;
  const trimmed = value.trim();
  const shortMatch = trimmed.match(/^#?([0-9a-fA-F]{3})$/);
  if (shortMatch) {
    return `#${shortMatch[1]
      .split("")
      .map((c) => `${c}${c}`)
      .join("")
      .toUpperCase()}`;
  }
  const longMatch = trimmed.match(/^#?([0-9a-fA-F]{6})$/);
  if (longMatch) {
    return `#${longMatch[1].toUpperCase()}`;
  }
  return fallback;
}
