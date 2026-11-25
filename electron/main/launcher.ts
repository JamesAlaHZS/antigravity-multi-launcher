import fs from "node:fs/promises";
import path from "node:path";
import type { ProfileRecord } from "../../src/shared/types.js";
import { normalizeProfileName } from "../../src/shared/profile-utils.js";
import { ensureDir } from "./fs-utils.js";
import { APP_NAME, getRuntimePlatform } from "./paths.js";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function cmdQuote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function getProfileLogDir(profile: ProfileRecord): string {
  return path.join(profile.paths.profileHome, "logs");
}

function managerLaunchCommand(): { executablePath: string; args: string[] } {
  const isDefaultApp = Boolean((process as NodeJS.Process & { defaultApp?: boolean }).defaultApp);
  if (!isDefaultApp) {
    return { executablePath: process.execPath, args: [] };
  }
  const appPathArg =
    process.argv[1] && !process.argv[1].startsWith("--") ? process.argv[1] : process.cwd();
  return {
    executablePath: process.execPath,
    args: [path.resolve(process.cwd(), appPathArg)]
  };
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function macInfoPlist(profile: ProfileRecord): string {
  const displayName = escapeXml(normalizeProfileName(profile.name, profile.engine) || profile.name);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>${displayName}</string>
  <key>CFBundleExecutable</key>
  <string>launcher</string>
  <key>CFBundleIdentifier</key>
  <string>com.jamesalahzs.antigravitymultilauncher.profile.${profile.id}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${displayName}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.2.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`;
}

function renderMacScript(profile: ProfileRecord): string {
  const manager = managerLaunchCommand();
  const managerArgs = manager.args.map(shellQuote).join(" ");
  const logFile = path.join(getProfileLogDir(profile), "launcher.log");
  return `#!/bin/zsh
set -euo pipefail
LOG_FILE=${shellQuote(logFile)}
mkdir -p "$(dirname "$LOG_FILE")"
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] launcher started for ${profile.id} (${profile.engine})" >> "$LOG_FILE" 2>&1
exec ${shellQuote(manager.executablePath)} ${managerArgs} ${shellQuote(`--open-profile=${profile.id}`)} >> "$LOG_FILE" 2>&1
`;
}

function renderWindowsCmdScript(profile: ProfileRecord): string {
  const manager = managerLaunchCommand();
  const managerArgs = manager.args.map(cmdQuote).join(" ");
  const logDir = getProfileLogDir(profile);
  const logFile = path.join(logDir, "launcher.log");
  return `@echo off
setlocal
chcp 65001 >nul
set "MANAGER_EXE=${manager.executablePath}"
set "LOG_DIR=${logDir}"
set "LOG_FILE=${logFile}"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
echo [%DATE% %TIME%] launcher started profile=${profile.id} engine=${profile.engine}>>"%LOG_FILE%"
if not exist "%MANAGER_EXE%" (
  echo ${APP_NAME} executable was not found: %MANAGER_EXE%
  echo ${APP_NAME} executable was not found: %MANAGER_EXE%>>"%LOG_FILE%"
  pause
  exit /b 1
)
start "" "%MANAGER_EXE%" ${managerArgs} "--open-profile=${profile.id}" >>"%LOG_FILE%" 2>&1
endlocal
`;
}

export async function generateProfileLauncher(
  profile: ProfileRecord
): Promise<{ launcherPath: string; executablePath: string }> {
  const launcherPath = profile.paths.launcherPath;
  if (getRuntimePlatform() === "win32") {
    await ensureDir(path.dirname(launcherPath));
    await fs.writeFile(launcherPath, renderWindowsCmdScript(profile), {
      encoding: "utf8",
      mode: 0o700
    });
    return { launcherPath, executablePath: launcherPath };
  }

  const contentsDir = path.join(launcherPath, "Contents");
  const macosDir = path.join(contentsDir, "MacOS");
  const executablePath = path.join(macosDir, "launcher");
  await ensureDir(macosDir);
  await fs.writeFile(path.join(contentsDir, "Info.plist"), macInfoPlist(profile), {
    encoding: "utf8",
    mode: 0o644
  });
  await fs.writeFile(executablePath, renderMacScript(profile), {
    encoding: "utf8",
    mode: 0o700
  });
  return { launcherPath, executablePath };
}
