import fs from "node:fs/promises";
import path from "node:path";
import type { ConfigBackupItem, ProfileRecord } from "../../src/shared/types.js";
import { copyEntryIfExists, ensureDir, pathExists } from "./fs-utils.js";
import { getDefaultCodexHome } from "./paths.js";

const INHERITED_CODEX_ENTRIES = [
  "AGENTS.md",
  "instructions.md",
  "config.json",
  "mcp.json",
  "skills",
  "plugins"
];

const CODEX_SESSION_ENTRIES = [
  "sessions",
  "archived_sessions",
  "session_index.jsonl",
  "history.jsonl",
  "state_5.sqlite",
  "sqlite"
];

function tomlString(value: string): string {
  return JSON.stringify(value);
}

export function renderCodexConfigToml(profile: ProfileRecord): string {
  const model = profile.provider.model || "gpt-5.2";
  const effort = profile.provider.reasoningEffort || "medium";
  const lines: string[] = [];

  if (profile.auth.mode === "third_party_responses") {
    lines.push(`model_provider = "proxy"`);
  }
  lines.push(`model = ${tomlString(model)}`);
  lines.push(`model_reasoning_effort = ${tomlString(effort)}`);
  lines.push("");

  if (profile.auth.mode === "third_party_responses") {
    lines.push(
      `[model_providers.proxy]`,
      `name = ${tomlString(profile.provider.displayName || "Proxy")}`,
      `base_url = ${tomlString(profile.provider.baseUrl || "")}`,
      `env_key = ${tomlString(profile.provider.envKeyName)}`,
      `temp_env_key = ${tomlString(profile.provider.envKeyName)}`,
      `wire_api = "responses"`,
      `requires_openai_auth = false`,
      ""
    );
  }

  return `${lines.join("\n")}\n`;
}

export async function writeCodexConfig(
  profile: ProfileRecord,
  options: { preserveExtraSections?: boolean; createBackup?: boolean } = {}
): Promise<string> {
  await ensureDir(profile.paths.profileHome);
  const configPath = path.join(profile.paths.profileHome, "config.toml");

  if (options.createBackup && (await pathExists(configPath))) {
    await createCodexConfigBackup(profile, configPath);
  }

  let extraContent = "";
  if (options.preserveExtraSections && (await pathExists(configPath))) {
    const existing = await fs.readFile(configPath, "utf8");
    const preservedLines = extractPreservedTomlSections(existing);
    if (preservedLines) {
      extraContent = `\n${preservedLines}\n`;
    }
  }

  await fs.writeFile(configPath, `${renderCodexConfigToml(profile)}${extraContent}`, {
    encoding: "utf8",
    mode: 0o600
  });
  return configPath;
}

function extractPreservedTomlSections(tomlText: string): string {
  const lines = tomlText.split(/\r?\n/);
  const kept: string[] = [];
  let inTable = false;
  let skipTable = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[.+\]$/.test(trimmed)) {
      inTable = true;
      skipTable = trimmed.startsWith("[model_providers.");
    }
    if (inTable && !skipTable) {
      kept.push(line);
    }
  }
  return kept.join("\n").trim();
}

export async function writeCodexAuth(profile: ProfileRecord, apiKey: string): Promise<string> {
  await ensureDir(profile.paths.profileHome);
  const authPath = path.join(profile.paths.profileHome, "auth.json");
  await fs.writeFile(
    authPath,
    `${JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: apiKey }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  return authPath;
}

export async function inheritDefaultCodexResources(
  profile: ProfileRecord,
  sourceCodexHome = getDefaultCodexHome()
): Promise<string[]> {
  if (
    path.resolve(sourceCodexHome) === path.resolve(profile.paths.profileHome) ||
    !(await pathExists(sourceCodexHome))
  ) {
    return [];
  }
  await ensureDir(profile.paths.profileHome);
  const copied: string[] = [];
  for (const entry of INHERITED_CODEX_ENTRIES) {
    const ok = await copyEntryIfExists(
      path.join(sourceCodexHome, entry),
      path.join(profile.paths.profileHome, entry)
    );
    if (ok) {
      copied.push(entry);
    }
  }
  // Also preserve MCP/trusted projects from default config.toml if profile config doesn't exist yet
  const defaultToml = path.join(sourceCodexHome, "config.toml");
  const targetToml = path.join(profile.paths.profileHome, "config.toml");
  if ((await pathExists(defaultToml)) && !(await pathExists(targetToml))) {
    await fs.copyFile(defaultToml, targetToml);
    copied.push("config.toml (sections)");
  }
  return copied;
}

export async function syncCodexSessionHistory(
  profile: ProfileRecord,
  sourceCodexHome = getDefaultCodexHome()
): Promise<string[]> {
  if (
    path.resolve(sourceCodexHome) === path.resolve(profile.paths.profileHome) ||
    !(await pathExists(sourceCodexHome))
  ) {
    return [];
  }
  await ensureDir(profile.paths.profileHome);
  const copied: string[] = [];
  for (const entry of CODEX_SESSION_ENTRIES) {
    const ok = await copyEntryIfExists(
      path.join(sourceCodexHome, entry),
      path.join(profile.paths.profileHome, entry)
    );
    if (ok) {
      copied.push(entry);
    }
  }
  return copied;
}

export async function createCodexConfigBackup(
  profile: ProfileRecord,
  configPath: string
): Promise<string> {
  const backupDir = path.join(profile.paths.profileHome, "backups");
  await ensureDir(backupDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `config-${stamp}.toml`);
  await fs.copyFile(configPath, backupPath);
  return backupPath;
}

export async function listCodexConfigBackups(profile: ProfileRecord): Promise<ConfigBackupItem[]> {
  const backupDir = path.join(profile.paths.profileHome, "backups");
  if (!(await pathExists(backupDir))) {
    return [];
  }
  const entries = await fs.readdir(backupDir, { withFileTypes: true });
  const items: ConfigBackupItem[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".toml")) continue;
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

export async function restoreCodexConfigBackup(
  profile: ProfileRecord,
  backupPath: string
): Promise<void> {
  const configPath = path.join(profile.paths.profileHome, "config.toml");
  await ensureDir(path.dirname(configPath));
  await fs.copyFile(backupPath, configPath);
}

export interface CodexLaunchSpec {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export function buildCodexLaunchSpec(
  profile: ProfileRecord,
  executablePath: string,
  secretApiKey: string | null
): CodexLaunchSpec {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CODEX_HOME: profile.paths.profileHome,
    CODEX_ELECTRON_USER_DATA_PATH: profile.paths.userDataDir,
    USER_DATA_DIR: profile.paths.userDataDir
  };

  if (profile.provider.proxyUrl?.trim()) {
    const proxy = profile.provider.proxyUrl.trim();
    env.HTTP_PROXY = proxy;
    env.HTTPS_PROXY = proxy;
  }

  if (profile.auth.mode !== "chatgpt_account" && secretApiKey) {
    env[profile.provider.envKeyName] = secretApiKey;
    if (profile.auth.mode === "official_openai") {
      env.OPENAI_API_KEY = secretApiKey;
    }
  }

  return {
    command: executablePath,
    args: [`--user-data-dir=${profile.paths.userDataDir}`],
    cwd: path.dirname(executablePath),
    env
  };
}
