import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const elevatedLaunchArg = "--elevated-antigravity-profile=";
const elevatedStopArg = "--elevated-antigravity-stop=";
const elevatedHansPortArg = "--elevated-hans-port=";

export function parseElevatedAntigravityArg(argv: string[]) {
  const stop = argv.find((value) => value.startsWith(elevatedStopArg));
  const encoded = stop?.slice(elevatedStopArg.length)
    ?? argv.find((value) => value.startsWith(elevatedLaunchArg))?.slice(elevatedLaunchArg.length);
  if (!encoded || !/^[a-z0-9_-]+$/i.test(encoded)) return null;
  const profileId = Buffer.from(encoded, "base64url").toString("utf8");
  if (!profileId) return null;
  const rawPort = argv
    .find((value) => value.startsWith(elevatedHansPortArg))
    ?.slice(elevatedHansPortArg.length);
  const parsedPort = rawPort && /^\d{4,5}$/.test(rawPort) ? Number(rawPort) : undefined;
  const hansPort =
    parsedPort && parsedPort >= 1024 && parsedPort <= 65535 ? parsedPort : undefined;
  return { profileId, stop: Boolean(stop), hansPort };
}

function powershellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function runAntigravityAsAdministrator(
  profileId: string,
  action: { executablePath: string; hansPort?: number } | "stop"
): Promise<boolean> {
  // The elevated helper reloads the profile and credentials itself. Only the profile ID
  // (and optional CDP debug port) crosses the elevation boundary in the command line.
  const argumentPrefix = action === "stop" ? elevatedStopArg : elevatedLaunchArg;
  const helperArgs = [`${argumentPrefix}${Buffer.from(profileId).toString("base64url")}`];
  if (
    action !== "stop" &&
    action.hansPort &&
    Number.isInteger(action.hansPort) &&
    action.hansPort >= 1024 &&
    action.hansPort <= 65535
  ) {
    helperArgs.push(`${elevatedHansPortArg}${action.hansPort}`);
  }
  const argumentListExpr = `@(${helperArgs.map(powershellLiteral).join(", ")})`;
  const checkCompatibility = action === "stop" ? "" : `
$target = ${powershellLiteral(action.executablePath)}
$layers = 'Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers'
$requiresElevation = $false
foreach ($hive in @([Microsoft.Win32.Registry]::CurrentUser, [Microsoft.Win32.Registry]::LocalMachine)) {
  $key = $hive.OpenSubKey($layers)
  if ($null -ne $key) {
    try {
      $requiresElevation = $requiresElevation -or (($key.GetValue($target) -split '\\s+') -contains 'RUNASADMIN')
    } finally { $key.Dispose() }
  }
}
if (-not $requiresElevation) { exit 0 }
`;
  const script = `
$ErrorActionPreference = 'Stop'
${checkCompatibility}
$helper = Start-Process -FilePath ${powershellLiteral(process.execPath)} -ArgumentList ${argumentListExpr} -Verb RunAs -PassThru
$helper.WaitForExit()
if ($helper.ExitCode -ne 0) { throw "Elevated Antigravity launcher exited with code $($helper.ExitCode)." }
Write-Output 'elevated'
`;
  const powershell = path.win32.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32\\WindowsPowerShell\\v1.0\\powershell.exe"
  );
  const { stdout } = await execFileAsync(
    powershell,
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { windowsHide: true, timeout: 120_000 }
  );
  return stdout.trim() === "elevated";
}
