import { execFile } from "node:child_process";
import nodeFs from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import type { ConfigBackupItem, ProfileRecord } from "../../src/shared/types.js";
import {
  copyEntryIfExists,
  ensureDir,
  ensureDirectoryLinkOrCopy,
  pathExists,
  readJsonFile,
  writeJsonFile
} from "./fs-utils.js";
import {
  getDefaultGeminiDir,
  getLocalAppDataDir,
  getRealHomeDir,
  getRoamingAppDataDir,
  getRuntimePlatform,
  resolveAntigravityApp
} from "./paths.js";

const execFileAsync = promisify(execFile);

const INHERITED_GEMINI_CONFIG_ENTRIES = [
  "config.json",
  "mcp_config.json",
  "skills.json",
  "skills",
  "plugins",
  "sidecars"
];

export interface AntigravityConversationSyncResult {
  copiedItems: string[];
  syncedConversations: number;
}

export function getProfileGeminiDir(profile: ProfileRecord): string {
  if (profile.useDefaultHome) {
    return getDefaultGeminiDir();
  }
  return path.join(profile.paths.profileHome, ".gemini");
}

export function getProfileAntigravityDataSubdirName(profile: ProfileRecord): string {
  return profile.antigravityVariant === "antigravity_ide" ? "antigravity-ide" : "antigravity";
}

export async function prepareAntigravityProfileEnvironment(
  profile: ProfileRecord,
  options: { linkDeveloperDotfiles?: boolean } = { linkDeveloperDotfiles: true }
): Promise<void> {
  if (profile.useDefaultHome) {
    await Promise.all([
      ensureDir(getDefaultGeminiDir()),
      ensureDir(path.join(profile.paths.profileHome, "logs"))
    ]);
    return;
  }

  const geminiDir = getProfileGeminiDir(profile);
  const appDataSubdir = path.join(geminiDir, getProfileAntigravityDataSubdirName(profile));
  const configDir = path.join(geminiDir, "config");

  await Promise.all([
    ensureDir(profile.paths.profileHome),
    ensureDir(appDataSubdir),
    ensureDir(configDir),
    ensureDir(profile.paths.userDataDir),
    ...(profile.paths.extensionsDir ? [ensureDir(profile.paths.extensionsDir)] : [])
  ]);

  if (options.linkDeveloperDotfiles !== false) {
    const realHome = getRealHomeDir();
    if (path.resolve(realHome) !== path.resolve(profile.paths.profileHome)) {
      await ensureDirectoryLinkOrCopy(
        path.join(realHome, ".ssh"),
        path.join(profile.paths.profileHome, ".ssh")
      );
      await copyEntryIfExists(
        path.join(realHome, ".gitconfig"),
        path.join(profile.paths.profileHome, ".gitconfig")
      );
      await copyEntryIfExists(
        path.join(realHome, ".npmrc"),
        path.join(profile.paths.profileHome, ".npmrc")
      );
    }
  }
}

export async function writeAntigravityProfileConfig(
  profile: ProfileRecord,
  options: { createBackup?: boolean } = {}
): Promise<string> {
  const configDir = path.join(getProfileGeminiDir(profile), "config");
  const configFile = path.join(configDir, "config.json");

  // Never clobber native default Antigravity's config.json when bound directly to default home
  if (profile.useDefaultHome) {
    return configFile;
  }

  await ensureDir(configDir);
  if (options.createBackup && (await pathExists(configFile))) {
    await createAntigravityConfigBackup(profile, configFile);
  }

  const existing = await readJsonFile<Record<string, unknown>>(configFile, {});
  if (profile.provider.model?.trim()) {
    existing.defaultModel = profile.provider.model.trim();
  }
  await writeJsonFile(configFile, existing);
  return configFile;
}

export async function inheritAntigravityConfigAndSkills(
  profile: ProfileRecord,
  sourceGeminiDir = getDefaultGeminiDir()
): Promise<string[]> {
  const targetConfigDir = path.join(getProfileGeminiDir(profile), "config");
  const sourceConfigDir = path.join(sourceGeminiDir, "config");

  if (
    path.resolve(sourceConfigDir) === path.resolve(targetConfigDir) ||
    !(await pathExists(sourceConfigDir))
  ) {
    return [];
  }

  await ensureDir(targetConfigDir);
  const copied: string[] = [];
  for (const entry of INHERITED_GEMINI_CONFIG_ENTRIES) {
    const srcPath = path.join(sourceConfigDir, entry);
    const dstPath = path.join(targetConfigDir, entry);
    if (entry === "config.json" && (await pathExists(srcPath))) {
      // Copy user settings & enabled plugins, but strip main-instance sidecar project bindings & remote-control hostname
      const rawCfg = await readJsonFile<Record<string, unknown>>(srcPath, {});
      delete rawCfg.sidecars;
      if (rawCfg.userSettings && typeof rawCfg.userSettings === "object") {
        const us = { ...(rawCfg.userSettings as Record<string, unknown>) };
        delete us.remoteControlHostname;
        rawCfg.userSettings = us;
      }
      await writeJsonFile(dstPath, rawCfg);
      copied.push("config/config.json");
      continue;
    }
    const ok = await copyEntryIfExists(srcPath, dstPath);
    if (ok) {
      copied.push(`config/${entry}`);
    }
  }
  return copied;
}

function isPrimaryConversationFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (lower.endsWith("-wal") || lower.endsWith("-shm") || lower.endsWith("-journal")) {
    return false;
  }
  return lower.endsWith(".db") || lower.endsWith(".pb");
}

interface ConversationFileInfo {
  fileName: string;
  fullPath: string;
  size: number;
  mtimeMs: number;
  walPath: string | null;
  walSize: number;
  walMtimeMs: number;
  latestMtimeMs: number;
}

async function listConversationFiles(convDir: string): Promise<Map<string, ConversationFileInfo>> {
  const result = new Map<string, ConversationFileInfo>();
  if (!(await pathExists(convDir))) {
    return result;
  }
  const entries = await fs.readdir(convDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !isPrimaryConversationFile(entry.name)) {
      continue;
    }
    const fullPath = path.join(convDir, entry.name);
    const stat = await fs.stat(fullPath).catch(() => null);
    if (!stat) continue;

    let walPath: string | null = null;
    let walSize = 0;
    let walMtimeMs = 0;
    if (entry.name.toLowerCase().endsWith(".db")) {
      const candidateWal = `${fullPath}-wal`;
      const walStat = await fs.stat(candidateWal).catch(() => null);
      if (walStat && walStat.isFile()) {
        walPath = candidateWal;
        walSize = walStat.size;
        walMtimeMs = walStat.mtimeMs;
      }
    }

    result.set(entry.name, {
      fileName: entry.name,
      fullPath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      walPath,
      walSize,
      walMtimeMs,
      latestMtimeMs: Math.max(stat.mtimeMs, walMtimeMs)
    });
  }
  return result;
}

export async function countAntigravityConversations(
  geminiDir: string,
  subDirName = "antigravity"
): Promise<number> {
  const primaryDir = path.join(geminiDir, subDirName, "conversations");
  const fallbackDir = path.join(geminiDir, "antigravity", "conversations");
  const effectiveDir = (await pathExists(primaryDir)) ? primaryDir : fallbackDir;
  const files = await listConversationFiles(effectiveDir);
  return files.size;
}

async function copyFileResilient(src: string, dst: string): Promise<boolean> {
  try {
    await ensureDir(path.dirname(dst));
    await fs.copyFile(src, dst);
    return true;
  } catch {
    // Fallback to stream copy if Windows holds a shared-read handle on an active SQLite/log file
    try {
      await ensureDir(path.dirname(dst));
      await pipeline(nodeFs.createReadStream(src), nodeFs.createWriteStream(dst));
      return true;
    } catch {
      return false;
    }
  }
}

async function copyDirResilient(srcDir: string, dstDir: string): Promise<number> {
  if (!(await pathExists(srcDir))) {
    return 0;
  }
  await ensureDir(dstDir);
  let copiedCount = 0;
  const entries = await fs.readdir(srcDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copiedCount += await copyDirResilient(srcPath, dstPath);
    } else if (entry.isSymbolicLink()) {
      const realSrc = await fs.realpath(srcPath).catch(() => null);
      if (!realSrc) continue;
      const realStat = await fs.stat(realSrc).catch(() => null);
      if (!realStat) continue;
      if (realStat.isDirectory()) {
        copiedCount += await copyDirResilient(realSrc, dstPath);
      } else if (realStat.isFile()) {
        if (await copyFileResilient(realSrc, dstPath)) {
          copiedCount += 1;
        }
      }
    } else if (entry.isFile()) {
      // Skip SQLite shared-memory index files (-shm) so SQLite rebuilds them cleanly
      if (entry.name.toLowerCase().endsWith("-shm")) {
        continue;
      }
      const srcStat = await fs.stat(srcPath).catch(() => null);
      const dstStat = await fs.stat(dstPath).catch(() => null);
      if (
        dstStat &&
        srcStat &&
        dstStat.size === srcStat.size &&
        Math.abs(dstStat.mtimeMs - srcStat.mtimeMs) < 500
      ) {
        continue;
      }
      if (await copyFileResilient(srcPath, dstPath)) {
        copiedCount += 1;
      }
    }
  }
  return copiedCount;
}

async function removeSqliteSideFiles(dbPath: string): Promise<void> {
  await Promise.all([
    fs.rm(`${dbPath}-wal`, { force: true }).catch(() => undefined),
    fs.rm(`${dbPath}-shm`, { force: true }).catch(() => undefined),
    fs.rm(`${dbPath}-journal`, { force: true }).catch(() => undefined)
  ]);
}

async function syncNonSidecarProjects(
  sourceGeminiDir: string,
  targetGeminiDir: string,
  mode: "merge" | "replace"
): Promise<boolean> {
  const srcProjectsDir = path.join(sourceGeminiDir, "config", "projects");
  const dstProjectsDir = path.join(targetGeminiDir, "config", "projects");
  if (
    path.resolve(srcProjectsDir) === path.resolve(dstProjectsDir) ||
    !(await pathExists(srcProjectsDir))
  ) {
    return false;
  }

  const entries = await fs.readdir(srcProjectsDir, { withFileTypes: true }).catch(() => []);
  let copiedAny = false;
  await ensureDir(dstProjectsDir);

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const srcFile = path.join(srcProjectsDir, entry.name);
    const dstFile = path.join(dstProjectsDir, entry.name);
    const parsed = await readJsonFile<Record<string, unknown>>(srcFile, {});
    // Skip internal sidecar project bindings (e.g., swarm/swarm_board) so each profile keeps its own sidecar ID
    if (parsed && typeof parsed === "object" && "sidecar" in parsed) {
      continue;
    }
    if (mode === "merge" && (await pathExists(dstFile))) {
      const [srcStat, dstStat] = await Promise.all([
        fs.stat(srcFile).catch(() => null),
        fs.stat(dstFile).catch(() => null)
      ]);
      if (srcStat && dstStat && srcStat.mtimeMs <= dstStat.mtimeMs + 250) {
        continue;
      }
    }
    if (await copyFileResilient(srcFile, dstFile)) {
      copiedAny = true;
    }
  }
  return copiedAny;
}

export async function syncAntigravityConversations(
  profile: ProfileRecord,
  sourceGeminiDir = getDefaultGeminiDir(),
  mode: "merge" | "replace" = "merge"
): Promise<AntigravityConversationSyncResult> {
  const subDirName = getProfileAntigravityDataSubdirName(profile);
  const targetGeminiDir = getProfileGeminiDir(profile);
  const sourceDataDir = path.join(sourceGeminiDir, subDirName);
  const fallbackSourceDir = path.join(sourceGeminiDir, "antigravity");
  const effectiveSource = (await pathExists(sourceDataDir)) ? sourceDataDir : fallbackSourceDir;
  const targetDataDir = path.join(targetGeminiDir, subDirName);

  if (
    path.resolve(effectiveSource) === path.resolve(targetDataDir) ||
    !(await pathExists(effectiveSource))
  ) {
    return { copiedItems: [], syncedConversations: 0 };
  }

  await ensureDir(targetDataDir);
  const copiedItems: string[] = [];
  let syncedConversations = 0;

  // 1. Sync conversations/*.db (with safe WAL handling) and legacy *.pb files
  const sourceConvDir = path.join(effectiveSource, "conversations");
  const targetConvDir = path.join(targetDataDir, "conversations");
  await ensureDir(targetConvDir);

  const [sourceConvs, targetConvs] = await Promise.all([
    listConversationFiles(sourceConvDir),
    listConversationFiles(targetConvDir)
  ]);

  const targetUniqueNames = Array.from(targetConvs.keys()).filter((name) => !sourceConvs.has(name));
  const targetHadUniqueConversations = targetUniqueNames.length > 0;

  if (mode === "replace" && targetHadUniqueConversations) {
    for (const staleName of targetUniqueNames) {
      const stalePath = path.join(targetConvDir, staleName);
      await removeSqliteSideFiles(stalePath);
      await fs.rm(stalePath, { force: true }).catch(() => undefined);
    }
  }

  for (const [fileName, srcInfo] of sourceConvs.entries()) {
    const dstPath = path.join(targetConvDir, fileName);
    const dstInfo = targetConvs.get(fileName);

    const needsCopy =
      mode === "replace" ||
      !dstInfo ||
      srcInfo.latestMtimeMs > dstInfo.latestMtimeMs + 250 ||
      srcInfo.size !== dstInfo.size ||
      (srcInfo.walSize > 0 && srcInfo.walSize !== dstInfo.walSize);

    if (!needsCopy) {
      continue;
    }

    if (fileName.toLowerCase().endsWith(".db")) {
      await removeSqliteSideFiles(dstPath);
    }

    const copiedPrimary = await copyFileResilient(srcInfo.fullPath, dstPath);
    if (!copiedPrimary) {
      continue;
    }

    if (srcInfo.walPath && srcInfo.walSize > 0) {
      // Copy WAL without -shm so SQLite replays WAL frames cleanly on next open
      await copyFileResilient(srcInfo.walPath, `${dstPath}-wal`);
    }

    syncedConversations += 1;
  }

  if (syncedConversations > 0) {
    copiedItems.push(`${subDirName}/conversations (${syncedConversations})`);
  }

  // 2. Sync brain/ artifacts & transcripts incrementally
  const srcBrainDir = path.join(effectiveSource, "brain");
  const dstBrainDir = path.join(targetDataDir, "brain");
  if (await pathExists(srcBrainDir)) {
    if (mode === "replace" && targetHadUniqueConversations && (await pathExists(dstBrainDir))) {
      const srcBrainNames = new Set(
        (await fs.readdir(srcBrainDir).catch(() => [])).map((n) => n.toLowerCase())
      );
      const dstBrainEntries = await fs.readdir(dstBrainDir).catch(() => []);
      for (const stale of dstBrainEntries) {
        if (!srcBrainNames.has(stale.toLowerCase())) {
          await fs.rm(path.join(dstBrainDir, stale), { recursive: true, force: true }).catch(() => undefined);
        }
      }
    }
    const brainCopied = await copyDirResilient(srcBrainDir, dstBrainDir);
    if (brainCopied > 0) {
      copiedItems.push(`${subDirName}/brain`);
    }
  }

  // 3. Sync annotations/
  const srcAnnotationsDir = path.join(effectiveSource, "annotations");
  const dstAnnotationsDir = path.join(targetDataDir, "annotations");
  if (await pathExists(srcAnnotationsDir)) {
    const annCopied = await copyDirResilient(srcAnnotationsDir, dstAnnotationsDir);
    if (annCopied > 0) {
      copiedItems.push(`${subDirName}/annotations`);
    }
  }

  // 4. Sync non-sidecar project definitions (config/projects/*.json)
  if (await syncNonSidecarProjects(sourceGeminiDir, targetGeminiDir, mode)) {
    copiedItems.push("config/projects");
  }

  // 5. Reconcile conversation_summaries.db & agyhub_summaries_proto.pb
  const srcSummaryDb = path.join(effectiveSource, "conversation_summaries.db");
  const dstSummaryDb = path.join(targetDataDir, "conversation_summaries.db");
  const srcSummaryPb = path.join(effectiveSource, "agyhub_summaries_proto.pb");
  const dstSummaryPb = path.join(targetDataDir, "agyhub_summaries_proto.pb");

  await removeSqliteSideFiles(dstSummaryDb);

  if (mode === "replace" || !targetHadUniqueConversations) {
    // Target has no unique conversations outside source: copy source summary index directly for instant display + FTS
    if (await pathExists(srcSummaryDb)) {
      if (await copyFileResilient(srcSummaryDb, dstSummaryDb)) {
        const srcSummaryWal = `${srcSummaryDb}-wal`;
        const walStat = await fs.stat(srcSummaryWal).catch(() => null);
        if (walStat && walStat.isFile() && walStat.size > 0) {
          await copyFileResilient(srcSummaryWal, `${dstSummaryDb}-wal`);
        }
        copiedItems.push(`${subDirName}/conversation_summaries.db`);
      }
    }
    if (await pathExists(srcSummaryPb)) {
      if (await copyFileResilient(srcSummaryPb, dstSummaryPb)) {
        copiedItems.push(`${subDirName}/agyhub_summaries_proto.pb`);
      }
    }
  } else if (syncedConversations > 0) {
    // Merge mode with unique conversations on BOTH sides: clear cached summary DB so Antigravity's
    // background store_client reconciliation rebuilds a unified index containing both sides on next startup.
    await fs.rm(dstSummaryDb, { force: true }).catch(() => undefined);
    await fs.rm(dstSummaryPb, { force: true }).catch(() => undefined);
    copiedItems.push(`${subDirName}/summaries (reconcile-on-launch)`);
  }

  return { copiedItems, syncedConversations };
}

export async function createAntigravityConfigBackup(
  profile: ProfileRecord,
  configFilePath: string
): Promise<string> {
  const backupDir = path.join(getProfileGeminiDir(profile), "backups");
  await ensureDir(backupDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `config-${stamp}.json`);
  await fs.copyFile(configFilePath, backupPath);
  return backupPath;
}

export async function listAntigravityConfigBackups(
  profile: ProfileRecord
): Promise<ConfigBackupItem[]> {
  const backupDir = path.join(getProfileGeminiDir(profile), "backups");
  if (!(await pathExists(backupDir))) {
    return [];
  }
  const entries = await fs.readdir(backupDir, { withFileTypes: true });
  const items: ConfigBackupItem[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const fullPath = path.join(backupDir, entry.name);
    const stat = await fs.stat(fullPath);
    items.push({
      fileName: entry.name,
      backupPath: fullPath,
      createdAt: stat.mtime.toISOString(),
      sizeBytes: stat.size
    });
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function restoreAntigravityConfigBackup(
  profile: ProfileRecord,
  backupPath: string
): Promise<void> {
  const configFile = path.join(getProfileGeminiDir(profile), "config", "config.json");
  await ensureDir(path.dirname(configFile));
  await fs.copyFile(backupPath, configFile);
}

export interface AntigravityLaunchSpec {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export function buildAntigravityLaunchSpec(
  profile: ProfileRecord,
  executablePath: string,
  secretApiKey: string | null
): AntigravityLaunchSpec {
  const platform = getRuntimePlatform();
  const realHome = getRealHomeDir();
  const args: string[] = [];

  // Native default Antigravity binding: launch cleanly without overriding HOME / user-data-dir / keyring
  // so direct desktop clicks and Multi Launcher share 100% live conversations and login state.
  if (profile.useDefaultHome) {
    if (platform === "win32" && profile.provider.wslDistro !== undefined) {
      const trimmedDistro = profile.provider.wslDistro.trim();
      if (trimmedDistro) {
        args.push(`--wsl-distro=${trimmedDistro}`);
      }
    }

    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.ANTIGRAVITY_GEMINI_DIR;
    delete env.ANTIGRAVITY_CREDENTIAL_SCOPE;
    delete env.USER_DATA_DIR;

    applyCommonAntigravityEnvOverrides(env, profile, secretApiKey);

    return {
      command: executablePath,
      args,
      cwd: path.dirname(executablePath),
      env
    };
  }

  const geminiDir = getProfileGeminiDir(profile);
  const credentialScope = profile.credentialScope || `agy-profile-${profile.id}`;

  args.push(`--user-data-dir=${profile.paths.userDataDir}`);
  if (profile.antigravityVariant === "antigravity_ide" && profile.paths.extensionsDir) {
    args.push(`--extensions-dir=${profile.paths.extensionsDir}`);
  }
  if (platform === "win32" && profile.provider.wslDistro !== undefined) {
    const trimmedDistro = profile.provider.wslDistro.trim();
    if (trimmedDistro) {
      args.push(`--wsl-distro=${trimmedDistro}`);
    }
  }

  const realGitConfig = path.join(realHome, ".gitconfig");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: profile.paths.profileHome,
    ANTIGRAVITY_GEMINI_DIR: geminiDir,
    ANTIGRAVITY_CREDENTIAL_SCOPE: credentialScope,
    // Critical: Antigravity's language_server defaults to global OS Keyring (Windows Credential Manager `gemini:antigravity`),
    // which causes new windows to auto-login to the primary account and share logout state.
    // Setting SSH_CONNECTION triggers composite_token_storage's file-based token storage inside `<profileHome>/.gemini/`!
    SSH_CONNECTION: "127.0.0.1 0 127.0.0.1 22",
    USER_DATA_DIR: profile.paths.userDataDir
  };

  if (platform === "win32") {
    env.USERPROFILE = profile.paths.profileHome;
    // Keep real Windows APPDATA & LOCALAPPDATA so CLI tools (npm, pip, scoop, git) stay intact
    env.APPDATA = getRoamingAppDataDir(realHome);
    env.LOCALAPPDATA = getLocalAppDataDir(realHome);
  }

  if (!env.GIT_CONFIG_GLOBAL && fileExistsSafe(realGitConfig)) {
    env.GIT_CONFIG_GLOBAL = realGitConfig;
  }

  applyCommonAntigravityEnvOverrides(env, profile, secretApiKey);

  return {
    command: executablePath,
    args,
    cwd: path.dirname(executablePath),
    env
  };
}

function applyCommonAntigravityEnvOverrides(
  env: NodeJS.ProcessEnv,
  profile: ProfileRecord,
  secretApiKey: string | null
): void {
  if (profile.provider.googleCloudProject?.trim()) {
    env.GOOGLE_CLOUD_PROJECT = profile.provider.googleCloudProject.trim();
    env.ANTIGRAVITY_PROJECT_ID = profile.provider.googleCloudProject.trim();
  }

  if (profile.provider.proxyUrl?.trim()) {
    const proxy = profile.provider.proxyUrl.trim();
    env.HTTP_PROXY = proxy;
    env.HTTPS_PROXY = proxy;
    env.AGY_LLM_GATEWAY_PROXY_URL = proxy;
  }

  if (profile.auth.mode === "gemini_api_key" && secretApiKey) {
    env.GEMINI_API_KEY = secretApiKey;
    env[profile.provider.envKeyName] = secretApiKey;
  } else if (profile.auth.mode === "custom_gateway") {
    if (profile.provider.baseUrl?.trim()) {
      env.AGY_LLM_GATEWAY_URL = profile.provider.baseUrl.trim();
    }
    if (secretApiKey) {
      env.AGY_LLM_GATEWAY_API_KEY = secretApiKey;
      env[profile.provider.envKeyName] = secretApiKey;
    }
    if (profile.provider.model?.trim()) {
      env.AGY_LLM_GATEWAY_MODELS = profile.provider.model.trim();
    }
    if (profile.provider.wireProtocol?.trim()) {
      env.AGY_LLM_GATEWAY_WIRE_PROTOCOL = profile.provider.wireProtocol.trim();
    }
  }
}

function fileExistsSafe(filePath: string): boolean {
  try {
    return Boolean(filePath) && path.isAbsolute(filePath);
  } catch {
    return false;
  }
}

export async function clearAntigravityCredentialScope(credentialScope?: string): Promise<void> {
  if (!credentialScope || credentialScope === "antigravity") {
    return;
  }
  const target = `gemini:${credentialScope}`;
  const platform = getRuntimePlatform();
  try {
    if (platform === "win32") {
      await execFileAsync("cmdkey.exe", [`/delete:${target}`], { timeout: 3000 });
    } else if (platform === "darwin") {
      await execFileAsync("security", ["delete-generic-password", "-s", target], { timeout: 3000 });
    }
  } catch {
    // Keyring entry may not exist if user never signed into OAuth on this profile
  }
}

export async function getAntigravityLsStamp(preferredAppPath?: string): Promise<string | null> {
  const resolved = resolveAntigravityApp(preferredAppPath, "antigravity_app");
  if (resolved.source === "missing") {
    return null;
  }
  const platform = getRuntimePlatform();
  const binName = platform === "win32" ? "language_server.exe" : "language_server";
  const lsPath =
    platform === "darwin" && resolved.appPath.endsWith(".app")
      ? path.join(resolved.appPath, "Contents", "Resources", "bin", binName)
      : path.join(path.dirname(resolved.executablePath), "resources", "bin", binName);

  if (!(await pathExists(lsPath))) {
    return null;
  }
  try {
    const { stdout } = await execFileAsync(lsPath, ["--stamp"], { timeout: 4000 });
    const match = /Built at CL:\s*(\d+)/.exec(stdout);
    return match ? `CL ${match[1]}` : stdout.trim().split(/\r?\n/)[0] || "detected";
  } catch {
    return null;
  }
}
