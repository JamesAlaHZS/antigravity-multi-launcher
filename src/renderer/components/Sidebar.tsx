import React from "react";
import {
  Download,
  Home,
  Layers,
  Plus,
  Settings,
  ShieldCheck
} from "lucide-react";
import type {
  EngineType,
  LanguageCode,
  ProfileRecord,
  RuntimeStatusItem
} from "@shared/types";
import { AUTH_MODE_LABELS, t } from "../i18n";

interface SidebarProps {
  lang: LanguageCode;
  profiles: ProfileRecord[];
  runtimeMap: Map<string, RuntimeStatusItem>;
  selectedView: "dashboard" | string;
  engineFilter: "all" | EngineType;
  showDeleted: boolean;
  legacyCandidateCount: number;
  onSelectView: (view: "dashboard" | string) => void;
  onChangeEngineFilter: (filter: "all" | EngineType) => void;
  onToggleShowDeleted: (val: boolean) => void;
  onOpenCreate: (defaultEngine?: EngineType) => void;
  onOpenEnvironment: () => void;
  onOpenSettings: () => void;
  onOpenLegacyImport: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  lang,
  profiles,
  runtimeMap,
  selectedView,
  engineFilter,
  showDeleted,
  legacyCandidateCount,
  onSelectView,
  onChangeEngineFilter,
  onToggleShowDeleted,
  onOpenCreate,
  onOpenEnvironment,
  onOpenSettings,
  onOpenLegacyImport
}) => {
  const filteredProfiles = profiles.filter((p) => {
    if (!showDeleted && p.status === "deleted") return false;
    if (engineFilter !== "all" && p.engine !== engineFilter) return false;
    return true;
  });

  return (
    <aside className="sidebar">
      <div className="brand-row">
        <div className="brand-logo">
          <Layers size={22} />
        </div>
        <div>
          <div className="brand-title">
            {t(lang, "AI 多开助手", "AI Multi Launcher")}
          </div>
          <div className="brand-subtitle">
            {t(lang, "Antigravity & Codex 隔离管理", "Antigravity & Codex Profiles")}
          </div>
        </div>
      </div>

      <button
        className={`nav-item ${selectedView === "dashboard" ? "active" : ""}`}
        onClick={() => onSelectView("dashboard")}
      >
        <Home size={17} />
        <span>{t(lang, "工作台首页", "Dashboard")}</span>
      </button>

      <div className="engine-filter-tabs">
        <button
          className={`filter-tab ${engineFilter === "all" ? "active" : ""}`}
          onClick={() => onChangeEngineFilter("all")}
        >
          {t(lang, "全部", "All")}
        </button>
        <button
          className={`filter-tab ${engineFilter === "antigravity" ? "active" : ""}`}
          onClick={() => onChangeEngineFilter("antigravity")}
        >
          Antigravity
        </button>
        <button
          className={`filter-tab ${engineFilter === "codex" ? "active" : ""}`}
          onClick={() => onChangeEngineFilter("codex")}
        >
          Codex
        </button>
      </div>

      <div className="section-header-row">
        <div className="section-label">
          <span>{t(lang, "配置列表", "Profiles")}</span>
          <span className="count-pill">{filteredProfiles.length}</span>
        </div>
        <button
          className="icon-btn"
          title={t(lang, "新建隔离配置", "Create Isolated Profile")}
          onClick={() => onOpenCreate(engineFilter === "all" ? "antigravity" : engineFilter)}
        >
          <Plus size={16} />
        </button>
      </div>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={showDeleted}
          onChange={(e) => onToggleShowDeleted(e.target.checked)}
        />
        <span>{t(lang, "显示已移除配置", "Show removed profiles")}</span>
      </label>

      <div className="profile-list">
        {filteredProfiles.length === 0 ? (
          <div
            style={{
              padding: "20px 10px",
              textAlign: "center",
              fontSize: 12.5,
              color: "var(--text-muted)"
            }}
          >
            {t(
              lang,
              "暂无配置，点击右上角 + 创建 Antigravity 或 Codex 多开配置。",
              "No profiles yet. Click + to create one."
            )}
          </div>
        ) : (
          filteredProfiles.map((profile) => {
            const rt = runtimeMap.get(profile.id);
            const isRunning = rt?.status === "running";
            const badgeText =
              profile.engine === "antigravity"
                ? profile.antigravityVariant === "antigravity_ide"
                  ? "AGY IDE"
                  : "AGY 2.0"
                : "Codex";
            return (
              <button
                key={profile.id}
                className={`profile-card-item ${
                  selectedView === profile.id ? "selected" : ""
                } ${profile.status === "deleted" ? "deleted" : ""}`}
                onClick={() => onSelectView(profile.id)}
              >
                <div className="profile-card-top">
                  <div className="profile-name-wrap">
                    <span
                      className="profile-color-dot"
                      style={{ backgroundColor: profile.appearance.iconBackgroundColor }}
                    />
                    <span className="profile-item-name">{profile.name}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {isRunning && <span className="running-dot" title={`PID ${rt?.pid}`} />}
                    {profile.useDefaultHome && (
                      <span
                        className="status-chip pass"
                        style={{ fontSize: 10, padding: "1px 6px" }}
                      >
                        {t(lang, "主窗口", "Native")}
                      </span>
                    )}
                    <span className={`engine-badge ${profile.engine}`}>{badgeText}</span>
                  </div>
                </div>
                <div className="profile-item-sub">
                  <span>{AUTH_MODE_LABELS[lang][profile.auth.mode]}</span>
                  <span>·</span>
                  <span>{profile.provider.model}</span>
                </div>
              </button>
            );
          })
        )}
      </div>

      <div className="sidebar-footer">
        {legacyCandidateCount > 0 && (
          <button className="nav-item" onClick={onOpenLegacyImport}>
            <Download size={16} />
            <span>
              {t(
                lang,
                `导入已有 Codex 配置 (${legacyCandidateCount})`,
                `Import Codex (${legacyCandidateCount})`
              )}
            </span>
          </button>
        )}
        <button className="nav-item" onClick={onOpenEnvironment}>
          <ShieldCheck size={16} />
          <span>{t(lang, "环境检测", "Environment Check")}</span>
        </button>
        <button className="nav-item" onClick={onOpenSettings}>
          <Settings size={16} />
          <span>{t(lang, "全局设置", "Settings")}</span>
        </button>
      </div>
    </aside>
  );
};
