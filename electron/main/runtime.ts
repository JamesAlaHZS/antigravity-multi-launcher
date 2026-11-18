import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ProfileRecord, RuntimeStatusItem } from "../../src/shared/types.js";
import { getRuntimePlatform } from "./paths.js";

const execFileAsync = promisify(execFile);

interface ProcessRow {
  pid: number;
  parentPid: number | null;
  command: string;
}

async function listSystemProcesses(): Promise<ProcessRow[]> {
  if (getRuntimePlatform() === "win32") {
    const script =
      "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'user-data-dir' } | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress";
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
        command: r.CommandLine as string
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

function selectPrimaryPid(matches: ProcessRow[]): number | null {
  if (matches.length === 0) return null;
  // Prefer the Electron main process (does NOT carry --type=renderer / --type=gpu-process / --type=utility)
  const mainProc = matches.find((p) => !/--type=/i.test(p.command));
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
      matchesUserDataDir(row.command, profile.paths.userDataDir)
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

export async function stopProfileProcesses(profile: ProfileRecord): Promise<number[]> {
  const processes = await listSystemProcesses();
  const matched = processes.filter((row) =>
    matchesUserDataDir(row.command, profile.paths.userDataDir)
  );
  if (matched.length === 0) {
    return [];
  }

  const primaryPid = selectPrimaryPid(matched);
  const pidsToStop = Array.from(
    new Set([
      ...(primaryPid ? [primaryPid] : []),
      ...matched.filter((m) => !/--type=/i.test(m.command)).map((m) => m.pid)
    ])
  );

  const stopped: number[] = [];
  for (const pid of pidsToStop) {
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
