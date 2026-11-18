import React, { useEffect, useState } from "react";
import {
  ArchiveRestore,
  ExternalLink,
  FolderOpen,
  HardDrive,
  History,
  Play,
  RefreshCw,
  Save,
  Share2,
  Square,
  Trash2,
  Zap
} from "lucide-react";
import type {
  AppInfo,
  ConfigBackupItem,
  LanguageCode,
  ProfileAuthMode,
  ProfileRecord,
  ProviderTestResult,
  ReasoningEffort,
  RuntimeStatusItem
} from "@shared/types";
import { AUTH_MODE_LABELS, COLOR_PALETTE, t } from "../i18n";

interface ProfileDetailViewProps {
  lang: LanguageCode;
  profile: ProfileRecord;
  allProfiles: ProfileRecord[];
  appInfo: AppInfo | null;
  runtime?: RuntimeStatusItem;
  wslDistros: string[];
  onLaunch: (id: string) => void;
  onStop: (id: string) => void;
  onUpdated: () => void;
  onDeleted: () => void;
  onNotify: (msg: string) => void;
}

export const ProfileDetailView: React.FC<ProfileDetailViewProps> = ({
  lang,
  profile,
  allProfiles,
  appInfo,
  runtime,
  wslDistros,
  onLaunch,
  onStop,
  onUpdated,
  onDeleted,
  onNotify
}) => {
  const [tab, setTab] = useState<"auth" | "paths" | "logs" | "danger">("auth");

  const [name, setName] = useState(profile.name);
  const [authMode, setAuthMode] = useState<ProfileAuthMode>(profile.auth.mode);
  const [providerName, setProviderName] = useState(profile.provider.displayName);
  const [baseUrl, setBaseUrl] = useState(profile.provider.baseUrl ?? "");
  const [model, setModel] = useState(profile.provider.model);
  const [apiKey, setApiKey] = useState("");
  const [proxyUrl, setProxyUrl] = useState(profile.provider.proxyUrl ?? "");
  const [wslDistro, setWslDistro] = useState(profile.provider.wslDistro ?? "");
  const [gcpProject, setGcpProject] = useState(profile.provider.googleCloudProject ?? "");
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(
    profile.provider.reasoningEffort ?? "medium"
  );
  const [appPath, setAppPath] = useState(profile.paths.appPath);
  const [iconColor, setIconColor] = useState(profile.appearance.iconBackgroundColor);

  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
  const [modelsList, setModelsList] = useState<string[]>([]);

  const [syncSource, setSyncSource] = useState<string>("default");
  const [syncConfig, setSyncConfig] = useState<boolean>(true);
  const [syncConv, setSyncConv] = useState<boolean>(false);

  const [backups, setBackups] = useState<ConfigBackupItem[]>([]);
  const [launchLog, setLaunchLog] = useState<string>("");
  const [migrating, setMigrating] = useState<boolean>(false);

  const preferredStorageRoot =
    profile.engine === "antigravity"
      ? appInfo?.antigravityProfileRoot
      : appInfo?.codexProfileRoot;

  const isOutsidePreferredRoot = Boolean(
    preferredStorageRoot &&
      (!profile.paths.profileHome
        .toLowerCase()
        .startsWith(preferredStorageRoot.toLowerCase()) ||
        !profile.paths.userDataDir
          .toLowerCase()
          .startsWith(preferredStorageRoot.toLowerCase()))
  );

  useEffect(() => {
    setName(profile.name);
    setAuthMode(profile.auth.mode);
    setProviderName(profile.provider.displayName);
    setBaseUrl(profile.provider.baseUrl ?? "");
    setModel(profile.provider.model);
    setApiKey("");
    setProxyUrl(profile.provider.proxyUrl ?? "");
    setWslDistro(profile.provider.wslDistro ?? "");
    setGcpProject(profile.provider.googleCloudProject ?? "");
    setReasoningEffort(profile.provider.reasoningEffort ?? "medium");
    setAppPath(profile.paths.appPath);
    setIconColor(profile.appearance.iconBackgroundColor);
    setTestResult(null);
  }, [profile.id, profile.timestamps.updatedAt]);

  useEffect(() => {
    if (tab === "logs") {
      void loadBackupsAndLogs();
    }
  }, [tab, profile.id]);

  async function loadBackupsAndLogs() {
    const [b, log] = await Promise.all([
      window.multiLauncher.listConfigBackups(profile.id),
      window.multiLauncher.readProfileLaunchLog(profile.id)
    ]);
    setBackups(b);
    setLaunchLog(log);
  }

  const isRunning = runtime?.status === "running";
  const needsApiKey = authMode !== "google_account" && authMode !== "chatgpt_account";
  const needsBaseUrl = authMode === "custom_gateway" || authMode === "third_party_responses";

  const peerProfiles = allProfiles.filter(
    (p) => p.engine === profile.engine && p.id !== profile.id && p.status === "active"
  );

  async function handleSave() {
    setSaving(true);
    try {
      await window.multiLauncher.updateProfile({
        profileId: profile.id,
        name,
        appPath,
        authMode,
        provider: {
          displayName: providerName,
          baseUrl: baseUrl || undefined,
          model,
          apiKey: apiKey.trim() || undefined,
          proxyUrl: proxyUrl || undefined,
          reasoningEffort,
          wslDistro: wslDistro || undefined,
          googleCloudProject: gcpProject || undefined
        },
        appearance: {
          iconBackgroundColor: iconColor
        }
      });
      setApiKey("");
      onUpdated();
      onNotify(t(lang, "配置已保存并更新启动器", "Profile saved"));
    } catch (err) {
      onNotify(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    const res = await window.multiLauncher.testProfileProvider({
      profileId: profile.id,
      baseUrl: baseUrl || undefined,
      apiKey: apiKey.trim() || undefined,
      model
    });
    setTestResult(res);
  }

  async function handleFetchModels() {
    const res = await window.multiLauncher.listProfileProviderModels({
      profileId: profile.id,
      baseUrl: baseUrl || undefined,
      apiKey: apiKey.trim() || undefined
    });
    setModelsList(res.models);
    onNotify(res.summary);
  }

  async function handleSyncNow() {
    try {
      const res = await window.multiLauncher.syncProfileResources({
        profileId: profile.id,
        syncConfigAndSkills: syncConfig,
        syncConversations: syncConv,
        sourceType: syncSource === "default" ? "default" : "profile",
        sourceProfileId: syncSource === "default" ? undefined : syncSource
      });
      onNotify(
        res.copiedItems.length > 0
          ? `${t(lang, "已同步：", "Synced: ")}${res.copiedItems.join(", ")}`
          : t(lang, "未发现可同步的源数据文件", "No source items found to sync")
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div>
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              backgroundColor: profile.appearance.iconBackgroundColor,
              color: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: 20,
              boxShadow: "var(--shadow-md)"
            }}
          >
            {profile.name.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h1 className="page-title" style={{ fontSize: 23 }}>
                {profile.name}
              </h1>
              <span className={`engine-badge ${profile.engine}`}>
                {profile.engine === "antigravity"
                  ? profile.antigravityVariant === "antigravity_ide"
                    ? "Antigravity IDE"
                    : "Antigravity 2.0"
                  : "Codex Desktop"}
              </span>
              {isRunning && (
                <span className="status-chip pass">
                  Running (PID {runtime?.pid ?? "-"})
                </span>
              )}
              {profile.status === "deleted" && (
                <span className="status-chip fail">{t(lang, "已移入回收站", "Removed")}</span>
              )}
            </div>
            <p className="page-subtitle">
              ID: <code>{profile.id}</code> · {AUTH_MODE_LABELS[lang][profile.auth.mode]}
            </p>
          </div>
        </div>

        <div className="btn-group">
          <button
            className="btn"
            onClick={async () => {
              const res = await window.multiLauncher.generateLauncher(profile.id);
              onNotify(`${t(lang, "快捷启动器已生成：", "Launcher updated: ")}${res.launcherPath}`);
            }}
          >
            <ExternalLink size={15} />
            <span>{t(lang, "生成桌面启动器", "Rebuild Shortcut")}</span>
          </button>

          {isRunning && (
            <button className="btn btn-danger" onClick={() => onStop(profile.id)}>
              <Square size={15} />
              <span>{t(lang, "停止实例", "Stop Instance")}</span>
            </button>
          )}

          {profile.status === "active" && (
            <button className="btn btn-primary" onClick={() => onLaunch(profile.id)}>
              <Play size={15} />
              <span>
                {isRunning
                  ? t(lang, "唤起窗口", "Focus Window")
                  : t(lang, "启动独立窗口", "Launch Window")}
              </span>
            </button>
          )}
        </div>
      </div>

      <div className="detail-tabs">
        <button
          className={`detail-tab ${tab === "auth" ? "active" : ""}`}
          onClick={() => setTab("auth")}
        >
          {t(lang, "连接与认证", "Auth & Gateway")}
        </button>
        <button
          className={`detail-tab ${tab === "paths" ? "active" : ""}`}
          onClick={() => setTab("paths")}
        >
          {t(lang, "隔离目录与数据同步", "Isolation & Sync")}
        </button>
        <button
          className={`detail-tab ${tab === "logs" ? "active" : ""}`}
          onClick={() => setTab("logs")}
        >
          {t(lang, "配置备份与启动日志", "Backups & Logs")}
        </button>
        <button
          className={`detail-tab ${tab === "danger" ? "active" : ""}`}
          onClick={() => setTab("danger")}
        >
          {t(lang, "移除与销毁", "Danger Zone")}
        </button>
      </div>

      {tab === "auth" && (
        <div className="surface-card">
          <div className="form-grid">
            <div className="form-row-2">
              <div className="field-group">
                <label className="field-label">{t(lang, "配置名称", "Profile Name")}</label>
                <input
                  className="text-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="field-group">
                <label className="field-label">{t(lang, "标识颜色", "Color")}</label>
                <div className="swatch-row" style={{ paddingTop: 6 }}>
                  {COLOR_PALETTE.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`color-swatch ${iconColor === c ? "selected" : ""}`}
                      style={{ backgroundColor: c }}
                      onClick={() => setIconColor(c)}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="form-row-2">
              <div className="field-group">
                <label className="field-label">{t(lang, "认证模式", "Auth Mode")}</label>
                <select
                  className="select-input"
                  value={authMode}
                  onChange={(e) => setAuthMode(e.target.value as ProfileAuthMode)}
                >
                  {profile.engine === "antigravity" ? (
                    <>
                      <option value="google_account">
                        {AUTH_MODE_LABELS[lang].google_account}
                      </option>
                      <option value="gemini_api_key">
                        {AUTH_MODE_LABELS[lang].gemini_api_key}
                      </option>
                      <option value="custom_gateway">
                        {AUTH_MODE_LABELS[lang].custom_gateway}
                      </option>
                    </>
                  ) : (
                    <>
                      <option value="chatgpt_account">
                        {AUTH_MODE_LABELS[lang].chatgpt_account}
                      </option>
                      <option value="official_openai">
                        {AUTH_MODE_LABELS[lang].official_openai}
                      </option>
                      <option value="third_party_responses">
                        {AUTH_MODE_LABELS[lang].third_party_responses}
                      </option>
                    </>
                  )}
                </select>
              </div>

              <div className="field-group">
                <label className="field-label">{t(lang, "默认模型", "Model")}</label>
                <div className="input-with-btn">
                  <input
                    className="text-input"
                    list="detail-models-list"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  />
                  <datalist id="detail-models-list">
                    {modelsList.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                  <button type="button" className="btn" onClick={handleFetchModels}>
                    <RefreshCw size={14} />
                  </button>
                </div>
              </div>
            </div>

            {needsBaseUrl && (
              <div className="field-group">
                <label className="field-label">Base URL</label>
                <input
                  className="text-input"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              </div>
            )}

            {needsApiKey && (
              <div className="field-group">
                <label className="field-label">
                  {t(
                    lang,
                    "更新 API Key (留空保持已加密保存的密钥不变)",
                    "Update API Key (Leave blank to keep saved encrypted key)"
                  )}
                </label>
                <input
                  type="password"
                  className="text-input"
                  placeholder="••••••••••••••••"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </div>
            )}

            <div className="form-row-2">
              <div className="field-group">
                <label className="field-label">
                  {t(lang, "HTTP/HTTPS 代理地址", "Proxy URL")}
                </label>
                <input
                  className="text-input"
                  placeholder="http://127.0.0.1:7890"
                  value={proxyUrl}
                  onChange={(e) => setProxyUrl(e.target.value)}
                />
              </div>

              {profile.engine === "antigravity" ? (
                <div className="field-group">
                  <label className="field-label">WSL Distro</label>
                  <input
                    className="text-input"
                    list="detail-wsl-list"
                    value={wslDistro}
                    onChange={(e) => setWslDistro(e.target.value)}
                  />
                  <datalist id="detail-wsl-list">
                    {wslDistros.map((d) => (
                      <option key={d} value={d} />
                    ))}
                  </datalist>
                </div>
              ) : (
                <div className="field-group">
                  <label className="field-label">Reasoning Effort</label>
                  <select
                    className="select-input"
                    value={reasoningEffort}
                    onChange={(e) => setReasoningEffort(e.target.value as ReasoningEffort)}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
              )}
            </div>

            <div className="field-group">
              <label className="field-label">
                {t(lang, "客户端程序路径", "Client Executable Path")}
              </label>
              <div className="input-with-btn">
                <input
                  className="text-input"
                  value={appPath}
                  onChange={(e) => setAppPath(e.target.value)}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    const picked = await window.multiLauncher.pickExecutablePath(profile.engine);
                    if (picked) setAppPath(picked);
                  }}
                >
                  <FolderOpen size={14} />
                </button>
              </div>
            </div>

            {testResult && (
              <div className="path-box">
                <div>
                  <strong>{testResult.summary}</strong>
                  <div className="field-hint">{testResult.details}</div>
                </div>
              </div>
            )}

            <div className="btn-group" style={{ justifyContent: "flex-end", marginTop: 6 }}>
              <button type="button" className="btn" onClick={handleTestConnection}>
                <Zap size={14} />
                <span>{t(lang, "测试连接", "Test Connection")}</span>
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSave}
                disabled={saving}
              >
                <Save size={14} />
                <span>{t(lang, "保存更改", "Save Changes")}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === "paths" && (
        <div>
          {isOutsidePreferredRoot && preferredStorageRoot && (
            <div className="banner-card">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <HardDrive size={18} color="var(--agy-color)" />
                <div style={{ fontSize: 13 }}>
                  <strong>
                    {t(
                      lang,
                      "当前该配置的数据仍在原目录（例如 C 盘）",
                      "Profile data is currently outside target storage root"
                    )}
                  </strong>
                  <div style={{ color: "var(--text-secondary)", marginTop: 2 }}>
                    {t(
                      lang,
                      `在窗口关闭状态下可一键迁移全部会话与登录状态至 ${preferredStorageRoot}\\${profile.id} 并释放原盘空间。`,
                      `Migrate data to ${preferredStorageRoot}\\${profile.id} when stopped.`
                    )}
                  </div>
                </div>
              </div>
              <button
                className="btn btn-primary"
                disabled={migrating || isRunning}
                onClick={async () => {
                  setMigrating(true);
                  try {
                    const res = await window.multiLauncher.migrateProfileStorage(
                      profile.id,
                      preferredStorageRoot
                    );
                    onUpdated();
                    onNotify(
                      t(
                        lang,
                        `迁移完成：${res.targetDir}`,
                        `Migrated to ${res.targetDir}`
                      )
                    );
                  } catch (err) {
                    onNotify(err instanceof Error ? err.message : String(err));
                  } finally {
                    setMigrating(false);
                  }
                }}
              >
                {migrating
                  ? t(lang, "正在迁移数据...", "Migrating...")
                  : isRunning
                    ? t(lang, "请先停止实例再迁移", "Stop Instance First")
                    : t(lang, "一键迁移到目标盘", "Migrate Storage")}
              </button>
            </div>
          )}

          <div className="surface-card">
            <h3 className="surface-title">{t(lang, "物理隔离目录与凭据域", "Isolated Directories & Scopes")}</h3>
            <p className="surface-desc">
              {t(
                lang,
                "每个配置拥有完全独立的应用数据锁与凭据作用域，确保多窗口同时在线不串号。",
                "Each profile uses dedicated directories and OS keyring scopes."
              )}
            </p>
            <div className="form-grid">
              <div className="path-box">
                <div>
                  <div style={{ fontWeight: 650 }}>
                    {profile.engine === "antigravity"
                      ? "Profile Home (.gemini 宿主目录)"
                      : "CODEX_HOME"}
                  </div>
                  <div className="mono-text">{profile.paths.profileHome}</div>
                </div>
                <button
                  className="btn"
                  onClick={() => window.multiLauncher.revealPath(profile.paths.profileHome)}
                >
                  <FolderOpen size={14} />
                  <span>{t(lang, "打开", "Open")}</span>
                </button>
              </div>

              <div className="path-box">
                <div>
                  <div style={{ fontWeight: 650 }}>Chromium / Electron --user-data-dir</div>
                  <div className="mono-text">{profile.paths.userDataDir}</div>
                </div>
                <button
                  className="btn"
                  onClick={() => window.multiLauncher.revealPath(profile.paths.userDataDir)}
                >
                  <FolderOpen size={14} />
                  <span>{t(lang, "打开", "Open")}</span>
                </button>
              </div>

              <div className="path-box">
                <div>
                  <div style={{ fontWeight: 650 }}>
                    {t(lang, "桌面快捷启动器", "Desktop Shortcut Launcher")}
                  </div>
                  <div className="mono-text">{profile.paths.launcherPath}</div>
                </div>
                <button
                  className="btn"
                  onClick={() => window.multiLauncher.revealPath(profile.paths.launcherPath)}
                >
                  <FolderOpen size={14} />
                  <span>{t(lang, "定位", "Reveal")}</span>
                </button>
              </div>

              {profile.credentialScope && (
                <div className="path-box">
                  <div>
                    <div style={{ fontWeight: 650 }}>
                      OS Keyring Scope (ANTIGRAVITY_CREDENTIAL_SCOPE)
                    </div>
                    <div className="mono-text">gemini:{profile.credentialScope}</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="surface-card">
            <h3 className="surface-title">
              {t(lang, "手动同步技能、MCP 与历史会话", "Sync Skills, MCP & Conversations")}
            </h3>
            <p className="surface-desc">
              {t(
                lang,
                "随时从默认客户端或其他同引擎多开配置增量同步插件技能与会话数据。",
                "Sync MCP servers, skills, plugins, or conversation history on demand."
              )}
            </p>
            <div className="form-grid">
              <div className="field-group">
                <label className="field-label">{t(lang, "同步来源", "Source")}</label>
                <select
                  className="select-input"
                  value={syncSource}
                  onChange={(e) => setSyncSource(e.target.value)}
                >
                  <option value="default">
                    {profile.engine === "antigravity"
                      ? t(lang, "本机默认 Antigravity (~/.gemini)", "Default Antigravity (~/.gemini)")
                      : t(lang, "本机默认 Codex (~/.codex)", "Default Codex (~/.codex)")}
                  </option>
                  {peerProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.id})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-row-2">
                <label className="toggle-card" style={{ cursor: "pointer" }}>
                  <span>{t(lang, "同步 MCP、Skills 与全局设置", "Sync MCP, Skills & Settings")}</span>
                  <input
                    type="checkbox"
                    checked={syncConfig}
                    onChange={(e) => setSyncConfig(e.target.checked)}
                  />
                </label>
                <label className="toggle-card" style={{ cursor: "pointer" }}>
                  <span>{t(lang, "同步历史对话记录", "Sync Conversation History")}</span>
                  <input
                    type="checkbox"
                    checked={syncConv}
                    onChange={(e) => setSyncConv(e.target.checked)}
                  />
                </label>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  className="btn btn-primary"
                  disabled={!syncConfig && !syncConv}
                  onClick={handleSyncNow}
                >
                  <Share2 size={14} />
                  <span>{t(lang, "立即执行同步", "Sync Now")}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "logs" && (
        <div>
          <div className="surface-card">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12
              }}
            >
              <h3 className="surface-title">{t(lang, "启动诊断日志", "Launch Log")}</h3>
              <button className="btn" onClick={loadBackupsAndLogs}>
                <RefreshCw size={14} />
                <span>{t(lang, "刷新日志", "Refresh")}</span>
              </button>
            </div>
            <pre className="log-viewer">{launchLog || "No logs yet."}</pre>
          </div>

          <div className="surface-card">
            <h3 className="surface-title">{t(lang, "自动配置备份", "Config Backups")}</h3>
            <p className="surface-desc">
              {t(
                lang,
                "每次修改配置前会自动生成快照，可随时一键回滚。",
                "Snapshots created automatically before profile updates."
              )}
            </p>
            {backups.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                {t(lang, "暂无历史备份记录。", "No config backups yet.")}
              </div>
            ) : (
              <div className="running-list">
                {backups.map((b) => (
                  <div key={b.backupPath} className="running-row">
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{b.fileName}</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {new Date(b.createdAt).toLocaleString()} · {b.sizeBytes} bytes
                      </div>
                    </div>
                    <button
                      className="btn"
                      onClick={async () => {
                        await window.multiLauncher.restoreConfigBackup({
                          profileId: profile.id,
                          backupPath: b.backupPath
                        });
                        onNotify(t(lang, "已恢复该备份配置", "Backup restored"));
                      }}
                    >
                      <History size={14} />
                      <span>{t(lang, "恢复此快照", "Restore")}</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "danger" && (
        <div className="surface-card">
          <h3 className="surface-title">{t(lang, "生命周期管理", "Lifecycle & Removal")}</h3>
          <p className="surface-desc">
            {t(
              lang,
              "可先将配置移入回收站（保留本地数据与登录态），或彻底销毁所有隔离文件与系统凭据。",
              "Soft-remove to hide from sidebar, or permanently wipe all isolated directories and credentials."
            )}
          </p>

          <div className="form-grid">
            {profile.status === "active" ? (
              <div className="toggle-card">
                <div>
                  <div style={{ fontWeight: 650 }}>
                    {t(lang, "移出活动列表（保留数据）", "Soft Remove (Keep Data)")}
                  </div>
                  <div className="field-hint">
                    {t(
                      lang,
                      "从默认侧边栏隐藏，后续勾选“显示已移除配置”可随时恢复。",
                      "Hide profile without deleting its conversations or login state."
                    )}
                  </div>
                </div>
                <button
                  className="btn"
                  onClick={async () => {
                    await window.multiLauncher.deleteProfile(profile.id);
                    onUpdated();
                    onNotify(t(lang, "已移入回收站", "Profile soft-removed"));
                  }}
                >
                  {t(lang, "暂时移除", "Remove")}
                </button>
              </div>
            ) : (
              <div className="toggle-card">
                <div>
                  <div style={{ fontWeight: 650 }}>
                    {t(lang, "恢复此配置", "Restore Profile")}
                  </div>
                  <div className="field-hint">
                    {t(lang, "重新恢复至活动列表。", "Restore profile to active list.")}
                  </div>
                </div>
                <button
                  className="btn btn-primary"
                  onClick={async () => {
                    await window.multiLauncher.restoreProfile(profile.id);
                    onUpdated();
                    onNotify(t(lang, "配置已恢复", "Profile restored"));
                  }}
                >
                  <ArchiveRestore size={14} />
                  <span>{t(lang, "恢复配置", "Restore")}</span>
                </button>
              </div>
            )}

            <div className="toggle-card" style={{ borderColor: "rgba(220,38,38,0.35)" }}>
              <div>
                <div style={{ fontWeight: 700, color: "var(--danger)" }}>
                  {t(lang, "永久销毁配置与隔离数据", "Permanently Delete & Wipe Data")}
                </div>
                <div className="field-hint">
                  {t(
                    lang,
                    "自动停止实例并彻底删除该配置的独立主目录、user-data-dir、快捷启动器及独立凭据域，不可恢复。",
                    "Stops running instance and permanently deletes isolated directories, shortcuts, and keyring credentials."
                  )}
                </div>
              </div>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  const ok = window.confirm(
                    t(
                      lang,
                      `确定永久销毁配置 "${profile.name}" 及其所有本地隔离目录吗？此操作不可撤销。`,
                      `Permanently delete "${profile.name}" and wipe its isolated directories?`
                    )
                  );
                  if (!ok) return;
                  await window.multiLauncher.permanentlyDeleteProfile(profile.id);
                  onDeleted();
                  onNotify(t(lang, "已永久销毁该配置", "Profile permanently deleted"));
                }}
              >
                <Trash2 size={14} />
                <span>{t(lang, "永久销毁", "Delete Permanently")}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
