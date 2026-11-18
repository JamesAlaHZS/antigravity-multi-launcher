import type { EnvironmentCheckItem, EnvironmentReport } from "../../src/shared/types.js";
import { getAntigravityLsStamp } from "./antigravity-config.js";
import { findExecutable, listWslDistros } from "./executable-lookup.js";
import { isWritableDirectory, pathExists } from "./fs-utils.js";
import {
  getAppPaths,
  getRuntimePlatform,
  resolveAntigravityApp,
  resolveAntigravityIde,
  resolveCodexApp
} from "./paths.js";
import { getEffectiveStorageRoots, getSettings } from "./registry.js";

export async function getEnvironmentReport(): Promise<EnvironmentReport> {
  const appPaths = getAppPaths();
  const [settings, roots] = await Promise.all([getSettings(), getEffectiveStorageRoots()]);
  const platform = getRuntimePlatform();

  const agyApp = resolveAntigravityApp(settings.defaultAntigravityAppPath, "antigravity_app");
  const agyIde = resolveAntigravityIde(settings.defaultAntigravityIdePath);
  const codexApp = resolveCodexApp(settings.defaultCodexAppPath);

  const [
    antigravityAppExists,
    antigravityIdeExists,
    antigravityLsStamp,
    codexAppExists,
    codexCli,
    nodeRuntime,
    wslDistros,
    launcherWritable,
    agyProfileWritable,
    codexProfileWritable,
    appDataWritable
  ] = await Promise.all([
    pathExists(agyApp.executablePath),
    pathExists(agyIde.executablePath),
    getAntigravityLsStamp(settings.defaultAntigravityAppPath),
    pathExists(codexApp.executablePath),
    findExecutable("codex"),
    findExecutable("node"),
    listWslDistros(),
    isWritableDirectory(roots.launcherRoot),
    isWritableDirectory(roots.antigravityRoot),
    isWritableDirectory(roots.codexRoot),
    isWritableDirectory(appPaths.appDataDir)
  ]);

  const checks: EnvironmentCheckItem[] = [
    {
      id: "antigravity-app",
      engine: "antigravity",
      label: "Antigravity 2.0 Desktop",
      importance: "required",
      path: agyApp.executablePath,
      status: antigravityAppExists ? "pass" : "warn",
      detail: antigravityAppExists
        ? `已检测到 Antigravity 桌面端${antigravityLsStamp ? ` (Language Server ${antigravityLsStamp})` : ""}。`
        : "未在默认路径检测到 Antigravity 2.0，可在设置或新建配置时手动指定可执行文件。"
    },
    {
      id: "antigravity-ide",
      engine: "antigravity",
      label: "Antigravity IDE (可选)",
      importance: "optional",
      path: antigravityIdeExists ? agyIde.executablePath : undefined,
      status: antigravityIdeExists ? "pass" : "warn",
      detail: antigravityIdeExists
        ? "已检测到独立版 Antigravity IDE，支持创建 IDE 专属隔离配置。"
        : "未检测到独立版 Antigravity IDE（不影响 Antigravity 2.0 多开使用）。"
    },
    {
      id: "codex-app",
      engine: "codex",
      label: "Codex / ChatGPT Desktop",
      importance: "optional",
      path: codexApp.executablePath,
      status: codexAppExists ? "pass" : "warn",
      detail: codexAppExists
        ? `已检测到 ${codexApp.productName} 桌面端。`
        : "未检测到 Codex / ChatGPT 桌面端（仅在使用 Codex 多开时需要）。"
    },
    {
      id: "codex-cli",
      engine: "codex",
      label: "Codex CLI",
      importance: "optional",
      path: codexCli.path ?? undefined,
      status: codexCli.path ? "pass" : "warn",
      detail: codexCli.path
        ? `已检测到 ${codexCli.version ?? "Codex CLI"}。`
        : "未检测到 Codex CLI，桌面端多开仍可正常工作。"
    },
    {
      id: "node-runtime",
      engine: "system",
      label: "Node.js Runtime",
      importance: "optional",
      path: nodeRuntime.path ?? undefined,
      status: nodeRuntime.path ? "pass" : "warn",
      detail: nodeRuntime.path
        ? `已检测到 ${nodeRuntime.version ?? "Node.js"}。`
        : "未检测到全局 Node.js（不影响多开启动，仅部分自定义 MCP 插件可能需要）。"
    },
    {
      id: "antigravity-profile-root",
      engine: "antigravity",
      label: "Antigravity 隔离数据目录",
      importance: "required",
      path: roots.antigravityRoot,
      status: agyProfileWritable ? "pass" : "fail",
      detail: agyProfileWritable ? "目录可正常读写。" : "目录不可写，请检查磁盘或权限。"
    },
    {
      id: "codex-profile-root",
      engine: "codex",
      label: "Codex 隔离数据目录",
      importance: "required",
      path: roots.codexRoot,
      status: codexProfileWritable ? "pass" : "fail",
      detail: codexProfileWritable ? "目录可正常读写。" : "目录不可写，请检查磁盘或权限。"
    },
    {
      id: "launcher-root",
      engine: "system",
      label: "快捷启动器输出目录",
      importance: "required",
      path: roots.launcherRoot,
      status: launcherWritable ? "pass" : "fail",
      detail: launcherWritable ? "启动器目录可正常写入。" : "启动器目录不可写。"
    },
    {
      id: "manager-data-dir",
      engine: "system",
      label: "管理器应用数据目录",
      importance: "required",
      path: appPaths.appDataDir,
      status: appDataWritable ? "pass" : "fail",
      detail: appDataWritable ? "数据目录可正常读写。" : "数据目录不可写。"
    }
  ];

  return {
    platform,
    antigravityAppPath: agyApp.appPath,
    antigravityAppExists,
    antigravityIdePath: antigravityIdeExists ? agyIde.appPath : null,
    antigravityIdeExists,
    antigravityLsStamp,
    codexAppPath: codexApp.appPath,
    codexAppExists,
    codexCliPath: codexCli.path,
    codexCliVersion: codexCli.version,
    nodePath: nodeRuntime.path,
    nodeVersion: nodeRuntime.version,
    wslDistros,
    checks
  };
}
