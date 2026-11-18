import path from "node:path";
import type {
  AppSettings,
  CreateProfileInput,
  ProfilePaths,
  ProfileRecord,
  UpdateProfileInput
} from "../../src/shared/types.js";
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

export async function listProfiles(includeDeleted = false): Promise<ProfileRecord[]> {
  const store = await loadRegistry();
  const normalized = store.profiles.map(normalizeProfile);
  return includeDeleted ? normalized : normalized.filter((p) => p.status !== "deleted");
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

  const baseSlug = slugifyProfileName(input.name);
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
  const launcherPath = path.join(launcherDir, launcherFileName(input.name, input.engine));

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

  const profile: ProfileRecord = {
    id,
    name: input.name.trim(),
    engine: input.engine,
    ...(variant ? { antigravityVariant: variant } : {}),
    status: "active",
    ...(isAntigravity ? { credentialScope: `agy-profile-${id}` } : {}),
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

  store.profiles.push(profile);
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
  await saveRegistry(store);
  return normalizeProfile(profile);
}

export async function insertImportedProfileRecord(profile: ProfileRecord): Promise<ProfileRecord> {
  const store = await loadRegistry();
  const existingIdx = store.profiles.findIndex((p) => p.id === profile.id);
  if (existingIdx >= 0) {
    store.profiles[existingIdx] = profile;
  } else {
    store.profiles.push(profile);
  }
  await saveRegistry(store);
  return profile;
}

export async function updateProfileRecord(input: UpdateProfileInput): Promise<ProfileRecord> {
  const store = await loadRegistry();
  const profile = store.profiles.find((p) => p.id === input.profileId);
  if (!profile) {
    throw new Error(`Profile not found: ${input.profileId}`);
  }

  if (input.name?.trim()) {
    profile.name = input.name.trim();
  }
  if (input.appPath?.trim()) {
    profile.paths.appPath = input.appPath.trim();
  }
  if (profile.engine === "antigravity" && input.antigravityVariant) {
    profile.antigravityVariant = input.antigravityVariant;
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
  await saveRegistry(store);
}

export async function restoreProfileRecord(profileId: string): Promise<void> {
  const store = await loadRegistry();
  const profile = store.profiles.find((p) => p.id === profileId);
  if (!profile) throw new Error(`Profile not found: ${profileId}`);
  profile.status = "active";
  profile.timestamps.updatedAt = new Date().toISOString();
  await saveRegistry(store);
}

export async function removeProfileRecord(profileId: string): Promise<ProfileRecord> {
  const store = await loadRegistry();
  const profile = store.profiles.find((p) => p.id === profileId);
  if (!profile) throw new Error(`Profile not found: ${profileId}`);
  store.profiles = store.profiles.filter((p) => p.id !== profileId);
  await saveRegistry(store);
  return normalizeProfile(profile);
}

function normalizeProfile(profile: ProfileRecord): ProfileRecord {
  const fallbackColor = DEFAULT_ICON_COLORS[profile.engine] ?? "#4F46E5";
  return {
    ...profile,
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
