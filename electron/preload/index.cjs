const { contextBridge, ipcRenderer } = require("electron");

const api = {
  getAppInfo: () => ipcRenderer.invoke("app:get-info"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (patch) => ipcRenderer.invoke("settings:update", patch),
  openExternalUrl: (url) => ipcRenderer.invoke("shell:open-external", url),
  revealPath: (targetPath) => ipcRenderer.invoke("shell:reveal-path", targetPath),
  pickExecutablePath: (engine) => ipcRenderer.invoke("dialog:pick-executable", engine),
  pickDirectory: (defaultPath) => ipcRenderer.invoke("dialog:pick-directory", defaultPath),
  getEnvironmentReport: () => ipcRenderer.invoke("environment:get"),
  getDiagnosticsReport: () => ipcRenderer.invoke("diagnostics:get"),
  listProfiles: (includeDeleted = false) => ipcRenderer.invoke("profiles:list", includeDeleted),
  getRuntimeStatus: () => ipcRenderer.invoke("profiles:runtime"),
  createProfile: (input) => ipcRenderer.invoke("profiles:create", input),
  updateProfile: (input) => ipcRenderer.invoke("profiles:update", input),
  deleteProfile: (profileId) => ipcRenderer.invoke("profiles:delete", profileId),
  restoreProfile: (profileId) => ipcRenderer.invoke("profiles:restore", profileId),
  permanentlyDeleteProfile: (profileId) => ipcRenderer.invoke("profiles:delete-permanently", profileId),
  openProfile: (profileId) => ipcRenderer.invoke("profiles:open", profileId),
  stopProfile: (profileId) => ipcRenderer.invoke("profiles:stop", profileId),
  generateLauncher: (profileId) => ipcRenderer.invoke("profiles:generate-launcher", profileId),
  syncProfileResources: (input) => ipcRenderer.invoke("profiles:sync-resources", input),
  listConfigBackups: (profileId) => ipcRenderer.invoke("profiles:backups", profileId),
  restoreConfigBackup: (input) => ipcRenderer.invoke("profiles:restore-backup", input),
  readProfileLaunchLog: (profileId) => ipcRenderer.invoke("profiles:launch-log", profileId),
  testProvider: (input) => ipcRenderer.invoke("provider:test", input),
  testProfileProvider: (input) => ipcRenderer.invoke("profiles:test-provider", input),
  listProviderModels: (input) => ipcRenderer.invoke("provider:models", input),
  listProfileProviderModels: (input) => ipcRenderer.invoke("profiles:models", input),
  detectLegacyCodexProfiles: () => ipcRenderer.invoke("legacy:detect-codex"),
  importLegacyCodexProfiles: (profileIds) => ipcRenderer.invoke("legacy:import-codex", profileIds)
};

contextBridge.exposeInMainWorld("multiLauncher", api);
