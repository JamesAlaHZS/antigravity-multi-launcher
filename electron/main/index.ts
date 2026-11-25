import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EngineType } from "../../src/shared/types.js";
import { buildSanitizedDiagnosticsReport } from "./diagnostics.js";
import { getEnvironmentReport } from "./environment.js";
import {
  detectLegacyCodexProfiles,
  importLegacyCodexProfiles
} from "./legacy-import.js";
import { APP_NAME, getAppPaths } from "./paths.js";
import {
  createProfile,
  getProfileStats,
  getRuntimeStatus,
  listProfileBackups,
  listSavedProfileModels,
  migrateProfileStorage,
  openProfile,
  permanentlyDeleteProfile,
  readProfileLaunchLog,
  rebuildProfileLauncher,
  restoreProfile,
  restoreProfileBackup,
  softDeleteProfile,
  stopProfile,
  syncProfileResources,
  testSavedProfileProvider,
  updateProfile
} from "./profile-service.js";
import { fetchProviderModels, testProviderConnection } from "./provider-test.js";
import {
  findProfile,
  getEffectiveStorageRoots,
  getSettings,
  listProfiles,
  updateSettings
} from "./registry.js";
import {
  downloadAntigravityHansOverlay,
  getAntigravityHansStatus,
  stopAllHansMonitors
} from "./antigravity-hans.js";
import { stopProfileProcesses } from "./runtime.js";
import { parseElevatedAntigravityArg } from "./windows-antigravity-elevation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseOpenProfileArg(argv: string[]): string | null {
  const found = argv.find((arg) => arg.startsWith("--open-profile="));
  return found ? found.slice("--open-profile=".length).trim() || null : null;
}

const initialOpenProfileId = parseOpenProfileArg(process.argv);
const elevatedAntigravityAction = process.platform === "win32" && app.isPackaged
  ? parseElevatedAntigravityArg(process.argv)
  : null;

if (!elevatedAntigravityAction && !app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;

function resolvePreloadPath(): string {
  return path.join(__dirname, "..", "preload", "index.cjs");
}

function resolveRendererHtmlPath(): string {
  return path.join(__dirname, "..", "..", "..", "dist", "index.html");
}

function resolveWindowIconPath(): string {
  return path.join(__dirname, "..", "..", "..", "assets", "icon.png");
}

async function createMainWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    title: APP_NAME,
    icon: resolveWindowIconPath(),
    autoHideMenuBar: true,
    backgroundColor: "#F6F8FC",
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    await win.loadURL(devServerUrl);
  } else {
    await win.loadFile(resolveRendererHtmlPath());
  }

  win.on("closed", () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  mainWindow = win;
  return win;
}

function registerIpcHandlers(): void {
  ipcMain.handle("app:get-info", async () => {
    const paths = getAppPaths();
    const roots = await getEffectiveStorageRoots();
    return {
      name: APP_NAME,
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      electronVersion: process.versions.electron,
      appDataDir: paths.appDataDir,
      defaultLauncherRoot: roots.launcherRoot,
      antigravityProfileRoot: roots.antigravityRoot,
      codexProfileRoot: roots.codexRoot
    };
  });

  ipcMain.handle("settings:get", () => getSettings());
  ipcMain.handle("settings:update", (_e, patch) => updateSettings(patch));

  ipcMain.handle("shell:open-external", async (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) {
      await shell.openExternal(url);
    }
  });

  ipcMain.handle("shell:reveal-path", async (_e, targetPath: string) => {
    if (!targetPath) return;
    shell.showItemInFolder(targetPath);
  });

  ipcMain.handle("dialog:pick-executable", async (_e, engine: EngineType) => {
    const isWin = process.platform === "win32";
    const result = await dialog.showOpenDialog({
      title:
        engine === "antigravity"
          ? "选择 Antigravity 可执行程序"
          : "选择 Codex / ChatGPT 可执行程序",
      properties: ["openFile"],
      filters: isWin
        ? [{ name: "Executable", extensions: ["exe"] }]
        : [{ name: "Application", extensions: ["app", ""] }]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle("dialog:pick-directory", async (_e, defaultPath?: string) => {
    const result = await dialog.showOpenDialog({
      title: "选择文件夹",
      defaultPath,
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle("environment:get", () => getEnvironmentReport());
  ipcMain.handle("diagnostics:get", () => buildSanitizedDiagnosticsReport(app.getVersion()));

  ipcMain.handle("profiles:list", (_e, includeDeleted?: boolean) =>
    listProfiles(Boolean(includeDeleted))
  );
  ipcMain.handle("profiles:runtime", () => getRuntimeStatus());
  ipcMain.handle("profiles:create", (_e, input) => createProfile(input));
  ipcMain.handle("profiles:update", (_e, input) => updateProfile(input));
  ipcMain.handle("profiles:delete", (_e, id: string) => softDeleteProfile(id));
  ipcMain.handle("profiles:restore", (_e, id: string) => restoreProfile(id));
  ipcMain.handle("profiles:delete-permanently", (_e, id: string) => permanentlyDeleteProfile(id));
  ipcMain.handle("profiles:open", (_e, id: string) => openProfile(id));
  ipcMain.handle("profiles:stop", (_e, id: string) => stopProfile(id));
  ipcMain.handle("profiles:generate-launcher", (_e, id: string) => rebuildProfileLauncher(id));
  ipcMain.handle(
    "profiles:migrate-storage",
    (_e, input: { profileId: string; targetRoot?: string }) =>
      migrateProfileStorage(input.profileId, input.targetRoot)
  );
  ipcMain.handle("profiles:sync-resources", (_e, input) => syncProfileResources(input));
  ipcMain.handle("profiles:stats", (_e, id: string) => getProfileStats(id));
  ipcMain.handle("profiles:backups", (_e, id: string) => listProfileBackups(id));
  ipcMain.handle("profiles:restore-backup", (_e, input) => restoreProfileBackup(input));
  ipcMain.handle("profiles:launch-log", (_e, id: string) => readProfileLaunchLog(id));

  ipcMain.handle("provider:test", (_e, input) => testProviderConnection(input));
  ipcMain.handle("profiles:test-provider", (_e, input) => testSavedProfileProvider(input));
  ipcMain.handle("provider:models", (_e, input) => fetchProviderModels(input));
  ipcMain.handle("profiles:models", (_e, input) => listSavedProfileModels(input));

  ipcMain.handle("legacy:detect-codex", () => detectLegacyCodexProfiles());
  ipcMain.handle("legacy:import-codex", (_e, ids?: string[]) => importLegacyCodexProfiles(ids));

  ipcMain.handle("hans:status", () => getAntigravityHansStatus());
  ipcMain.handle("hans:update", () => downloadAntigravityHansOverlay());
}

app.on("second-instance", (_event, argv) => {
  const profileId = parseOpenProfileArg(argv);
  if (profileId) {
    void openProfile(profileId).catch((err) => {
      dialog.showErrorBox(
        `${APP_NAME} - 启动失败`,
        err instanceof Error ? err.message : String(err)
      );
    });
    return;
  }
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    void createMainWindow();
  }
});

app.whenReady().then(async () => {
  if (elevatedAntigravityAction) {
    try {
      const profile = await findProfile(elevatedAntigravityAction.profileId);
      if (profile?.engine !== "antigravity" || profile.status !== "active") {
        app.exit(1);
        return;
      }
      if (elevatedAntigravityAction.stop) {
        const stopped = await stopProfileProcesses(profile);
        app.exit(stopped.length ? 0 : 1);
        return;
      }
      await openProfile(profile.id, {
        elevatedWorker: true,
        remoteDebuggingPort: elevatedAntigravityAction.hansPort
      });
      app.exit(0);
    } catch {
      app.exit(1);
    }
    return;
  }

  registerIpcHandlers();

  if (initialOpenProfileId) {
    try {
      await openProfile(initialOpenProfileId);
      app.quit();
      return;
    } catch (err) {
      dialog.showErrorBox(
        `${APP_NAME} - 启动失败`,
        err instanceof Error ? err.message : String(err)
      );
      app.quit();
      return;
    }
  }

  await createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on("before-quit", () => {
  stopAllHansMonitors();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
