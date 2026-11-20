export type EngineType = "antigravity" | "codex";

export type AntigravityVariant = "antigravity_app" | "antigravity_ide";

export type AntigravityAuthMode = "google_account" | "gemini_api_key" | "custom_gateway";
export type CodexAuthMode = "chatgpt_account" | "official_openai" | "third_party_responses";
export type ProfileAuthMode = AntigravityAuthMode | CodexAuthMode;

export type ReasoningEffort = "low" | "medium" | "high";
export type LanguageCode = "zh-CN" | "en";

export interface ProfilePaths {
  appPath: string;
  profileHome: string;
  userDataDir: string;
  extensionsDir?: string;
  launcherPath: string;
}

export interface ProfileProviderConfig {
  displayName: string;
  baseUrl?: string;
  model: string;
  envKeyName: string;
  wireProtocol?: string;
  proxyUrl?: string;
  reasoningEffort?: ReasoningEffort;
  wslDistro?: string;
  googleCloudProject?: string;
}

export interface ProfileRecord {
  id: string;
  name: string;
  engine: EngineType;
  antigravityVariant?: AntigravityVariant;
  status: "active" | "deleted";
  credentialScope?: string;
  /** Antigravity only: bind directly to native default ~/.gemini & %APPDATA%\Antigravity so direct launch and Multi Launcher share live history & login. */
  useDefaultHome?: boolean;
  /** Optional conversation auto-sync source before launching an isolated profile: "default" or another profileId. */
  autoSyncConversationsFrom?: string;
  paths: ProfilePaths;
  auth: {
    mode: ProfileAuthMode;
  };
  provider: ProfileProviderConfig;
  appearance: {
    iconBackgroundColor: string;
    notes?: string;
  };
  launch: {
    lastLaunchedAt: string | null;
    lastKnownPid: number | null;
    lastKnownUserDataDir: string;
  };
  timestamps: {
    createdAt: string;
    updatedAt: string;
  };
}

export interface HistorySyncSource {
  type: "default" | "profile";
  profileId?: string;
}

export interface CreateProfileInput {
  name: string;
  engine: EngineType;
  antigravityVariant?: AntigravityVariant;
  useDefaultHome?: boolean;
  autoSyncConversationsFrom?: string;
  authMode: ProfileAuthMode;
  appPath?: string;
  launcherDirectory?: string;
  inheritDefaultConfig: boolean;
  linkDeveloperDotfiles?: boolean;
  syncHistory?: {
    enabled: boolean;
    scope?: "projects" | "all";
    sources?: HistorySyncSource[];
  };
  provider: {
    displayName: string;
    baseUrl?: string;
    model: string;
    apiKey?: string;
    wireProtocol?: string;
    proxyUrl?: string;
    reasoningEffort?: ReasoningEffort;
    wslDistro?: string;
    googleCloudProject?: string;
  };
  appearance?: {
    iconBackgroundColor?: string;
    notes?: string;
  };
}

export interface UpdateProfileInput {
  profileId: string;
  name?: string;
  appPath?: string;
  antigravityVariant?: AntigravityVariant;
  useDefaultHome?: boolean;
  autoSyncConversationsFrom?: string;
  authMode?: ProfileAuthMode;
  provider: {
    displayName: string;
    baseUrl?: string;
    model: string;
    apiKey?: string;
    wireProtocol?: string;
    proxyUrl?: string;
    reasoningEffort?: ReasoningEffort;
    wslDistro?: string;
    googleCloudProject?: string;
  };
  appearance?: {
    iconBackgroundColor?: string;
    notes?: string;
  };
}

export interface SyncResourcesInput {
  profileId: string;
  syncConfigAndSkills: boolean;
  syncConversations: boolean;
  sourceType: "default" | "profile";
  sourceProfileId?: string;
  syncMode?: "merge" | "replace";
}

export interface ProfileConversationStats {
  profileId: string;
  conversationCount: number;
  defaultConversationCount: number;
  effectiveDataDir: string;
  defaultDataDir: string;
}

export interface RuntimeStatusItem {
  profileId: string;
  status: "running" | "not_running" | "unknown";
  pid: number | null;
  processCount: number;
  detail: string;
}

export interface EnvironmentCheckItem {
  id: string;
  engine: "antigravity" | "codex" | "system";
  label: string;
  importance: "required" | "optional";
  status: "pass" | "warn" | "fail";
  path?: string;
  detail: string;
}

export interface EnvironmentReport {
  platform: string;
  antigravityAppPath: string;
  antigravityAppExists: boolean;
  antigravityIdePath: string | null;
  antigravityIdeExists: boolean;
  antigravityLsStamp: string | null;
  codexAppPath: string;
  codexAppExists: boolean;
  codexCliPath: string | null;
  codexCliVersion: string | null;
  nodePath: string | null;
  nodeVersion: string | null;
  wslDistros: string[];
  checks: EnvironmentCheckItem[];
}

export interface ConfigBackupItem {
  fileName: string;
  backupPath: string;
  createdAt: string;
  sizeBytes: number;
}

export interface ProviderTestInput {
  engine: EngineType;
  authMode: ProfileAuthMode;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  proxyUrl?: string;
}

export interface ProviderTestResult {
  ok: boolean;
  status: "ok" | "auth_failed" | "network_error" | "skipped" | "unknown_error";
  summary: string;
  details: string;
  latencyMs?: number;
}

export interface ProviderModelsResult {
  ok: boolean;
  summary: string;
  details: string;
  models: string[];
}

export interface LegacyCodexProfileCandidate {
  id: string;
  name: string;
  legacyStatus: "active" | "deleted";
  authMode: CodexAuthMode;
  model: string;
  providerName: string;
  codexHome: string;
  userDataDir: string;
  alreadyImported: boolean;
}

export interface AppSettings {
  language: LanguageCode;
  theme: "light" | "dark";
  antigravityStorageRoot?: string;
  codexStorageRoot?: string;
  defaultAntigravityAppPath?: string;
  defaultAntigravityIdePath?: string;
  defaultCodexAppPath?: string;
  defaultLauncherRoot?: string;
  autoRefreshRuntimeSeconds: number;
}

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  arch: string;
  electronVersion: string;
  appDataDir: string;
  defaultLauncherRoot: string;
  antigravityProfileRoot: string;
  codexProfileRoot: string;
}

export interface MultiLauncherApi {
  getAppInfo: () => Promise<AppInfo>;
  getSettings: () => Promise<AppSettings>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;
  openExternalUrl: (url: string) => Promise<void>;
  revealPath: (targetPath: string) => Promise<void>;
  pickExecutablePath: (engine: EngineType) => Promise<string | null>;
  pickDirectory: (defaultPath?: string) => Promise<string | null>;
  getEnvironmentReport: () => Promise<EnvironmentReport>;
  getDiagnosticsReport: () => Promise<string>;
  listProfiles: (includeDeleted?: boolean) => Promise<ProfileRecord[]>;
  getRuntimeStatus: () => Promise<RuntimeStatusItem[]>;
  createProfile: (input: CreateProfileInput) => Promise<{
    profile: ProfileRecord;
    launcherPath: string;
  }>;
  updateProfile: (input: UpdateProfileInput) => Promise<{
    profile: ProfileRecord;
    launcherPath: string;
  }>;
  deleteProfile: (profileId: string) => Promise<{ ok: boolean }>;
  restoreProfile: (profileId: string) => Promise<{ ok: boolean }>;
  permanentlyDeleteProfile: (profileId: string) => Promise<{ ok: boolean }>;
  openProfile: (profileId: string) => Promise<{ pid: number | null; focusedExisting?: boolean }>;
  stopProfile: (profileId: string) => Promise<{ stoppedPids: number[] }>;
  generateLauncher: (profileId: string) => Promise<{ launcherPath: string }>;
  migrateProfileStorage: (
    profileId: string,
    targetRoot?: string
  ) => Promise<{ profile: ProfileRecord; targetDir: string }>;
  syncProfileResources: (input: SyncResourcesInput) => Promise<{
    copiedItems: string[];
    syncedConversations?: number;
  }>;
  getProfileStats: (profileId: string) => Promise<ProfileConversationStats>;
  listConfigBackups: (profileId: string) => Promise<ConfigBackupItem[]>;
  restoreConfigBackup: (input: { profileId: string; backupPath: string }) => Promise<{ ok: boolean }>;
  readProfileLaunchLog: (profileId: string) => Promise<string>;
  testProvider: (input: ProviderTestInput) => Promise<ProviderTestResult>;
  testProfileProvider: (input: {
    profileId: string;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
  }) => Promise<ProviderTestResult>;
  listProviderModels: (input: ProviderTestInput) => Promise<ProviderModelsResult>;
  listProfileProviderModels: (input: {
    profileId: string;
    baseUrl?: string;
    apiKey?: string;
  }) => Promise<ProviderModelsResult>;
  detectLegacyCodexProfiles: () => Promise<LegacyCodexProfileCandidate[]>;
  importLegacyCodexProfiles: (profileIds?: string[]) => Promise<{ importedCount: number }>;
}

declare global {
  interface Window {
    multiLauncher: MultiLauncherApi;
  }
}
