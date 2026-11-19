import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AntigravityVariant, EngineType } from "../../src/shared/types.js";
import { fileExistsSync } from "./fs-utils.js";

export const APP_NAME = "Antigravity Multi Launcher";

export function getRuntimePlatform(): "win32" | "darwin" | "linux" {
  const override = process.env.MULTI_LAUNCHER_PLATFORM_OVERRIDE;
  if (override === "win32" || override === "darwin" || override === "linux") {
    return override;
  }
  if (process.platform === "win32" || process.platform === "linux") {
    return process.platform;
  }
  return "darwin";
}

export function getRealHomeDir(): string {
  const override = process.env.MULTI_LAUNCHER_HOME_OVERRIDE?.trim();
  if (override) {
    return path.resolve(override);
  }
  return os.homedir();
}

export function getRoamingAppDataDir(home = getRealHomeDir()): string {
  const platform = getRuntimePlatform();
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support");
  }
  if (platform === "win32") {
    if (process.env.MULTI_LAUNCHER_HOME_OVERRIDE) {
      return path.join(home, "AppData", "Roaming");
    }
    return process.env.APPDATA || path.join(home, "AppData", "Roaming");
  }
  return process.env.XDG_CONFIG_HOME || path.join(home, ".config");
}

export function getLocalAppDataDir(home = getRealHomeDir()): string {
  const platform = getRuntimePlatform();
  if (platform === "win32") {
    if (process.env.MULTI_LAUNCHER_HOME_OVERRIDE) {
      return path.join(home, "AppData", "Local");
    }
    return process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  }
  return getRoamingAppDataDir(home);
}

function resolveDefaultDataRoot(_home: string, roaming: string): string {
  const dataOverride = process.env.MULTI_LAUNCHER_DATA_DIR?.trim();
  if (dataOverride) {
    return path.resolve(dataOverride);
  }
  if (process.env.MULTI_LAUNCHER_HOME_OVERRIDE) {
    return path.join(roaming, APP_NAME);
  }
  if (getRuntimePlatform() === "win32") {
    // Prefer dedicated F:\CODEX-MULTI storage when present to save C: drive space
    if (fileExistsSync("F:\\CODEX-MULTI")) {
      return path.join("F:\\CODEX-MULTI", "LauncherData");
    }
    // Also support portable data folder beside packaged executable if non-C drive
    const exeDir = path.dirname(process.execPath);
    if (!exeDir.toUpperCase().startsWith("C:\\") && fileExistsSync(path.join(exeDir, "portable-data"))) {
      return path.join(exeDir, "portable-data");
    }
  }
  return path.join(roaming, APP_NAME);
}

function resolveDefaultAntigravityStorageRoot(home: string): string {
  if (!process.env.MULTI_LAUNCHER_HOME_OVERRIDE && getRuntimePlatform() === "win32") {
    if (fileExistsSync("F:\\antigravity")) {
      return path.join("F:\\antigravity", "profiles");
    }
    if (fileExistsSync("F:\\CODEX-MULTI")) {
      return path.join("F:\\CODEX-MULTI", "antigravity-profiles");
    }
  }
  return path.join(home, ".antigravity-profiles");
}

function resolveDefaultCodexStorageRoot(home: string): string {
  if (!process.env.MULTI_LAUNCHER_HOME_OVERRIDE && getRuntimePlatform() === "win32") {
    if (fileExistsSync("F:\\CODEX-MULTI")) {
      return path.join("F:\\CODEX-MULTI", "codex-profiles");
    }
  }
  return path.join(home, ".codex-profiles");
}

export function getAppPaths() {
  const home = getRealHomeDir();
  const roaming = getRoamingAppDataDir(home);
  const localAppData = getLocalAppDataDir(home);
  const appDataDir = resolveDefaultDataRoot(home, roaming);
  const platform = getRuntimePlatform();

  const antigravityProfileRoot = resolveDefaultAntigravityStorageRoot(home);
  const codexProfileRoot = resolveDefaultCodexStorageRoot(home);

  const isCustomAgyRoot = !antigravityProfileRoot.toLowerCase().startsWith(home.toLowerCase());
  const isCustomCodexRoot = !codexProfileRoot.toLowerCase().startsWith(home.toLowerCase());

  return {
    home,
    roaming,
    localAppData,
    appDataDir,
    settingsFile: path.join(appDataDir, "settings.json"),
    profilesFile: path.join(appDataDir, "profiles.json"),
    secretsFile: path.join(appDataDir, "secrets.enc.json"),
    masterKeyFile: path.join(appDataDir, "master.key"),
    antigravityProfileRoot,
    antigravityUserDataRoot: isCustomAgyRoot
      ? antigravityProfileRoot
      : path.join(roaming, "Antigravity Profiles"),
    codexProfileRoot,
    codexUserDataRoot: isCustomCodexRoot
      ? codexProfileRoot
      : path.join(roaming, "Codex Profiles"),
    defaultLauncherRoot:
      !process.env.MULTI_LAUNCHER_HOME_OVERRIDE &&
      platform === "win32" &&
      fileExistsSync("F:\\CODEX-MULTI")
        ? path.join("F:\\CODEX-MULTI", "Launchers")
        : platform === "win32"
          ? path.join(home, "Desktop", "AI Profiles")
          : path.join(home, "Applications", "AI Profiles")
  };
}

export function getDefaultGeminiDir(): string {
  return path.join(getRealHomeDir(), ".gemini");
}

export function getDefaultCodexHome(): string {
  return path.join(getRealHomeDir(), ".codex");
}

export function slugifyProfileName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "profile";
}

export function launcherFileName(profileName: string, engine: EngineType): string {
  const safeName = profileName.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim() || "Profile";
  const prefix = engine === "antigravity" ? "[AGY] " : "[Codex] ";
  return getRuntimePlatform() === "win32"
    ? `${prefix}${safeName}.cmd`
    : `${prefix}${safeName}.app`;
}

export interface ResolvedAppBinary {
  appPath: string;
  executablePath: string;
  productName: string;
  source: "preferred" | "auto-detected" | "missing";
}

function readMacBundleExecutable(bundlePath: string, fallbackName: string): string {
  try {
    const plist = fs.readFileSync(path.join(bundlePath, "Contents", "Info.plist"), "utf8");
    const match = plist.match(/<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/);
    const exeName = match?.[1] ?? fallbackName;
    return path.join(bundlePath, "Contents", "MacOS", exeName);
  } catch {
    return path.join(bundlePath, "Contents", "MacOS", fallbackName);
  }
}

export function resolveAntigravityApp(
  preferredPath?: string,
  variant: AntigravityVariant = "antigravity_app"
): ResolvedAppBinary {
  if (variant === "antigravity_ide") {
    return resolveAntigravityIde(preferredPath);
  }
  const platform = getRuntimePlatform();
  const home = getRealHomeDir();
  const localAppData = getLocalAppDataDir(home);

  const candidates: string[] = [];
  if (preferredPath?.trim()) {
    candidates.push(preferredPath.trim());
  }

  if (platform === "win32") {
    candidates.push(
      "F:\\antigravity\\programs\\antigravity\\Antigravity.exe",
      path.join(localAppData, "Programs", "antigravity", "Antigravity.exe"),
      process.env.PROGRAMFILES
        ? path.join(process.env.PROGRAMFILES, "Antigravity", "Antigravity.exe")
        : "",
      findRunningProcessExecutable(["Antigravity"]) ?? ""
    );
  } else if (platform === "darwin") {
    candidates.push(
      "/Applications/Antigravity.app",
      path.join(home, "Applications", "Antigravity.app")
    );
  } else {
    candidates.push(
      "/usr/bin/antigravity",
      "/opt/Antigravity/antigravity",
      path.join(home, ".local", "bin", "antigravity")
    );
  }

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (!candidate) continue;
    const resolved = checkCandidateBinary(candidate, "Antigravity");
    if (resolved) {
      return {
        ...resolved,
        source: i === 0 && preferredPath?.trim() ? "preferred" : "auto-detected"
      };
    }
  }

  const fallback =
    preferredPath?.trim() ||
    (platform === "win32"
      ? path.join(localAppData, "Programs", "antigravity", "Antigravity.exe")
      : "/Applications/Antigravity.app");
  return {
    appPath: fallback,
    executablePath:
      platform === "darwin" && fallback.endsWith(".app")
        ? path.join(fallback, "Contents", "MacOS", "Antigravity")
        : fallback,
    productName: "Antigravity",
    source: "missing"
  };
}

export function resolveAntigravityIde(preferredPath?: string): ResolvedAppBinary {
  const platform = getRuntimePlatform();
  const home = getRealHomeDir();
  const localAppData = getLocalAppDataDir(home);

  const candidates: string[] = [];
  if (preferredPath?.trim()) {
    candidates.push(preferredPath.trim());
  }

  if (platform === "win32") {
    candidates.push(
      path.join(localAppData, "Programs", "Antigravity IDE", "Antigravity IDE.exe"),
      process.env.PROGRAMFILES
        ? path.join(process.env.PROGRAMFILES, "Antigravity IDE", "Antigravity IDE.exe")
        : ""
    );
  } else if (platform === "darwin") {
    candidates.push(
      "/Applications/Antigravity IDE.app",
      path.join(home, "Applications", "Antigravity IDE.app")
    );
  } else {
    candidates.push(
      path.join(home, ".local", "share", "antigravity-ide", "antigravity-ide"),
      path.join(home, "antigravity-ide", "antigravity-ide")
    );
  }

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (!candidate) continue;
    const resolved = checkCandidateBinary(candidate, "Antigravity IDE");
    if (resolved) {
      return {
        ...resolved,
        source: i === 0 && preferredPath?.trim() ? "preferred" : "auto-detected"
      };
    }
  }

  const fallback =
    preferredPath?.trim() ||
    (platform === "win32"
      ? path.join(localAppData, "Programs", "Antigravity IDE", "Antigravity IDE.exe")
      : "/Applications/Antigravity IDE.app");
  return {
    appPath: fallback,
    executablePath:
      platform === "darwin" && fallback.endsWith(".app")
        ? path.join(fallback, "Contents", "MacOS", "Antigravity IDE")
        : fallback,
    productName: "Antigravity IDE",
    source: "missing"
  };
}

function checkCandidateBinary(
  candidate: string,
  productName: string
): Omit<ResolvedAppBinary, "source"> | null {
  const platform = getRuntimePlatform();
  if (platform === "darwin" && candidate.toLowerCase().endsWith(".app")) {
    const exe = readMacBundleExecutable(candidate, productName);
    if (fileExistsSync(exe)) {
      return { appPath: candidate, executablePath: exe, productName };
    }
    return null;
  }
  if (fileExistsSync(candidate)) {
    const stat = fs.statSync(candidate);
    if (stat.isFile()) {
      return { appPath: candidate, executablePath: candidate, productName };
    }
    if (stat.isDirectory() && platform === "win32") {
      const preferredOrder =
        productName === "Codex" || productName === "ChatGPT"
          ? ["ChatGPT.exe", "Codex.exe"]
          : [`${productName}.exe`, "Antigravity.exe", "ChatGPT.exe", "Codex.exe"];
      for (const exeName of preferredOrder) {
        const inner = path.join(candidate, exeName);
        if (fileExistsSync(inner)) {
          return { appPath: candidate, executablePath: inner, productName };
        }
      }
    }
  }
  return null;
}

export function isWindowsAppsPath(candidatePath: string): boolean {
  if (getRuntimePlatform() !== "win32") {
    return false;
  }
  return candidatePath.replace(/\\/g, "/").toLowerCase().includes("/windowsapps/");
}

const MIN_WINDOWS_CODEX_GUI_EXE_BYTES = 200 * 1024;

export function isWindowsCodexGuiExecutable(candidatePath: string): boolean {
  if (getRuntimePlatform() !== "win32") {
    return true;
  }
  const base = path.basename(candidatePath).toLowerCase();
  if (base !== "codex.exe" && base !== "chatgpt.exe") {
    return false;
  }
  const normalized = candidatePath.replace(/\\/g, "/").toLowerCase();
  if (normalized.includes("/resources/") || normalized.includes("/bin/")) {
    return false;
  }
  // If the file exists on disk, verify it is not a 0-byte Store alias or the ~20KB windows_update_trampoline Codex.exe
  try {
    if (fs.existsSync(candidatePath)) {
      const stat = fs.statSync(candidatePath);
      if (!stat.isFile() || stat.size < MIN_WINDOWS_CODEX_GUI_EXE_BYTES) {
        return false;
      }
      // Inside OpenAI.Codex packages, app\Codex.exe is a small updater trampoline while app\ChatGPT.exe is the Electron GUI
      if (base === "codex.exe") {
        const siblingChatGpt = path.join(path.dirname(candidatePath), "ChatGPT.exe");
        if (fs.existsSync(siblingChatGpt)) {
          const siblingStat = fs.statSync(siblingChatGpt);
          if (siblingStat.isFile() && siblingStat.size >= MIN_WINDOWS_CODEX_GUI_EXE_BYTES) {
            return false;
          }
        }
      }
    }
  } catch {
    // Allow stat failure on protected WindowsApps paths; resolved later via cache
  }
  return true;
}

export interface WindowsAppxInfo {
  packageName: string;
  packageFullName: string;
  packageFamilyName: string;
  applicationId: string;
  installLocation: string;
  executablePath: string;
  productName: string;
}

export function findWindowsCodexAppxDesktopApp(): WindowsAppxInfo | null {
  if (getRuntimePlatform() !== "win32") {
    return null;
  }
  try {
    // IMPORTANT: Always check app\ChatGPT.exe BEFORE app\Codex.exe!
    // In Microsoft Store OpenAI.Codex packages, app\Codex.exe is a ~20KB windows_update_trampoline stub,
    // whereas app\ChatGPT.exe (~4.4MB) is the real Electron desktop GUI binary.
    const script =
      "$packages = @(); foreach ($pattern in 'OpenAI.Codex','OpenAI.ChatGPT','*OpenAI*Codex*','*OpenAI*ChatGPT*') { $packages += Get-AppxPackage -Name $pattern -ErrorAction SilentlyContinue }; $pkg = $packages | Where-Object { $_.Name -notmatch 'PrimaryRuntime' } | Select-Object -First 1; if ($pkg) { [xml]$manifest = Get-Content -Raw (Join-Path $pkg.InstallLocation 'AppxManifest.xml'); $ns = New-Object System.Xml.XmlNamespaceManager($manifest.NameTable); $ns.AddNamespace('f', $manifest.DocumentElement.NamespaceURI); $appId = $manifest.SelectSingleNode('/f:Package/f:Applications/f:Application', $ns).Id; foreach ($name in 'app\\ChatGPT.exe','ChatGPT.exe','app\\Codex.exe','Codex.exe') { $candidate = Join-Path $pkg.InstallLocation $name; if (Test-Path $candidate) { $len = (Get-Item $candidate -ErrorAction SilentlyContinue).Length; if ($name -match '(?i)Codex\\.exe$' -and $len -gt 0 -and $len -lt 200000) { continue }; [PSCustomObject]@{ PackageName = $pkg.Name; PackageFullName = $pkg.PackageFullName; PackageFamilyName = $pkg.PackageFamilyName; ApplicationId = $appId; InstallLocation = $pkg.InstallLocation; ExecutablePath = $candidate } | ConvertTo-Json -Compress; break } } }";
    const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000
    }).trim();
    if (!output) {
      return null;
    }
    const parsed = JSON.parse(output);
    if (!parsed.ExecutablePath) {
      return null;
    }
    return {
      packageName: parsed.PackageName,
      packageFullName: parsed.PackageFullName,
      packageFamilyName: parsed.PackageFamilyName,
      applicationId: parsed.ApplicationId,
      installLocation: parsed.InstallLocation,
      executablePath: parsed.ExecutablePath,
      productName: parsed.ExecutablePath.toLowerCase().includes("chatgpt") ? "ChatGPT" : "Codex"
    };
  } catch {
    return null;
  }
}

export function resolveCodexApp(preferredPath?: string): ResolvedAppBinary {
  const platform = getRuntimePlatform();
  const home = getRealHomeDir();
  const localAppData = getLocalAppDataDir(home);

  if (preferredPath?.trim()) {
    const candidate = preferredPath.trim();
    const resolved = checkCandidateBinary(candidate, "Codex");
    if (resolved && isWindowsCodexGuiExecutable(resolved.executablePath)) {
      return { ...resolved, source: "preferred" };
    }
    // If preferredPath pointed to the ~20KB Codex.exe trampoline, automatically repair to sibling ChatGPT.exe
    if (platform === "win32" && path.basename(candidate).toLowerCase() === "codex.exe") {
      const siblingChatGpt = path.join(path.dirname(candidate), "ChatGPT.exe");
      if (fileExistsSync(siblingChatGpt) && isWindowsCodexGuiExecutable(siblingChatGpt)) {
        return {
          appPath: siblingChatGpt,
          executablePath: siblingChatGpt,
          productName: "ChatGPT",
          source: "auto-detected"
        };
      }
    }
  }

  if (platform === "win32") {
    const winCandidates = [
      path.join(localAppData, "Programs", "ChatGPT", "ChatGPT.exe"),
      path.join(localAppData, "Programs", "Codex", "ChatGPT.exe"),
      path.join(localAppData, "Programs", "Codex", "Codex.exe"),
      findRunningProcessExecutable(["ChatGPT", "Codex"]) ?? ""
    ];
    for (const candidate of winCandidates) {
      if (candidate && fileExistsSync(candidate) && isWindowsCodexGuiExecutable(candidate)) {
        return {
          appPath: candidate,
          executablePath: candidate,
          productName: candidate.toLowerCase().includes("chatgpt") ? "ChatGPT" : "Codex",
          source: "auto-detected"
        };
      }
    }
    const appx = findWindowsCodexAppxDesktopApp();
    if (appx) {
      return {
        appPath: appx.executablePath,
        executablePath: appx.executablePath,
        productName: appx.productName,
        source: "auto-detected"
      };
    }
  } else if (platform === "darwin") {
    for (const appBundle of ["/Applications/ChatGPT.app", "/Applications/Codex.app"]) {
      const resolved = checkCandidateBinary(appBundle, "Codex");
      if (resolved) {
        return { ...resolved, source: "auto-detected" };
      }
    }
  }

  const fallback =
    preferredPath?.trim() || (platform === "win32" ? "ChatGPT.exe" : "/Applications/ChatGPT.app");
  return {
    appPath: fallback,
    executablePath: fallback,
    productName: "Codex",
    source: "missing"
  };
}

function findRunningProcessExecutable(names: string[]): string | null {
  if (getRuntimePlatform() !== "win32") {
    return null;
  }
  try {
    const joined = names.map((n) => `'${n}'`).join(",");
    const output = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `(Get-Process -Name ${joined} -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -notmatch '(?i)\\\\(resources|bin)\\\\' } | Select-Object -First 1 -ExpandProperty Path)`
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 4000 }
    ).trim();
    return output || null;
  } catch {
    return null;
  }
}
