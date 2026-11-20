import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { ProfileRecord, RuntimeStatusItem } from "../../src/shared/types.js";
import { getDefaultAntigravityUserDataDir, getRuntimePlatform } from "./paths.js";

const execFileAsync = promisify(execFile);

export interface ProcessRow {
  pid: number;
  parentPid: number | null;
  command: string;
  name?: string | null;
  executablePath?: string | null;
}

async function listSystemProcesses(): Promise<ProcessRow[]> {
  if (getRuntimePlatform() === "win32") {
    const script =
      "Get-CimInstance Win32_Process | Where-Object { ($_.CommandLine -match 'user-data-dir|\\.gemini|profiles|Antigravity') -and ($_.Name -notmatch 'Antigravity Multi Launcher|powershell|pwsh') } | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress";
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], {
      maxBuffer: 8 * 1024 * 1024,
      timeout: 8000
    });
    const trimmed = stdout.trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows
      .filter((r) => r && typeof r.ProcessId === "number" && typeof r.CommandLine === "string")
      .map((r) => ({
        pid: r.ProcessId as number,
        parentPid: typeof r.ParentProcessId === "number" ? r.ParentProcessId : null,
        name: typeof r.Name === "string" ? r.Name : null,
        command: r.CommandLine as string,
        executablePath: typeof r.ExecutablePath === "string" ? r.ExecutablePath : null
      }));
  }

  const { stdout } = await execFileAsync("ps", ["axo", "pid=,ppid=,command="], {
    maxBuffer: 4 * 1024 * 1024,
    timeout: 6000
  });
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line): ProcessRow | null => {
      const m = line.match(/^(\d+)\s+(\d+)\s+(.+)$/);
      if (!m) return null;
      return {
        pid: Number(m[1]),
        parentPid: Number(m[2]),
        command: m[3]
      };
    })
    .filter((r): r is ProcessRow => r !== null);
}

export function matchesUserDataDir(command: string, userDataDir: string): boolean {
  const normCmd = command.replace(/\\/g, "/").toLowerCase();
  const normDir = userDataDir.replace(/\\/g, "/").toLowerCase();
  return (
    normCmd.includes(`--user-data-dir=${normDir}`) ||
    normCmd.includes(`--user-data-dir="${normDir}"`) ||
    normCmd.includes(`--user-data-dir='${normDir}'`) ||
    normCmd.includes(`--user-data-dir ${normDir}`) ||
    normCmd.includes(`--user-data-dir "${normDir}"`)
  );
}

export function isSidecarOrShellHelper(command: string, processName?: string | null): boolean {
  const normCmd = command.replace(/\\/g, "/").toLowerCase();
  const normName = (processName ?? "").toLowerCase();
  if (
    normName === "cmd.exe" ||
    normName === "conhost.exe" ||
    normName === "powershell.exe" ||
    normName === "pwsh.exe" ||
    normName === "language_server.exe" ||
    normName === "language_server"
  ) {
    return true;
  }
  if (
    normCmd.includes("sidecar_sdk") ||
    normCmd.includes("register_loader.js") ||
    normCmd.includes("agy-node.cmd") ||
    normCmd.includes("--import=") ||
    normCmd.includes("--open-profile=") ||
    normCmd.includes("language_server")
  ) {
    return true;
  }
  return false;
}

function isManagerProcess(command: string, processName?: string | null): boolean {
  const lowerName = (processName ?? "").toLowerCase();
  const lowerCmd = command.toLowerCase();
  return (
    lowerName.includes("antigravity multi launcher") ||
    lowerCmd.includes("antigravity multi launcher")
  );
}

function isNativeDefaultAntigravityMainProcess(
  row: ProcessRow,
  variant: "antigravity_app" | "antigravity_ide"
): boolean {
  const normCmd = row.command.replace(/\\/g, "/").toLowerCase();
  if (normCmd.includes("--user-data-dir") || /--type=/i.test(normCmd)) {
    return false;
  }
  const exeBase = path
    .basename((row.executablePath || row.name || "").replace(/\\/g, "/"))
    .toLowerCase();
  if (variant === "antigravity_ide") {
    return (
      exeBase === "antigravity ide.exe" ||
      exeBase === "antigravity ide" ||
      exeBase === "antigravity-ide" ||
      normCmd.includes("antigravity ide")
    );
  }
  return (
    exeBase === "antigravity.exe" ||
    exeBase === "antigravity" ||
    (normCmd.includes("antigravity") && !normCmd.includes("antigravity ide"))
  );
}

/**
 * Matches only actual desktop GUI processes (Electron main/renderer/gpu/utility) for a profile,
 * excluding orphan background sidecar workers (`sidecar_sdk`, `agy-node.cmd`, `cmd.exe`).
 */
export function matchesProfileProcess(
  command: string,
  profile: ProfileRecord,
  meta?: { name?: string | null; executablePath?: string | null }
): boolean {
  if (isManagerProcess(command, meta?.name) || isSidecarOrShellHelper(command, meta?.name)) {
    return false;
  }

  if (profile.engine === "antigravity" && profile.useDefaultHome) {
    const variant = profile.antigravityVariant ?? "antigravity_app";
    const defaultUserData = getDefaultAntigravityUserDataDir(variant);
    if (matchesUserDataDir(command, defaultUserData)) {
      return true;
    }
    return isNativeDefaultAntigravityMainProcess(
      {
        pid: 0,
        parentPid: null,
        command,
        name: meta?.name,
        executablePath: meta?.executablePath
      },
      variant
    );
  }

  return matchesUserDataDir(command, profile.paths.userDataDir);
}

function matchesOrphanProfileHelper(row: ProcessRow, profile: ProfileRecord): boolean {
  if (profile.useDefaultHome || isManagerProcess(row.command, row.name)) {
    return false;
  }
  if (!isSidecarOrShellHelper(row.command, row.name)) {
    return false;
  }
  const normCmd = row.command.replace(/\\/g, "/").toLowerCase();
  if (normCmd.includes("--open-profile=")) {
    return false;
  }
  const normHome = profile.paths.profileHome.replace(/\\/g, "/").toLowerCase();
  const normUserData = profile.paths.userDataDir.replace(/\\/g, "/").toLowerCase();
  return (
    (Boolean(normHome) && normCmd.includes(normHome)) ||
    (Boolean(normUserData) && normCmd.includes(normUserData))
  );
}

function selectPrimaryPid(matches: ProcessRow[]): number | null {
  if (matches.length === 0) return null;
  // Prefer the Electron main process (does NOT carry --type=renderer / --type=gpu-process / --type=utility)
  const mainProc = matches.find(
    (p) => !/--type=/i.test(p.command) && !isSidecarOrShellHelper(p.command, p.name)
  );
  if (mainProc) return mainProc.pid;
  // Otherwise if child processes share a parentProcessId (which is the main Electron PID!), return parentPid
  const firstParent = matches[0].parentPid;
  if (firstParent && firstParent > 0) {
    return firstParent;
  }
  return matches[0].pid;
}

export async function inspectProfilesRuntime(
  profiles: ProfileRecord[]
): Promise<RuntimeStatusItem[]> {
  let processes: ProcessRow[];
  try {
    processes = await listSystemProcesses();
  } catch (err) {
    return profiles.map((p) => ({
      profileId: p.id,
      status: "unknown",
      pid: null,
      processCount: 0,
      detail: err instanceof Error ? err.message : "Failed to inspect system processes"
    }));
  }

  return profiles.map((profile) => {
    const matched = processes.filter((row) =>
      matchesProfileProcess(row.command, profile, {
        name: row.name,
        executablePath: row.executablePath
      })
    );
    if (matched.length === 0) {
      return {
        profileId: profile.id,
        status: "not_running",
        pid: null,
        processCount: 0,
        detail: "No active instance for this profile"
      };
    }
    const primaryPid = selectPrimaryPid(matched);
    return {
      profileId: profile.id,
      status: "running",
      pid: primaryPid,
      processCount: matched.length,
      detail: `Active (${matched.length} process${matched.length > 1 ? "es" : ""})`
    };
  });
}

export async function findRunningProfilePrimaryProcess(
  profile: ProfileRecord
): Promise<{ pid: number; executablePath: string | null } | null> {
  try {
    const processes = await listSystemProcesses();
    const matched = processes.filter((row) =>
      matchesProfileProcess(row.command, profile, {
        name: row.name,
        executablePath: row.executablePath
      })
    );
    if (matched.length === 0) return null;
    const primaryPid = selectPrimaryPid(matched);
    if (!primaryPid) return null;
    const primaryRow = matched.find((m) => m.pid === primaryPid) ?? matched[0];
    return {
      pid: primaryPid,
      executablePath: primaryRow.executablePath ?? null
    };
  } catch {
    return null;
  }
}

async function terminatePids(pids: number[]): Promise<number[]> {
  const stopped: number[] = [];
  for (const pid of pids) {
    try {
      if (getRuntimePlatform() === "win32") {
        await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { timeout: 5000 });
      } else {
        process.kill(pid, "SIGTERM");
      }
      stopped.push(pid);
    } catch {
      // Already exited
    }
  }
  return stopped;
}

/**
 * Cleans up orphan sidecar helpers left behind after an isolated Antigravity window closes.
 * Never touches active GUI windows or native default Antigravity processes.
 */
export async function stopOrphanProfileHelpers(profile: ProfileRecord): Promise<number[]> {
  if (profile.useDefaultHome) {
    return [];
  }
  try {
    const processes = await listSystemProcesses();
    const helpers = processes.filter((row) => matchesOrphanProfileHelper(row, profile));
    if (helpers.length === 0) return [];
    const pids = Array.from(new Set(helpers.map((h) => h.pid)));
    return terminatePids(pids);
  } catch {
    return [];
  }
}

export async function stopProfileProcesses(profile: ProfileRecord): Promise<number[]> {
  const processes = await listSystemProcesses();
  const matchedGui = processes.filter((row) =>
    matchesProfileProcess(row.command, profile, {
      name: row.name,
      executablePath: row.executablePath
    })
  );
  const matchedHelpers = profile.useDefaultHome
    ? []
    : processes.filter((row) => matchesOrphanProfileHelper(row, profile));

  if (matchedGui.length === 0 && matchedHelpers.length === 0) {
    return [];
  }

  const primaryPid = selectPrimaryPid(matchedGui);
  const pidsToStop = Array.from(
    new Set([
      ...(primaryPid ? [primaryPid] : []),
      ...matchedGui.filter((m) => !/--type=/i.test(m.command)).map((m) => m.pid),
      ...matchedHelpers.map((h) => h.pid)
    ])
  );

  return terminatePids(pidsToStop);
}
