import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getRuntimePlatform } from "./paths.js";

const execFileAsync = promisify(execFile);

function powershellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function runEncodedPowerShell(script: string, timeoutMs: number): Promise<string> {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encoded
    ],
    {
      timeout: timeoutMs,
      windowsHide: true,
      encoding: "utf8"
    }
  );
  return stdout.trim();
}

export interface FocusWindowResult {
  focused: boolean;
  pid: number;
  windowHandle: string | null;
  title: string;
}

/**
 * Finds the primary top-level Electron/Chromium window for `pid` (even if hidden to system tray
 * or minimized), unhides/restores it, and brings it reliably to the Windows foreground.
 */
export async function focusWindowsProcessWindow(
  pid: number,
  timeoutMs = 5000
): Promise<FocusWindowResult> {
  if (getRuntimePlatform() !== "win32" || !pid || pid <= 0) {
    return { focused: false, pid, windowHandle: null, title: "" };
  }

  const waitSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const script = `
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class WindowActivator {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();

  private const int SW_SHOW = 5;
  private const int SW_RESTORE = 9;
  private const int GWL_STYLE = -16;
  private const int GWL_EXSTYLE = -20;
  private const int WS_CAPTION = 0x00C00000;
  private const int WS_EX_TOOLWINDOW = 0x00000080;
  private const uint GW_OWNER = 4;
  private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
  private static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
  private const uint SWP_NOMOVE = 0x0002;
  private const uint SWP_NOSIZE = 0x0001;
  private const uint SWP_SHOWWINDOW = 0x0040;

  public class Candidate {
    public IntPtr Handle;
    public string Title;
    public int Score;
  }

  public static Candidate FindBestWindow(uint targetPid) {
    Candidate best = null;
    EnumWindows((hWnd, lParam) => {
      uint pid;
      GetWindowThreadProcessId(hWnd, out pid);
      if (pid != targetPid) return true;

      // Skip owned helper popups/tool windows
      if (GetWindow(hWnd, GW_OWNER) != IntPtr.Zero) return true;

      var clsSb = new StringBuilder(256);
      GetClassName(hWnd, clsSb, 256);
      string cls = clsSb.ToString();

      var titleSb = new StringBuilder(512);
      GetWindowText(hWnd, titleSb, 512);
      string title = titleSb.ToString();

      int style = GetWindowLong(hWnd, GWL_STYLE);
      int exStyle = GetWindowLong(hWnd, GWL_EXSTYLE);
      bool isToolWindow = (exStyle & WS_EX_TOOLWINDOW) != 0;
      bool hasCaption = (style & WS_CAPTION) != 0;
      bool visible = IsWindowVisible(hWnd);

      RECT rect;
      GetWindowRect(hWnd, out rect);
      int width = Math.Max(0, rect.Right - rect.Left);
      int height = Math.Max(0, rect.Bottom - rect.Top);

      // Ignore invisible tiny message-only / Chromium helper windows
      if (!visible && !hasCaption && title.Length == 0) return true;
      if (isToolWindow && title.Length == 0) return true;
      if (width < 200 && height < 150 && !IsIconic(hWnd)) return true;

      int score = 0;
      if (cls.Contains("Chrome_WidgetWin_1")) score += 50;
      if (visible) score += 30;
      if (hasCaption) score += 20;
      if (title.Length > 0) score += 25;
      if (!isToolWindow) score += 15;
      if (width >= 400 && height >= 300) score += 20;

      if (best == null || score > best.Score) {
        best = new Candidate { Handle = hWnd, Title = title, Score = score };
      }
      return true;
    }, IntPtr.Zero);
    return best;
  }

  public static bool Activate(IntPtr hWnd, int targetPid) {
    if (hWnd == IntPtr.Zero) return false;
    AllowSetForegroundWindow(targetPid);
    if (IsIconic(hWnd)) {
      ShowWindow(hWnd, SW_RESTORE);
    } else if (!IsWindowVisible(hWnd)) {
      ShowWindow(hWnd, SW_SHOW);
      ShowWindow(hWnd, SW_RESTORE);
    }

    IntPtr fg = GetForegroundWindow();
    uint fgTid = 0;
    if (fg != IntPtr.Zero) {
      uint dummy;
      fgTid = GetWindowThreadProcessId(fg, out dummy);
    }
    uint curTid = GetCurrentThreadId();
    uint targetDummy;
    uint targetTid = GetWindowThreadProcessId(hWnd, out targetDummy);

    bool attachedFg = false;
    bool attachedTarget = false;
    try {
      if (fgTid != 0 && fgTid != curTid) {
        attachedFg = AttachThreadInput(curTid, fgTid, true);
      }
      if (targetTid != 0 && targetTid != curTid) {
        attachedTarget = AttachThreadInput(curTid, targetTid, true);
      }
      SetWindowPos(hWnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
      SetWindowPos(hWnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
      BringWindowToTop(hWnd);
      SetForegroundWindow(hWnd);
    } finally {
      if (attachedTarget) AttachThreadInput(curTid, targetTid, false);
      if (attachedFg) AttachThreadInput(curTid, fgTid, false);
    }
    return true;
  }
}
'@

$targetPid = ${pid}
$deadline = [DateTime]::UtcNow.AddSeconds(${waitSeconds})
$best = $null

do {
  $best = [WindowActivator]::FindBestWindow([uint32]$targetPid)
  if (-not $best) {
    Start-Sleep -Milliseconds 150
  }
} while (-not $best -and [DateTime]::UtcNow -lt $deadline)

if (-not $best) {
  [PSCustomObject]@{ focused = $false; pid = $targetPid; windowHandle = $null; title = "" } | ConvertTo-Json -Compress
  exit 0
}

$ok = [WindowActivator]::Activate($best.Handle, $targetPid)
[PSCustomObject]@{
  focused = $ok
  pid = $targetPid
  windowHandle = $best.Handle.ToInt64().ToString()
  title = $best.Title
} | ConvertTo-Json -Compress
`.trim();

  try {
    const out = await runEncodedPowerShell(script, timeoutMs + 5000);
    if (!out) {
      return { focused: false, pid, windowHandle: null, title: "" };
    }
    return JSON.parse(out) as FocusWindowResult;
  } catch {
    return { focused: false, pid, windowHandle: null, title: "" };
  }
}

export interface TaskbarIdentityResult {
  pid: number;
  windowHandle: string;
  appUserModelId: string;
}

/**
 * Sets PKEY_AppUserModel_ID on a newly spawned Codex desktop window running from WindowsAppsCache
 * so Windows displays the proper Codex taskbar icon and window identity.
 */
export async function restoreWindowsDesktopTaskbarIdentity(
  pid: number,
  appUserModelId: string
): Promise<TaskbarIdentityResult | null> {
  if (getRuntimePlatform() !== "win32" || !pid || !appUserModelId) {
    return null;
  }

  const script = `
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class CodexTaskbarIdentity {
  [StructLayout(LayoutKind.Sequential, Pack = 4)]
  private struct PropertyKey {
    public Guid formatId;
    public uint propertyId;
    public PropertyKey(Guid formatId, uint propertyId) {
      this.formatId = formatId;
      this.propertyId = propertyId;
    }
  }

  [StructLayout(LayoutKind.Explicit)]
  private struct PropVariant {
    [FieldOffset(0)] public ushort valueType;
    [FieldOffset(8)] public IntPtr pointerValue;
  }

  [ComImport]
  [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IPropertyStore {
    [PreserveSig] int GetCount(out uint propertyCount);
    [PreserveSig] int GetAt(uint propertyIndex, out PropertyKey key);
    [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
    [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
    [PreserveSig] int Commit();
  }

  [DllImport("shell32.dll", PreserveSig = true)]
  private static extern int SHGetPropertyStoreForWindow(
    IntPtr windowHandle,
    ref Guid interfaceId,
    [Out, MarshalAs(UnmanagedType.Interface)] out IPropertyStore propertyStore
  );

  [DllImport("ole32.dll", PreserveSig = true)]
  private static extern int PropVariantClear(ref PropVariant value);

  public static void SetWindowAppUserModelId(IntPtr windowHandle, string appUserModelId) {
    Guid interfaceId = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
    IPropertyStore propertyStore;
    Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(windowHandle, ref interfaceId, out propertyStore));

    PropertyKey key = new PropertyKey(new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), 5);
    PropVariant val = new PropVariant {
      valueType = 31,
      pointerValue = Marshal.StringToCoTaskMemUni(appUserModelId)
    };

    try {
      Marshal.ThrowExceptionForHR(propertyStore.SetValue(ref key, ref val));
      Marshal.ThrowExceptionForHR(propertyStore.Commit());
    } finally {
      PropVariantClear(ref val);
      Marshal.ReleaseComObject(propertyStore);
    }
  }
}
'@

$rootPid = ${pid}
$appUserModelId = ${powershellLiteral(appUserModelId)}
$deadline = [DateTime]::UtcNow.AddSeconds(25)
$target = $null

do {
  $candidate = Get-Process -Id $rootPid -ErrorAction SilentlyContinue
  if (-not $candidate) {
    exit 0
  }
  $candidate.Refresh()
  if ($candidate.MainWindowHandle -ne 0) {
    $target = $candidate
  } else {
    Start-Sleep -Milliseconds 200
  }
} while (-not $target -and [DateTime]::UtcNow -lt $deadline)

if (-not $target -or $target.MainWindowHandle -eq 0) {
  exit 0
}

[CodexTaskbarIdentity]::SetWindowAppUserModelId($target.MainWindowHandle, $appUserModelId)
[PSCustomObject]@{
  pid = $target.Id
  windowHandle = $target.MainWindowHandle.ToString()
  appUserModelId = $appUserModelId
} | ConvertTo-Json -Compress
`.trim();

  try {
    const out = await runEncodedPowerShell(script, 30000);
    if (!out) return null;
    return JSON.parse(out) as TaskbarIdentityResult;
  } catch {
    return null;
  }
}
