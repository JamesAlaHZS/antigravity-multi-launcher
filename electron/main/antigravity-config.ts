import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
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

const ANTIGRAVITY_CONVERSATION_ENTRIES = [
  "conversations",
  "conversation_summaries.db",
  "agyhub_summaries_proto.pb",
  "brain"
];

export function getProfileGeminiDir(profile: ProfileRecord): string {
  return path.join(profile.paths.profileHome, ".gemini");
}

export function getProfileAntigravityDataSubdirName(profile: ProfileRecord): string {
  return profile.antigravityVariant === "antigravity_ide" ? "antigravity-ide" : "antigravity";
}

export async function prepareAntigravityProfileEnvironment(
  profile: ProfileRecord,
  options: { linkDeveloperDotfiles?: boolean } = { linkDeveloperDotfiles: true }
): Promise<void> {
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
  await ensureDir(configDir);
  const configFile = path.join(configDir, "config.json");

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
    const ok = await copyEntryIfExists(
      path.join(sourceConfigDir, entry),
      path.join(targetConfigDir, entry)
    );
    if (ok) {
      copied.push(`config/${entry}`);
    }
  }
  return copied;
}

export async function syncAntigravityConversations(
  profile: ProfileRecord,
  sourceGeminiDir = getDefaultGeminiDir()
): Promise<string[]> {
  const subDirName = getProfileAntigravityDataSubdirName(profile);
  const sourceDataDir = path.join(sourceGeminiDir, subDirName);
  const fallbackSourceDir = path.join(sourceGeminiDir, "antigravity");
  const effectiveSource = (await pathExists(sourceDataDir)) ? sourceDataDir : fallbackSourceDir;
  const targetDataDir = path.join(getProfileGeminiDir(profile), subDirName);

  if (
    path.resolve(effectiveSource) === path.resolve(targetDataDir) ||
    !(await pathExists(effectiveSource))
  ) {
    return [];
  }

  await ensureDir(targetDataDir);
  const copied: string[] = [];
  for (const entry of ANTIGRAVITY_CONVERSATION_ENTRIES) {
    const ok = await copyEntryIfExists(
      path.join(effectiveSource, entry),
      path.join(targetDataDir, entry)
    );
    if (ok) {
      copied.push(`${subDirName}/${entry}`);
    }
  }
  return copied;
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
  const geminiDir = getProfileGeminiDir(profile);
  const credentialScope = profile.credentialScope || `agy-profile-${profile.id}`;

  const args: string[] = [`--user-data-dir=${profile.paths.userDataDir}`];
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

  return {
    command: executablePath,
    args,
    cwd: path.dirname(executablePath),
    env
  };
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
