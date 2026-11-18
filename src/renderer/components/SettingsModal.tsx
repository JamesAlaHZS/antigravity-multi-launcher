import React, { useState } from "react";
import { FolderOpen, Save, X } from "lucide-react";
import type { AppInfo, AppSettings, LanguageCode } from "@shared/types";
import { t } from "../i18n";

interface SettingsModalProps {
  lang: LanguageCode;
  settings: AppSettings;
  appInfo: AppInfo | null;
  onSave: (patch: Partial<AppSettings>) => Promise<void>;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  lang,
  settings,
  appInfo,
  onSave,
  onClose
}) => {
  const [language, setLanguage] = useState<LanguageCode>(settings.language);
  const [theme, setTheme] = useState<"light" | "dark">(settings.theme);
  const [agyPath, setAgyPath] = useState(settings.defaultAntigravityAppPath ?? "");
  const [agyIdePath, setAgyIdePath] = useState(settings.defaultAntigravityIdePath ?? "");
  const [codexPath, setCodexPath] = useState(settings.defaultCodexAppPath ?? "");
  const [launcherRoot, setLauncherRoot] = useState(settings.defaultLauncherRoot ?? "");

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 style={{ margin: 0, fontSize: 19 }}>
              {t(lang, "全局设置", "Global Settings")}
            </h2>
            <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--text-muted)" }}>
              {appInfo ? `${appInfo.name} v${appInfo.version} (${appInfo.platform}/${appInfo.arch})` : ""}
            </p>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="form-grid">
            <div className="form-row-2">
              <div className="field-group">
                <label className="field-label">{t(lang, "界面语言", "Language")}</label>
                <select
                  className="select-input"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as LanguageCode)}
                >
                  <option value="zh-CN">简体中文</option>
                  <option value="en">English</option>
                </select>
              </div>
              <div className="field-group">
                <label className="field-label">{t(lang, "外观主题", "Theme")}</label>
                <select
                  className="select-input"
                  value={theme}
                  onChange={(e) => setTheme(e.target.value as "light" | "dark")}
                >
                  <option value="light">{t(lang, "浅色模式 (Light)", "Light")}</option>
                  <option value="dark">{t(lang, "深色模式 (Dark)", "Dark")}</option>
                </select>
              </div>
            </div>

            <div className="field-group">
              <label className="field-label">
                {t(lang, "默认 Antigravity 2.0 路径 (留空自动检测)", "Default Antigravity 2.0 Path")}
              </label>
              <div className="input-with-btn">
                <input
                  className="text-input"
                  value={agyPath}
                  placeholder={t(lang, "自动探测", "Auto-detect")}
                  onChange={(e) => setAgyPath(e.target.value)}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    const p = await window.multiLauncher.pickExecutablePath("antigravity");
                    if (p) setAgyPath(p);
                  }}
                >
                  <FolderOpen size={14} />
                </button>
              </div>
            </div>

            <div className="field-group">
              <label className="field-label">
                {t(lang, "默认 Antigravity IDE 路径 (可选)", "Default Antigravity IDE Path")}
              </label>
              <div className="input-with-btn">
                <input
                  className="text-input"
                  value={agyIdePath}
                  placeholder={t(lang, "自动探测", "Auto-detect")}
                  onChange={(e) => setAgyIdePath(e.target.value)}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    const p = await window.multiLauncher.pickExecutablePath("antigravity");
                    if (p) setAgyIdePath(p);
                  }}
                >
                  <FolderOpen size={14} />
                </button>
              </div>
            </div>

            <div className="field-group">
              <label className="field-label">
                {t(lang, "默认 Codex 桌面端路径 (留空自动检测)", "Default Codex Desktop Path")}
              </label>
              <div className="input-with-btn">
                <input
                  className="text-input"
                  value={codexPath}
                  placeholder={t(lang, "自动探测 (含 Microsoft Store AppX)", "Auto-detect")}
                  onChange={(e) => setCodexPath(e.target.value)}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    const p = await window.multiLauncher.pickExecutablePath("codex");
                    if (p) setCodexPath(p);
                  }}
                >
                  <FolderOpen size={14} />
                </button>
              </div>
            </div>

            <div className="field-group">
              <label className="field-label">
                {t(lang, "默认快捷启动器输出目录", "Default Shortcut Launcher Directory")}
              </label>
              <div className="input-with-btn">
                <input
                  className="text-input"
                  value={launcherRoot}
                  placeholder={appInfo?.defaultLauncherRoot ?? ""}
                  onChange={(e) => setLauncherRoot(e.target.value)}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    const p = await window.multiLauncher.pickDirectory(
                      launcherRoot || appInfo?.defaultLauncherRoot
                    );
                    if (p) setLauncherRoot(p);
                  }}
                >
                  <FolderOpen size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            {t(lang, "取消", "Cancel")}
          </button>
          <button
            className="btn btn-primary"
            onClick={async () => {
              await onSave({
                language,
                theme,
                defaultAntigravityAppPath: agyPath.trim() || undefined,
                defaultAntigravityIdePath: agyIdePath.trim() || undefined,
                defaultCodexAppPath: codexPath.trim() || undefined,
                defaultLauncherRoot: launcherRoot.trim() || undefined
              });
              onClose();
            }}
          >
            <Save size={14} />
            <span>{t(lang, "保存设置", "Save")}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
