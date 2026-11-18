import { spawn } from "node:child_process";
import nodeFs from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  ConfigBackupItem,
  CreateProfileInput,
  ProfileRecord,
  ProviderModelsResult,
  ProviderTestResult,
  SyncResourcesInput,
  UpdateProfileInput
} from "../../src/shared/types.js";
import {
  buildAntigravityLaunchSpec,
  clearAntigravityCredentialScope,
  getProfileGeminiDir,
  inheritAntigravityConfigAndSkills,
  listAntigravityConfigBackups,
  prepareAntigravityProfileEnvironment,
  restoreAntigravityConfigBackup,
  syncAntigravityConversations,
  writeAntigravityProfileConfig
} from "./antigravity-config.js";
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
  getDefaultCodexHome,
  getDefaultGeminiDir,
  getRuntimePlatform,
  isWindowsAppsPath,
  isWindowsCodexGuiExecutable,
  resolveAntigravityApp,
  resolveCodexApp
} from "./paths.js";
import { fetchProviderModels, testProviderConnection } from "./provider-test.js";
import {
  createProfileRecord,
  findProfile,
  getEffectiveStorageRoots,
  listProfiles,
  removeProfileRecord,
  restoreProfileRecord,
  softDeleteProfileRecord,
  updateProfileLaunchMetadata,
  updateProfilePathsRecord,
  updateProfileRecord
} from "./registry.js";
import { inspectProfilesRuntime, stopProfileProcesses } from "./runtime.js";
import { deleteProfileSecret, getProfileSecret, upsertProfileSecret } from "./secrets.js";
import { ensureWindowsAppxDesktopCache } from "./windows-appx-cache.js";

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
      if (input.inheritDefaultConfig) {
        await inheritAntigravityConfigAndSkills(profile, getDefaultGeminiDir());
      }
      if (input.syncHistory?.enabled) {
        const sourceGemini = await resolveAntigravitySourceGeminiDir(input, profile);
        await syncAntigravityConversations(profile, sourceGemini);
      }
      await writeAntigravityProfileConfig(profile);
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

export async function updateProfile(
  input: UpdateProfileInput
): Promise<{ profile: ProfileRecord; launcherPath: string }> {
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
  return {
    profile,
    launcherPath: launcher.launcherPath
  };
}

export async function openProfile(profileId: string): Promise<{ pid: number | null }> {
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

    let launchSpec: {
      command: string;
      args: string[];
      cwd: string;
      env: NodeJS.ProcessEnv;
    };

    if (profile.engine === "antigravity") {
      await prepareAntigravityProfileEnvironment(profile);
      await writeAntigravityProfileConfig(profile);

      const resolved = resolveAntigravityApp(
        profile.paths.appPath,
        profile.antigravityVariant ?? "antigravity_app"
      );
      if (!(await pathExists(resolved.executablePath))) {
        throw new Error(
          `未找到 Antigravity 可执行文件: ${resolved.executablePath}。请在配置详情或设置中指定正确的安装路径。`
        );
      }
      launchSpec = buildAntigravityLaunchSpec(profile, resolved.executablePath, secretKey);
    } else {
      await writeCodexConfig(profile, { preserveExtraSections: true });
      if (requiresSecretApiKey(profile) && secretKey) {
        await writeCodexAuth(profile, secretKey);
      }

      const resolved = resolveCodexApp(profile.paths.appPath);
      let executablePath = resolved.executablePath;

      if (
        getRuntimePlatform() === "win32" &&
        (!(await pathExists(executablePath)) || isWindowsAppsPath(executablePath))
      ) {
        await log("resolving Windows AppX desktop cache", { requested: executablePath });
        const cached = await ensureWindowsAppxDesktopCache();
        if (cached) {
          executablePath = cached.cachedExecutablePath;
          await log("using Windows AppX cached binary", { executablePath });
        }
      }

      if (!(await pathExists(executablePath)) || !isWindowsCodexGuiExecutable(executablePath)) {
        throw new Error(
          `未找到可用的 Codex 桌面端可执行文件: ${executablePath}。请确认已安装 Codex 桌面端或在设置中指定路径。`
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
      apiKeyInjected: Boolean(secretKey)
    });

    const outputLogPath = path.join(getProfileLogDir(profile), "desktop-output.log");
    const outFd = nodeFs.openSync(outputLogPath, "a");

    const child = spawn(launchSpec.command, launchSpec.args, {
      cwd: launchSpec.cwd,
      env: launchSpec.env,
      detached: true,
      stdio: ["ignore", outFd, outFd]
    });

    child.once("error", (err) => {
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

    child.unref();
    await updateProfileLaunchMetadata(profile.id, child.pid ?? null);
    return { pid: child.pid ?? null };
  } catch (err) {
    await log("openProfile failed", {
      error: err instanceof Error ? err.message : String(err)
    });
    throw err;
  }
}

export async function stopProfile(profileId: string): Promise<{ stoppedPids: number[] }> {
  const profile = await mustFindProfile(profileId);
  const stoppedPids = await stopProfileProcesses(profile);
  return { stoppedPids };
}

export async function syncProfileResources(
  input: SyncResourcesInput
): Promise<{ copiedItems: string[] }> {
  const profile = await mustFindProfile(input.profileId);
  const copiedItems: string[] = [];

  if (profile.engine === "antigravity") {
    let sourceGemini = getDefaultGeminiDir();
    if (input.sourceType === "profile" && input.sourceProfileId) {
      const src = await mustFindProfile(input.sourceProfileId);
      if (src.engine !== "antigravity") {
        throw new Error("只能从同为 Antigravity 引擎的配置同步数据。");
      }
      sourceGemini = getProfileGeminiDir(src);
    }
    if (input.syncConfigAndSkills) {
      copiedItems.push(...(await inheritAntigravityConfigAndSkills(profile, sourceGemini)));
    }
    if (input.syncConversations) {
      copiedItems.push(...(await syncAntigravityConversations(profile, sourceGemini)));
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

  return { copiedItems };
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
  await stopProfileProcesses(profile).catch(() => undefined);
  await removeProfileRecord(profileId);
  await deleteProfileSecret(profileId);

  if (profile.engine === "antigravity") {
    await clearAntigravityCredentialScope(profile.credentialScope);
  }

  // Delete isolated directories (and parent <root>/<id> container if empty)
  const homeContainer = path.dirname(profile.paths.profileHome);
  const userDataContainer = path.dirname(profile.paths.userDataDir);
  await Promise.all([
    fs.rm(profile.paths.profileHome, { recursive: true, force: true }),
    fs.rm(profile.paths.userDataDir, { recursive: true, force: true }),
    ...(profile.paths.extensionsDir
      ? [fs.rm(profile.paths.extensionsDir, { recursive: true, force: true })]
      : []),
    fs.rm(profile.paths.launcherPath, { recursive: true, force: true })
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
