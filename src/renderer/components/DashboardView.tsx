import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCopy,
  Download,
  FolderOpen,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Square,
  Terminal
} from "lucide-react";
import type {
  EngineType,
  EnvironmentReport,
  LanguageCode,
  ProfileRecord,
  RuntimeStatusItem
} from "@shared/types";
import { AUTH_MODE_LABELS, t } from "../i18n";

interface DashboardViewProps {
  lang: LanguageCode;
  profiles: ProfileRecord[];
  runtimeMap: Map<string, RuntimeStatusItem>;
  envReport: EnvironmentReport | null;
  legacyCandidateCount: number;
  refreshing: boolean;
  onRefresh: () => void;
  onCopyDiagnostics: () => void;
  onOpenEnvironment: () => void;
  onOpenCreate: (engine: EngineType) => void;
  onSelectProfile: (profileId: string) => void;
  onLaunchProfile: (profileId: string) => void;
  onStopProfile: (profileId: string) => void;
  onRevealPath: (targetPath: string) => void;
  onOpenLegacyImport: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  lang,
  profiles,
  runtimeMap,
  envReport,
  legacyCandidateCount,
  refreshing,
  onRefresh,
  onCopyDiagnostics,
  onOpenEnvironment,
  onOpenCreate,
  onSelectProfile,
  onLaunchProfile,
  onStopProfile,
  onRevealPath,
  onOpenLegacyImport
}) => {
  const activeProfiles = profiles.filter((p) => p.status === "active");
  const agyCount = activeProfiles.filter((p) => p.engine === "antigravity").length;
  const codexCount = activeProfiles.filter((p) => p.engine === "codex").length;
  const runningProfiles = activeProfiles.filter(
    (p) => runtimeMap.get(p.id)?.status === "running"
  );

  const failChecks = envReport?.checks.filter((c) => c.status === "fail") ?? [];
  const warnChecks = envReport?.checks.filter((c) => c.status === "warn") ?? [];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t(lang, "工作台", "Workspace Dashboard")}</h1>
          <p className="page-subtitle">
            {t(
              lang,
              "同时运行多个相互隔离的 Google Antigravity 与 OpenAI Codex 桌面实例，账号、凭证、会话与插件互不干扰。",
              "Run multiple isolated Google Antigravity & OpenAI Codex desktop instances side-by-side."
            )}
          </p>
        </div>
        <div className="btn-group">
          <button className="btn" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw size={15} />
            <span>{t(lang, "刷新状态", "Refresh")}</span>
          </button>
          <button className="btn btn-agy" onClick={() => onOpenCreate("antigravity")}>
            <Plus size={16} />
            <span>{t(lang, "新建 Antigravity 多开", "New Antigravity")}</span>
          </button>
        </div>
      </div>

      {legacyCandidateCount > 0 && (
        <div className="banner-card">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Download size={18} color="var(--agy-color)" />
            <div style={{ fontSize: 13.5 }}>
              <strong>
                {t(
                  lang,
                  `检测到本机已有 ${legacyCandidateCount} 个 Codex Profile Manager 配置`,
                  `Detected ${legacyCandidateCount} existing Codex Profile Manager profiles`
                )}
              </strong>
              <span style={{ color: "var(--text-secondary)", marginLeft: 8 }}>
                {t(
                  lang,
                  "可一键无损纳管至统一工作台，原目录与历史会话保持不变。",
                  "Import them non-destructively while keeping existing directories intact."
                )}
              </span>
            </div>
          </div>
          <button className="btn btn-primary" onClick={onOpenLegacyImport}>
            {t(lang, "立即导入", "Import Now")}
          </button>
        </div>
      )}

      <div className="quick-create-grid">
        <div className="quick-engine-card" onClick={() => onOpenCreate("antigravity")}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: "var(--agy-soft)",
                color: "var(--agy-color)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              <Sparkles size={22} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>
                {t(lang, "新建 Antigravity 多开配置", "Create Antigravity Profile")}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 3 }}>
                {t(
                  lang,
                  "独立 .gemini 目录、--user-data-dir 与系统凭据域，支持多 Google 账号 / Gemini Key / 自定义网关",
                  "Isolated .gemini, --user-data-dir & OS credential scope for Antigravity 2.0 / IDE"
                )}
              </div>
            </div>
          </div>
          <Plus size={18} color="var(--text-muted)" />
        </div>

        <div className="quick-engine-card" onClick={() => onOpenCreate("codex")}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: "var(--codex-soft)",
                color: "var(--codex-color)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              <Terminal size={22} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>
                {t(lang, "新建 Codex 多开配置", "Create Codex Profile")}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 3 }}>
                {t(
                  lang,
                  "独立 CODEX_HOME 与 --user-data-dir，支持多 ChatGPT 账号 / OpenAI Key / 第三方中转",
                  "Isolated CODEX_HOME & --user-data-dir with Store AppX compatibility"
                )}
              </div>
            </div>
          </div>
          <Plus size={18} color="var(--text-muted)" />
        </div>
      </div>

      <div className="surface-card">
        <h2 className="surface-title">{t(lang, "运行概览", "Overview")}</h2>
        <p className="surface-desc">
          {t(
            lang,
            "集中查看所有隔离配置与活跃桌面窗口，点击左侧配置可编辑认证、路径同步与快捷启动器。",
            "Monitor active isolated desktop windows and local environment readiness."
          )}
        </p>

        <div className="stats-grid">
          <div className="stat-box">
            <div className="stat-label">{t(lang, "可用配置总数", "Total Profiles")}</div>
            <div className="stat-value">{activeProfiles.length}</div>
          </div>
          <div className="stat-box">
            <div className="stat-label">Antigravity</div>
            <div className="stat-value" style={{ color: "var(--agy-color)" }}>
              {agyCount}
            </div>
          </div>
          <div className="stat-box">
            <div className="stat-label">Codex</div>
            <div className="stat-value" style={{ color: "var(--codex-color)" }}>
              {codexCount}
            </div>
          </div>
          <div className="stat-box">
            <div className="stat-label">{t(lang, "正在运行窗口", "Running Windows")}</div>
            <div className="stat-value" style={{ color: "var(--success)" }}>
              {runningProfiles.length}
            </div>
          </div>
        </div>

        <div className="env-bar">
          {failChecks.length > 0 ? (
            <button
              className="status-chip fail"
              style={{ border: "none", cursor: "pointer" }}
              onClick={onOpenEnvironment}
            >
              <AlertTriangle size={14} />
              <span>
                {t(
                  lang,
                  `环境异常 (${failChecks.length} 项需处理)`,
                  `${failChecks.length} Required Check Failed`
                )}
              </span>
            </button>
          ) : warnChecks.length > 0 ? (
            <button
              className="status-chip warn"
              style={{ border: "none", cursor: "pointer" }}
              onClick={onOpenEnvironment}
            >
              <AlertTriangle size={14} />
              <span>
                {t(
                  lang,
                  `环境就绪 (${warnChecks.length} 项可选提示)`,
                  `Ready (${warnChecks.length} optional warnings)`
                )}
              </span>
            </button>
          ) : (
            <button
              className="status-chip pass"
              style={{ border: "none", cursor: "pointer" }}
              onClick={onOpenEnvironment}
            >
              <CheckCircle2 size={14} />
              <span>{t(lang, "本地双引擎环境就绪", "All Environment Checks Passed")}</span>
            </button>
          )}

          <button className="btn" onClick={onCopyDiagnostics}>
            <ClipboardCopy size={14} />
            <span>{t(lang, "复制脱敏诊断", "Copy Diagnostics")}</span>
          </button>
        </div>
      </div>

      <div className="surface-card">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14
          }}
        >
          <h2 className="surface-title">{t(lang, "正在运行的隔离实例", "Running Instances")}</h2>
          <span className="count-pill">{runningProfiles.length}</span>
        </div>

        {runningProfiles.length === 0 ? (
          <div style={{ fontSize: 13.5, color: "var(--text-muted)", padding: "8px 0" }}>
            {t(
              lang,
              "当前暂无运行中的多开窗口。可从下方快速启动，或在左侧选择任一配置启动。",
              "No isolated windows are currently running."
            )}
          </div>
        ) : (
          <div className="running-list">
            {runningProfiles.map((profile) => {
              const rt = runtimeMap.get(profile.id);
              return (
                <div key={profile.id} className="running-row">
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
                    onClick={() => onSelectProfile(profile.id)}
                  >
                    <span className="running-dot" />
                    <div>
                      <div style={{ fontWeight: 650, fontSize: 14, display: "flex", gap: 8 }}>
                        <span>{profile.name}</span>
                        <span className={`engine-badge ${profile.engine}`}>
                          {profile.engine === "antigravity" ? "Antigravity" : "Codex"}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                        PID: {rt?.pid ?? "-"} · {AUTH_MODE_LABELS[lang][profile.auth.mode]} ·{" "}
                        {profile.provider.model}
                      </div>
                    </div>
                  </div>
                  <div className="btn-group">
                    <button
                      className="btn"
                      onClick={() => onRevealPath(profile.paths.profileHome)}
                      title={t(lang, "打开配置主目录", "Reveal Profile Home")}
                    >
                      <FolderOpen size={14} />
                    </button>
                    <button className="btn" onClick={() => onLaunchProfile(profile.id)}>
                      <Play size={14} />
                      <span>{t(lang, "唤起窗口", "Focus / Reopen")}</span>
                    </button>
                    <button className="btn btn-danger" onClick={() => onStopProfile(profile.id)}>
                      <Square size={14} />
                      <span>{t(lang, "停止", "Stop")}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
