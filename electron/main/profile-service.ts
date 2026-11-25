import { spawn } from "node:child_process";
import nodeFs from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  ConfigBackupItem,
  CreateProfileInput,
  ProfileConversationStats,
  ProfileRecord,
  ProviderModelsResult,
  ProviderTestResult,
  SyncResourcesInput,
  UpdateProfileInput
} from "../../src/shared/types.js";
import {
  buildAntigravityLaunchSpec,
  clearAntigravityCredentialScope,
  countAntigravityConversations,
  getProfileAntigravityDataSubdirName,
  getProfileGeminiDir,
  inheritAntigravityConfigAndSkills,
  listAntigravityConfigBackups,
  prepareAntigravityProfileEnvironment,
  restoreAntigravityConfigBackup,
  syncAntigravityConversations,
  writeAntigravityProfileConfig
} from "./antigravity-config.js";
import {
  allocateHansDebugPort,
  ensureChineseGeminiRules,
  extractRemoteDebuggingPort,
  hasActiveHansMonitor,
  releaseHansDebugPort,
  startProfileHansMonitor,
  stopProfileHansMonitor
} from "./antigravity-hans.js";
import {
  buildCodexLaunchSpec,
  inheritDefaultCodexResources,
  listCodexConfigBackups,
  restoreCodexConfigBackup,
  syncCodexSessionHistory,
  writeCodexAuth,
  writeCodexConfig
} from "./codex-config.js";
import { ensureDir, pathExists } from "./fs-utils.js";
import { generateProfileLauncher, getProfileLogDir } from "./launcher.js";
import {
  findWindowsCodexAppxDesktopApp,
  getDefaultAntigravityUserDataDir,
  getDefaultCodexHome,
  getDefaultGeminiDir,
  getRealHomeDir,
  getRuntimePlatform,
  isWindowsAppsPath,
  isWindowsCodexGuiExecutable,
  launcherFileName,
  resolveAntigravityApp,
  resolveCodexApp
} from "./paths.js";
import { fetchProviderModels, testProviderConnection } from "./provider-test.js";
import {
  createProfileRecord,
  findProfile,
  getEffectiveStorageRoots,
  getSettings,
  listProfiles,
  removeProfileRecord,
  restoreProfileRecord,
  softDeleteProfileRecord,
  updateProfileLaunchMetadata,
  updateProfilePathsRecord,
  updateProfileRecord
} from "./registry.js";
import {
  findRunningProfilePrimaryProcess,
  findTrackedElevatedAntigravityPid,
  inspectProfilesRuntime,
  stopOrphanProfileHelpers,
  stopProfileProcesses
} from "./runtime.js";
import { deleteProfileSecret, getProfileSecret, upsertProfileSecret } from "./secrets.js";
import { runAntigravityAsAdministrator } from "./windows-antigravity-elevation.js";
import { ensureWindowsAppxDesktopCache } from "./windows-appx-cache.js";
import {
  focusWindowsProcessWindow,
  restoreWindowsDesktopTaskbarIdentity
} from "./windows-window-helper.js";

function requiresSecretApiKey(profile: ProfileRecord): boolean {
  return (
    profile.auth.mode !== "google_account" &&
    profile.auth.mode !== "chatgpt_account"
  );
}

async function mustFindProfile(profileId: string): Promise<ProfileRecord> {
  const profile = await findProfile(profileId);
  if (!profile) {
    throw new Error(`Profile not found: ${profileId}`);
  }
  return profile;
}

export async function getRuntimeStatus() {
  const profiles = await listProfiles(false);
  return inspectProfilesRuntime(profiles);
}

export async function createProfile(
  input: CreateProfileInput
): Promise<{ profile: ProfileRecord; launcherPath: string }> {
  if (!input.name?.trim()) {
    throw new Error("Profile 名称不能为空。");
  }
  const needsKey =
    input.authMode !== "google_account" && input.authMode !== "chatgpt_account";
  if (needsKey && !input.provider.apiKey?.trim()) {
    throw new Error("当前认证模式需要提供有效的 API Key。");
  }

  const profile = await createProfileRecord(input);
  try {
    if (needsKey && input.provider.apiKey?.trim()) {
      await upsertProfileSecret(profile.id, input.provider.apiKey.trim());
    }

    if (profile.engine === "antigravity") {
      await prepareAntigravityProfileEnvironment(profile, {
        linkDeveloperDotfiles: input.linkDeveloperDotfiles ?? true
      });
      if (!profile.useDefaultHome) {
        if (input.inheritDefaultConfig) {
          await inheritAntigravityConfigAndSkills(profile, getDefaultGeminiDir());
        }
        if (input.syncHistory?.enabled) {
          const sourceGemini = await resolveAntigravitySourceGeminiDir(input, profile);
          await syncAntigravityConversations(profile, sourceGemini, "merge");
        }
        await writeAntigravityProfileConfig(profile);
      }
    } else {
      if (input.inheritDefaultConfig) {
        await inheritDefaultCodexResources(profile, getDefaultCodexHome());
      }
      if (input.syncHistory?.enabled) {
        const sourceCodex = await resolveCodexSourceHome(input, profile);
        await syncCodexSessionHistory(profile, sourceCodex);
      }
      if (needsKey && input.provider.apiKey?.trim()) {
        await writeCodexAuth(profile, input.provider.apiKey.trim());
      }
      await writeCodexConfig(profile, { preserveExtraSections: true });
    }

    const launcher = await generateProfileLauncher(profile);
    return {
      profile,
      launcherPath: launcher.launcherPath
    };
  } catch (err) {
    await removeProfileRecord(profile.id).catch(() => undefined);
    await deleteProfileSecret(profile.id).catch(() => undefined);
    throw err;
  }
}

async function resolveAntigravitySourceGeminiDir(
  input: CreateProfileInput,
  target: ProfileRecord
): Promise<string> {
  const firstSource = input.syncHistory?.sources?.[0];
  if (firstSource?.type === "profile" && firstSource.profileId) {
    const srcProfile = await findProfile(firstSource.profileId);
    if (srcProfile && srcProfile.engine === "antigravity" && srcProfile.id !== target.id) {
      return getProfileGeminiDir(srcProfile);
    }
  }
  return getDefaultGeminiDir();
}

async function resolveCodexSourceHome(
  input: CreateProfileInput,
  target: ProfileRecord
): Promise<string> {
  const firstSource = input.syncHistory?.sources?.[0];
  if (firstSource?.type === "profile" && firstSource.profileId) {
    const srcProfile = await findProfile(firstSource.profileId);
    if (srcProfile && srcProfile.engine === "codex" && srcProfile.id !== target.id) {
      return srcProfile.paths.profileHome;
    }
  }
  return getDefaultCodexHome();
}

async function removeStaleLauncherIfMoved(
  previousLauncherPath: string | undefined,
  nextLauncherPath: string
): Promise<void> {
  if (!previousLauncherPath) return;
  const prevResolved = path.resolve(previousLauncherPath);
  const nextResolved = path.resolve(nextLauncherPath);
  if (prevResolved.toLowerCase() === nextResolved.toLowerCase()) return;
  if (path.dirname(prevResolved).toLowerCase() !== path.dirname(nextResolved).toLowerCase()) {
    return;
  }
  await fs.rm(prevResolved, { recursive: true, force: true }).catch(() => undefined);
}

export async function rebuildProfileLauncher(
  profileId: string
): Promise<{ launcherPath: string; executablePath: string }> {
  let profile = await mustFindProfile(profileId);
  const previousLauncherPath = profile.paths.launcherPath;
  const launcherDir = previousLauncherPath
    ? path.dirname(previousLauncherPath)
    : (await getEffectiveStorageRoots()).launcherRoot;
  const desiredLauncherPath = path.join(
    launcherDir,
    launcherFileName(profile.name, profile.engine)
  );
  if (
    !previousLauncherPath ||
    path.resolve(previousLauncherPath).toLowerCase() !==
      path.resolve(desiredLauncherPath).toLowerCase()
  ) {
    profile = await updateProfilePathsRecord(profile.id, {
      launcherPath: desiredLauncherPath
    });
  }
  const generated = await generateProfileLauncher(profile);
  await removeStaleLauncherIfMoved(previousLauncherPath, generated.launcherPath);
  return generated;
}

export async function updateProfile(
  input: UpdateProfileInput
): Promise<{ profile: ProfileRecord; launcherPath: string }> {
  const previousLauncherPath = (await findProfile(input.profileId))?.paths.launcherPath;
  const profile = await updateProfileRecord(input);

  if (requiresSecretApiKey(profile) && input.provider.apiKey?.trim()) {
    await upsertProfileSecret(profile.id, input.provider.apiKey.trim());
  }

  if (profile.engine === "antigravity") {
    await prepareAntigravityProfileEnvironment(profile);
    await writeAntigravityProfileConfig(profile, { createBackup: true });
  } else {
    if (requiresSecretApiKey(profile) && input.provider.apiKey?.trim()) {
      await writeCodexAuth(profile, input.provider.apiKey.trim());
    }
    await writeCodexConfig(profile, { preserveExtraSections: true, createBackup: true });
  }

  const launcher = await generateProfileLauncher(profile);
  await removeStaleLauncherIfMoved(previousLauncherPath, launcher.launcherPath);
  return {
    profile,
    launcherPath: launcher.launcherPath
  };
}

export async function openProfile(
  profileId: string,
  options: { elevatedWorker?: boolean; remoteDebuggingPort?: number } = {}
): Promise<{ pid: number | null; focusedExisting?: boolean }> {
  const profile = await mustFindProfile(profileId);
  const log = await createLaunchLogger(profile);

  await log("openProfile started", {
    id: profile.id,
    name: profile.name,
    engine: profile.engine,
    variant: profile.antigravityVariant,
    authMode: profile.auth.mode,
    userDataDir: profile.paths.userDataDir,
    profileHome: profile.paths.profileHome
  });

  try {
    const secretKey = requiresSecretApiKey(profile)
      ? await getProfileSecret(profile.id)
      : null;

    const runningPrimary = await findRunningProfilePrimaryProcess(profile);
    if (runningPrimary) {
      await log("detected existing running instance for profile", {
        existingPid: runningPrimary.pid,
        existingExecutable: runningPrimary.executablePath
      });
    }

    let launchSpec: {
      command: string;
      args: string[];
      cwd: string;
      env: NodeJS.ProcessEnv;
    };
    let codexWindowsAppUserModelId: string | null = null;
    let hansDebugPort: number | undefined;
    const settings = await getSettings();

    if (profile.engine === "antigravity") {
      await prepareAntigravityProfileEnvironment(profile);
      await writeAntigravityProfileConfig(profile);

      if (settings.antigravityChineseAiRules) {
        try {
          const added = await ensureChineseGeminiRules(getProfileGeminiDir(profile));
          if (added) {
            await log("ensured Simplified Chinese global AI rule in GEMINI.md");
          }
        } catch (ruleErr) {
          await log("failed to ensure Chinese GEMINI.md rule (continuing launch)", {
            error: ruleErr instanceof Error ? ruleErr.message : String(ruleErr)
          });
        }
      }

      if (!profile.useDefaultHome && profile.autoSyncConversationsFrom && !runningPrimary) {
        try {
          await stopOrphanProfileHelpers(profile).catch(() => undefined);
          let sourceGemini = getDefaultGeminiDir();
          if (profile.autoSyncConversationsFrom !== "default") {
            const srcProfile = await findProfile(profile.autoSyncConversationsFrom);
            if (srcProfile && srcProfile.engine === "antigravity" && srcProfile.id !== profile.id) {
              sourceGemini = getProfileGeminiDir(srcProfile);
            }
          }
          const syncRes = await syncAntigravityConversations(profile, sourceGemini, "merge");
          await log("auto-synced Antigravity conversations before launch", {
            from: profile.autoSyncConversationsFrom,
            syncedConversations: syncRes.syncedConversations,
            copiedItems: syncRes.copiedItems
          });
        } catch (syncErr) {
          await log("auto-sync conversations warning (continuing launch)", {
            error: syncErr instanceof Error ? syncErr.message : String(syncErr)
          });
        }
      }

      const resolved = resolveAntigravityApp(
        profile.paths.appPath,
        profile.antigravityVariant ?? "antigravity_app"
      );
      let executablePath = resolved.executablePath;
      if (runningPrimary?.executablePath && (await pathExists(runningPrimary.executablePath))) {
        executablePath = runningPrimary.executablePath;
      }
      if (!(await pathExists(executablePath))) {
        throw new Error(
          `未找到 Antigravity 可执行文件: ${executablePath}。请在配置详情或设置中指定正确的安装路径。`
        );
      }
      if (settings.antigravityChineseUi && !runningPrimary) {
        if (options.remoteDebuggingPort) {
          hansDebugPort = options.remoteDebuggingPort;
          await log("using parent-allocated CDP port in elevated worker", {
            port: hansDebugPort
          });
        } else {
          try {
            hansDebugPort = await allocateHansDebugPort(
              profile.id,
              profile.antigravityVariant ?? "antigravity_app"
            );
            await log("allocated CDP remote debugging port for Chinese UI localization", {
              port: hansDebugPort
            });
          } catch (portErr) {
            await log("failed to allocate CDP port for Chinese UI localization", {
              error: portErr instanceof Error ? portErr.message : String(portErr)
            });
          }
        }
      }

      launchSpec = buildAntigravityLaunchSpec(profile, executablePath, secretKey, {
        remoteDebuggingPort: hansDebugPort
      });
    } else {
      const codexConfigPath = path.join(profile.paths.profileHome, "config.toml");
      // For ChatGPT account login profiles, preserve any existing config.toml so in-app model switches stay intact
      if (profile.auth.mode !== "chatgpt_account" || !(await pathExists(codexConfigPath))) {
        await writeCodexConfig(profile, { preserveExtraSections: true });
      }
      if (requiresSecretApiKey(profile) && secretKey) {
        await writeCodexAuth(profile, secretKey);
      }

      const installedAppx =
        getRuntimePlatform() === "win32" ? findWindowsCodexAppxDesktopApp() : null;
      if (installedAppx) {
        codexWindowsAppUserModelId = `${installedAppx.packageFamilyName}!${installedAppx.applicationId}`;
      }

      let executablePath: string;
      if (
        runningPrimary?.executablePath &&
        (await pathExists(runningPrimary.executablePath)) &&
        !isWindowsAppsPath(runningPrimary.executablePath) &&
        isWindowsCodexGuiExecutable(runningPrimary.executablePath)
      ) {
        // Use the exact same cached ChatGPT.exe binary as the already-running instance so second-instance IPC matches 100%
        executablePath = runningPrimary.executablePath;
        await log("reusing running instance binary for second-instance wake", { executablePath });
      } else {
        const resolved = resolveCodexApp(profile.paths.appPath);
        executablePath = resolved.executablePath;

        if (
          getRuntimePlatform() === "win32" &&
          (!(await pathExists(executablePath)) ||
            isWindowsAppsPath(executablePath) ||
            !isWindowsCodexGuiExecutable(executablePath))
        ) {
          await log("resolving Windows AppX desktop cache", { requested: executablePath });
          const cached = await ensureWindowsAppxDesktopCache();
          if (cached) {
            executablePath = cached.cachedExecutablePath;
            await log("using Windows AppX cached binary", { executablePath });
          }
        }
      }

      if (!(await pathExists(executablePath)) || !isWindowsCodexGuiExecutable(executablePath)) {
        throw new Error(
          `未找到可用的 Codex 桌面端可执行文件: ${executablePath}。请确认已安装 Codex 桌面端（ChatGPT.exe）或在设置中指定路径。`
        );
      }
      launchSpec = buildCodexLaunchSpec(profile, executablePath, secretKey);
    }

    await generateProfileLauncher(profile);
    await log("spawning isolated process", {
      command: launchSpec.command,
      args: launchSpec.args,
      cwd: launchSpec.cwd,
      credentialScope: profile.credentialScope,
      apiKeyInjected: Boolean(secretKey),
      wakingExistingPid: runningPrimary?.pid ?? null
    });

    const outputLogPath = path.join(getProfileLogDir(profile), "desktop-output.log");
    const outFd = nodeFs.openSync(outputLogPath, "a");

    const child = spawn(launchSpec.command, launchSpec.args, {
      cwd: launchSpec.cwd,
      env: launchSpec.env,
      detached: true,
      windowsHide: false,
      stdio: ["ignore", outFd, outFd]
    });

    let earlyExit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    let spawnErr: NodeJS.ErrnoException | null = null;

    child.once("error", (err) => {
      spawnErr = err;
      try {
        nodeFs.closeSync(outFd);
      } catch {
        // ignore
      }
      void log("process spawn error", { error: err.message });
    });

    child.once("spawn", () => {
      try {
        nodeFs.closeSync(outFd);
      } catch {
        // ignore
      }
      void log("process spawned", { pid: child.pid ?? null });
    });

    child.once("exit", (code, signal) => {
      earlyExit = { code, signal };
      void log("spawned process exited", { pid: child.pid ?? null, code, signal });
    });

    child.unref();

    await new Promise((r) => setTimeout(r, runningPrimary ? 600 : 900));
    const launchError = spawnErr as NodeJS.ErrnoException | null;
    if (launchError) {
      if (
        launchError.code === "EACCES" &&
        getRuntimePlatform() === "win32" &&
        profile.engine === "antigravity" &&
        process.versions.electron &&
        !(process as NodeJS.Process & { defaultApp?: boolean }).defaultApp &&
        !options.elevatedWorker &&
        await runAntigravityAsAdministrator(profile.id, {
          executablePath: launchSpec.command,
          hansPort: hansDebugPort
        })
      ) {
        const launchedProfile = await findProfile(profile.id);
        const pid = launchedProfile?.launch.lastKnownPid ?? null;
        await log("Antigravity launched through Windows elevation", { pid, hansDebugPort });
        if (hansDebugPort) {
          void startProfileHansMonitor(
            profile.id,
            hansDebugPort,
            profile.antigravityVariant ?? "antigravity_app"
          ).then((started) =>
            log("Antigravity-Hans dynamic Chinese UI monitor status (elevated launch)", {
              port: hansDebugPort,
              started
            })
          );
        }
        return { pid, focusedExisting: Boolean(runningPrimary) };
      }
      throw launchError;
    }

    // Case 1: Waking an already-running instance (e.g. hidden in Windows system tray or behind other windows)
    if (runningPrimary) {
      if (getRuntimePlatform() === "win32") {
        const focusRes = await focusWindowsProcessWindow(runningPrimary.pid, 4500);
        await log("focused existing profile window", { ...focusRes });
      }
      await updateProfileLaunchMetadata(profile.id, runningPrimary.pid);
      if (
        profile.engine === "antigravity" &&
        settings.antigravityChineseUi &&
        !options.elevatedWorker &&
        !hasActiveHansMonitor(profile.id) &&
        runningPrimary.command
      ) {
        const existingPort = extractRemoteDebuggingPort(runningPrimary.command);
        if (existingPort) {
          void startProfileHansMonitor(
            profile.id,
            existingPort,
            profile.antigravityVariant ?? "antigravity_app"
          ).then((started) =>
            log("Antigravity-Hans re-attached to existing profile window", {
              port: existingPort,
              started
            })
          );
        }
      }
      return { pid: runningPrimary.pid, focusedExisting: true };
    }

    // Case 2: Fresh launch — wait briefly to ensure the binary did not immediately die (e.g. broken stub/crash)
    if (earlyExit) {
      const postCheck = await findRunningProfilePrimaryProcess(profile);
      if (!postCheck) {
        const exitInfo = earlyExit as { code: number | null; signal: NodeJS.Signals | null };
        throw new Error(
          `隔离窗口进程启动后立即退出 (code=${exitInfo.code}, signal=${exitInfo.signal})。目标程序: ${launchSpec.command}。请检查启动日志排查原因。`
        );
      }
      if (getRuntimePlatform() === "win32") {
        const focusRes = await focusWindowsProcessWindow(postCheck.pid, 4500);
        await log("focused newly detected profile window", { ...focusRes });
      }
      await updateProfileLaunchMetadata(profile.id, postCheck.pid);
      if (profile.engine === "antigravity" && hansDebugPort && !options.elevatedWorker) {
        void startProfileHansMonitor(
          profile.id,
          hansDebugPort,
          profile.antigravityVariant ?? "antigravity_app"
        ).then((started) =>
          log("Antigravity-Hans dynamic Chinese UI monitor status", {
            port: hansDebugPort,
            started
          })
        );
      }
      return { pid: postCheck.pid };
    }

    const spawnedPid = child.pid ?? null;
    await updateProfileLaunchMetadata(profile.id, spawnedPid);

    if (profile.engine === "antigravity" && hansDebugPort && !options.elevatedWorker) {
      void startProfileHansMonitor(
        profile.id,
        hansDebugPort,
        profile.antigravityVariant ?? "antigravity_app"
      ).then((started) =>
        log("Antigravity-Hans dynamic Chinese UI monitor status", {
          port: hansDebugPort,
          started
        })
      );
    }

    // Background Windows polish: restore native taskbar icon (AppUserModelId) & ensure window comes to foreground
    if (getRuntimePlatform() === "win32" && spawnedPid) {
      const focusWindow = async () => {
        if (codexWindowsAppUserModelId) {
          const identityRes = await restoreWindowsDesktopTaskbarIdentity(
            spawnedPid,
            codexWindowsAppUserModelId
          );
          if (identityRes) {
            await log("restored Windows desktop taskbar identity", { ...identityRes });
          }
        }
        const focusRes = await focusWindowsProcessWindow(spawnedPid, 18000);
        await log("ensured fresh profile window foreground", { ...focusRes });
      };
      if (options.elevatedWorker) {
        await focusWindow();
      } else {
        void focusWindow();
      }
    }

    return { pid: spawnedPid };
  } catch (err) {
    releaseHansDebugPort(profile.id);
    await log("openProfile failed", {
      error: err instanceof Error ? err.message : String(err)
    });
    throw err;
  }
}

export async function stopProfile(profileId: string): Promise<{ stoppedPids: number[] }> {
  stopProfileHansMonitor(profileId);
  const profile = await mustFindProfile(profileId);
  if (profile.engine === "antigravity" && getRuntimePlatform() === "win32") {
    const pid = await findTrackedElevatedAntigravityPid(profile);
    if (pid) {
      await runAntigravityAsAdministrator(profile.id, "stop");
      return { stoppedPids: [pid] };
    }
  }
  const stoppedPids = await stopProfileProcesses(profile);
  return { stoppedPids };
}

export async function syncProfileResources(
  input: SyncResourcesInput
): Promise<{ copiedItems: string[]; syncedConversations?: number }> {
  const profile = await mustFindProfile(input.profileId);
  const copiedItems: string[] = [];
  let syncedConversations: number | undefined;

  if (profile.engine === "antigravity") {
    if (profile.useDefaultHome && input.sourceType === "default") {
      throw new Error(
        "该配置已直接关联本机默认 Antigravity 主窗口，实时共享同一份聊天记录，无需手动同步。"
      );
    }

    let sourceGemini = getDefaultGeminiDir();
    if (input.sourceType === "profile" && input.sourceProfileId) {
      const src = await mustFindProfile(input.sourceProfileId);
      if (src.engine !== "antigravity") {
        throw new Error("只能从同为 Antigravity 引擎的配置同步数据。");
      }
      sourceGemini = getProfileGeminiDir(src);
    }

    if (input.syncConversations) {
      const runningTarget = await findRunningProfilePrimaryProcess(profile);
      if (runningTarget) {
        throw new Error(
          `目标窗口「${profile.name}」正在运行中 (PID ${runningTarget.pid})，请先关闭该窗口后再同步聊天记录，避免 SQLite 数据库锁定冲突。`
        );
      }
      await stopOrphanProfileHelpers(profile).catch(() => undefined);
    }

    if (input.syncConfigAndSkills) {
      copiedItems.push(...(await inheritAntigravityConfigAndSkills(profile, sourceGemini)));
    }
    if (input.syncConversations) {
      const convRes = await syncAntigravityConversations(
        profile,
        sourceGemini,
        input.syncMode ?? "merge"
      );
      copiedItems.push(...convRes.copiedItems);
      syncedConversations = convRes.syncedConversations;
    }
  } else {
    let sourceCodex = getDefaultCodexHome();
    if (input.sourceType === "profile" && input.sourceProfileId) {
      const src = await mustFindProfile(input.sourceProfileId);
      if (src.engine !== "codex") {
        throw new Error("只能从同为 Codex 引擎的配置同步数据。");
      }
      sourceCodex = src.paths.profileHome;
    }
    if (input.syncConfigAndSkills) {
      copiedItems.push(...(await inheritDefaultCodexResources(profile, sourceCodex)));
    }
    if (input.syncConversations) {
      copiedItems.push(...(await syncCodexSessionHistory(profile, sourceCodex)));
    }
  }

  return { copiedItems, syncedConversations };
}

async function countCodexSessions(codexHome: string): Promise<number> {
  const sessionsDir = path.join(codexHome, "sessions");
  if (!(await pathExists(sessionsDir))) return 0;
  let count = 0;
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        count += 1;
      }
    }
  }
  await walk(sessionsDir);
  return count;
}

export async function getProfileStats(profileId: string): Promise<ProfileConversationStats> {
  const profile = await mustFindProfile(profileId);
  if (profile.engine === "antigravity") {
    const subDirName = getProfileAntigravityDataSubdirName(profile);
    const effectiveGeminiDir = getProfileGeminiDir(profile);
    const defaultGeminiDir = getDefaultGeminiDir();
    const [conversationCount, defaultConversationCount] = await Promise.all([
      countAntigravityConversations(effectiveGeminiDir, subDirName),
      countAntigravityConversations(defaultGeminiDir, subDirName)
    ]);
    return {
      profileId: profile.id,
      conversationCount,
      defaultConversationCount,
      effectiveDataDir: path.join(effectiveGeminiDir, subDirName),
      defaultDataDir: path.join(defaultGeminiDir, subDirName)
    };
  }

  const defaultCodex = getDefaultCodexHome();
  const [conversationCount, defaultConversationCount] = await Promise.all([
    countCodexSessions(profile.paths.profileHome),
    countCodexSessions(defaultCodex)
  ]);
  return {
    profileId: profile.id,
    conversationCount,
    defaultConversationCount,
    effectiveDataDir: profile.paths.profileHome,
    defaultDataDir: defaultCodex
  };
}

export async function listProfileBackups(profileId: string): Promise<ConfigBackupItem[]> {
  const profile = await mustFindProfile(profileId);
  return profile.engine === "antigravity"
    ? listAntigravityConfigBackups(profile)
    : listCodexConfigBackups(profile);
}

export async function restoreProfileBackup(input: {
  profileId: string;
  backupPath: string;
}): Promise<{ ok: boolean }> {
  const profile = await mustFindProfile(input.profileId);
  if (profile.engine === "antigravity") {
    await restoreAntigravityConfigBackup(profile, input.backupPath);
  } else {
    await restoreCodexConfigBackup(profile, input.backupPath);
  }
  return { ok: true };
}

export async function readProfileLaunchLog(profileId: string): Promise<string> {
  const profile = await mustFindProfile(profileId);
  const logFile = path.join(getProfileLogDir(profile), "desktop-launch.log");
  if (!(await pathExists(logFile))) {
    return "暂无启动日志记录。";
  }
  const content = await fs.readFile(logFile, "utf8");
  const lines = content.trim().split(/\r?\n/);
  return lines.slice(-120).join("\n");
}

export async function testSavedProfileProvider(input: {
  profileId: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}): Promise<ProviderTestResult> {
  const profile = await mustFindProfile(input.profileId);
  const apiKey = input.apiKey?.trim() || (await getProfileSecret(profile.id)) || undefined;
  return testProviderConnection({
    engine: profile.engine,
    authMode: profile.auth.mode,
    baseUrl: input.baseUrl ?? profile.provider.baseUrl,
    apiKey,
    model: input.model ?? profile.provider.model,
    proxyUrl: profile.provider.proxyUrl
  });
}

export async function listSavedProfileModels(input: {
  profileId: string;
  baseUrl?: string;
  apiKey?: string;
}): Promise<ProviderModelsResult> {
  const profile = await mustFindProfile(input.profileId);
  const apiKey = input.apiKey?.trim() || (await getProfileSecret(profile.id)) || undefined;
  return fetchProviderModels({
    engine: profile.engine,
    authMode: profile.auth.mode,
    baseUrl: input.baseUrl ?? profile.provider.baseUrl,
    apiKey,
    model: profile.provider.model
  });
}

export async function migrateProfileStorage(
  profileId: string,
  customTargetRoot?: string
): Promise<{ profile: ProfileRecord; targetDir: string }> {
  const profile = await mustFindProfile(profileId);
  if (profile.useDefaultHome) {
    throw new Error("该配置已直接关联本机默认主窗口目录，无需执行隔离目录迁移。");
  }
  const runtime = await inspectProfilesRuntime([profile]);
  if (runtime[0]?.status === "running") {
    throw new Error("该配置实例正在运行中，请先停止该窗口后再执行跨盘迁移。");
  }

  const roots = await getEffectiveStorageRoots();
  const baseRoot =
    customTargetRoot?.trim() ||
    (profile.engine === "antigravity" ? roots.antigravityRoot : roots.codexRoot);

  const targetContainer = path.join(baseRoot, profile.id);
  const homeSubdir = profile.engine === "antigravity" ? "home" : "codex-home";
  const nextHome = path.join(targetContainer, homeSubdir);
  const nextUserData = path.join(targetContainer, "user-data");
  const nextExtensions =
    profile.engine === "antigravity" && profile.antigravityVariant === "antigravity_ide"
      ? path.join(targetContainer, "extensions")
      : undefined;

  const oldHome = profile.paths.profileHome;
  const oldUserData = profile.paths.userDataDir;
  const oldExtensions = profile.paths.extensionsDir;

  if (
    path.resolve(oldHome).toLowerCase() === path.resolve(nextHome).toLowerCase() &&
    path.resolve(oldUserData).toLowerCase() === path.resolve(nextUserData).toLowerCase()
  ) {
    return { profile, targetDir: targetContainer };
  }

  await ensureDir(targetContainer);

  if ((await pathExists(oldHome)) && path.resolve(oldHome) !== path.resolve(nextHome)) {
    await fs.cp(oldHome, nextHome, { recursive: true, force: true });
  } else {
    await ensureDir(nextHome);
  }

  if ((await pathExists(oldUserData)) && path.resolve(oldUserData) !== path.resolve(nextUserData)) {
    await fs.cp(oldUserData, nextUserData, { recursive: true, force: true });
  } else {
    await ensureDir(nextUserData);
  }

  if (nextExtensions && oldExtensions && (await pathExists(oldExtensions))) {
    await fs.cp(oldExtensions, nextExtensions, { recursive: true, force: true });
  }

  const updated = await updateProfilePathsRecord(profile.id, {
    profileHome: nextHome,
    userDataDir: nextUserData,
    ...(nextExtensions ? { extensionsDir: nextExtensions } : {})
  });
  await generateProfileLauncher(updated);

  // Clean up old C: drive directories after verified copy
  if (path.resolve(oldHome) !== path.resolve(nextHome)) {
    await fs.rm(oldHome, { recursive: true, force: true }).catch(() => undefined);
    await fs.rmdir(path.dirname(oldHome)).catch(() => undefined);
  }
  if (path.resolve(oldUserData) !== path.resolve(nextUserData)) {
    await fs.rm(oldUserData, { recursive: true, force: true }).catch(() => undefined);
    await fs.rmdir(path.dirname(oldUserData)).catch(() => undefined);
  }
  if (oldExtensions && nextExtensions && path.resolve(oldExtensions) !== path.resolve(nextExtensions)) {
    await fs.rm(oldExtensions, { recursive: true, force: true }).catch(() => undefined);
  }

  return { profile: updated, targetDir: targetContainer };
}

export async function softDeleteProfile(profileId: string): Promise<{ ok: boolean }> {
  await softDeleteProfileRecord(profileId);
  return { ok: true };
}

export async function restoreProfile(profileId: string): Promise<{ ok: boolean }> {
  await restoreProfileRecord(profileId);
  return { ok: true };
}

export async function permanentlyDeleteProfile(profileId: string): Promise<{ ok: boolean }> {
  const profile = await mustFindProfile(profileId);
  if (!profile.useDefaultHome) {
    await stopProfileProcesses(profile).catch(() => undefined);
  }
  await removeProfileRecord(profileId);
  await deleteProfileSecret(profileId);

  if (profile.engine === "antigravity" && !profile.useDefaultHome) {
    await clearAntigravityCredentialScope(profile.credentialScope);
  }

  // Never wipe native home / ~/.gemini / default AppData when deleting a default-bound profile
  const protectedDirs = new Set(
    [
      getRealHomeDir(),
      getDefaultGeminiDir(),
      getDefaultAntigravityUserDataDir("antigravity_app"),
      getDefaultAntigravityUserDataDir("antigravity_ide")
    ].map((d) => path.resolve(d).toLowerCase())
  );

  const safeRm = async (target: string | undefined) => {
    if (!target) return;
    const resolved = path.resolve(target).toLowerCase();
    if (protectedDirs.has(resolved)) return;
    await fs.rm(target, { recursive: true, force: true }).catch(() => undefined);
  };

  if (profile.useDefaultHome) {
    await safeRm(profile.paths.launcherPath);
    return { ok: true };
  }

  // Delete isolated directories (and parent <root>/<id> container if empty)
  const homeContainer = path.dirname(profile.paths.profileHome);
  const userDataContainer = path.dirname(profile.paths.userDataDir);
  await Promise.all([
    safeRm(profile.paths.profileHome),
    safeRm(profile.paths.userDataDir),
    safeRm(profile.paths.extensionsDir),
    safeRm(profile.paths.launcherPath)
  ]);
  await fs.rmdir(homeContainer).catch(() => undefined);
  await fs.rmdir(userDataContainer).catch(() => undefined);

  return { ok: true };
}

async function createLaunchLogger(profile: ProfileRecord) {
  const logDir = getProfileLogDir(profile);
  await ensureDir(logDir);
  const logPath = path.join(logDir, "desktop-launch.log");
  return async (message: string, details?: Record<string, unknown>) => {
    const line = `[${new Date().toISOString()}] ${message}${
      details ? ` ${JSON.stringify(details)}` : ""
    }\n`;
    await fs.appendFile(logPath, line, "utf8").catch(() => undefined);
  };
}
