import React, { useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Play,
  RefreshCw,
  Shield,
  Sparkles,
  Terminal,
  X
} from "lucide-react";
import type {
  AntigravityVariant,
  AppInfo,
  CreateProfileInput,
  EngineType,
  EnvironmentReport,
  LanguageCode,
  ProfileAuthMode,
  ProfileRecord,
  ProviderTestResult,
  ReasoningEffort
} from "@shared/types";
import { AUTH_MODE_LABELS, COLOR_PALETTE, t } from "../i18n";

interface CreateProfileModalProps {
  lang: LanguageCode;
  initialEngine: EngineType;
  existingProfiles: ProfileRecord[];
  appInfo: AppInfo | null;
  envReport: EnvironmentReport | null;
  onClose: () => void;
  onCreated: (profile: ProfileRecord, launchImmediately: boolean) => void;
  onNotify: (msg: string) => void;
}

export const CreateProfileModal: React.FC<CreateProfileModalProps> = ({
  lang,
  initialEngine,
  existingProfiles,
  appInfo,
  envReport,
  onClose,
  onCreated,
  onNotify
}) => {
  const [step, setStep] = useState<number>(1);
  const [engine, setEngine] = useState<EngineType>(initialEngine);
  const [variant, setVariant] = useState<AntigravityVariant>("antigravity_app");
  const [name, setName] = useState<string>(
    initialEngine === "antigravity" ? "Antigravity Work" : "Codex Work"
  );
  const [iconColor, setIconColor] = useState<string>(
    initialEngine === "antigravity" ? "#4F46E5" : "#10B981"
  );
  const [inheritDefaultConfig, setInheritDefaultConfig] = useState<boolean>(true);
  const [syncHistoryEnabled, setSyncHistoryEnabled] = useState<boolean>(false);
  const [syncSourceProfileId, setSyncSourceProfileId] = useState<string>("default");

  const [authMode, setAuthMode] = useState<ProfileAuthMode>(
    initialEngine === "antigravity" ? "google_account" : "chatgpt_account"
  );
  const [providerName, setProviderName] = useState<string>(
    initialEngine === "antigravity" ? "Google Antigravity" : "OpenAI"
  );
  const [baseUrl, setBaseUrl] = useState<string>("");
  const [model, setModel] = useState<string>(
    initialEngine === "antigravity" ? "gemini-2.5-pro" : "gpt-5.2"
  );
  const [apiKey, setApiKey] = useState<string>("");
  const [proxyUrl, setProxyUrl] = useState<string>("");
  const [wslDistro, setWslDistro] = useState<string>("");
  const [googleCloudProject, setGoogleCloudProject] = useState<string>("");
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("medium");

  const [customAppPath, setCustomAppPath] = useState<string>("");
  const [customLauncherDir, setCustomLauncherDir] = useState<string>("");

  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState<boolean>(false);
  const [testing, setTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (engine === "antigravity") {
      setAuthMode("google_account");
      setProviderName("Google Antigravity");
      setModel("gemini-2.5-pro");
      setIconColor("#4F46E5");
      if (name === "Codex Work") setName("Antigravity Work");
    } else {
      setAuthMode("chatgpt_account");
      setProviderName("OpenAI");
      setModel("gpt-5.2");
      setIconColor("#10B981");
      if (name === "Antigravity Work") setName("Codex Work");
    }
    setTestResult(null);
    setFetchedModels([]);
  }, [engine]);

  const sameEngineProfiles = existingProfiles.filter(
    (p) => p.engine === engine && p.status === "active"
  );

  const needsApiKey = authMode !== "google_account" && authMode !== "chatgpt_account";
  const needsBaseUrl = authMode === "custom_gateway" || authMode === "third_party_responses";

  async function handleFetchModels() {
    setLoadingModels(true);
    try {
      const res = await window.multiLauncher.listProviderModels({
        engine,
        authMode,
        baseUrl,
        apiKey,
        model
      });
      setFetchedModels(res.models);
      if (res.models.length > 0 && !model) {
        setModel(res.models[0]);
      }
      onNotify(res.summary);
    } finally {
      setLoadingModels(false);
    }
  }

  async function handleRunTest() {
    setTesting(true);
    try {
      const res = await window.multiLauncher.testProvider({
        engine,
        authMode,
        baseUrl,
        apiKey,
        model,
        proxyUrl
      });
      setTestResult(res);
    } finally {
      setTesting(false);
    }
  }

  async function handleSubmit(launchImmediately: boolean) {
    if (!name.trim()) {
      onNotify(t(lang, "请输入 Profile 名称", "Please enter a profile name"));
      return;
    }
    if (needsApiKey && !apiKey.trim()) {
      onNotify(t(lang, "当前模式需要填写 API Key", "API Key is required for this mode"));
      return;
    }

    setSubmitting(true);
    try {
      const payload: CreateProfileInput = {
        name: name.trim(),
        engine,
        ...(engine === "antigravity" ? { antigravityVariant: variant } : {}),
        authMode,
        appPath: customAppPath.trim() || undefined,
        launcherDirectory: customLauncherDir.trim() || undefined,
        inheritDefaultConfig,
        linkDeveloperDotfiles: true,
        syncHistory: {
          enabled: syncHistoryEnabled,
          scope: "all",
          sources:
            syncSourceProfileId === "default"
              ? [{ type: "default" }]
              : [{ type: "profile", profileId: syncSourceProfileId }]
        },
        provider: {
          displayName: providerName.trim(),
          baseUrl: baseUrl.trim() || undefined,
          model: model.trim(),
          apiKey: apiKey.trim() || undefined,
          proxyUrl: proxyUrl.trim() || undefined,
          reasoningEffort,
          wslDistro: wslDistro.trim() || undefined,
          googleCloudProject: googleCloudProject.trim() || undefined
        },
        appearance: {
          iconBackgroundColor: iconColor
        }
      };

      const created = await window.multiLauncher.createProfile(payload);
      onCreated(created.profile, launchImmediately);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const steps = [
    t(lang, "基础配置", "Profile"),
    t(lang, "认证服务", "Auth"),
    t(lang, "连接检查", "Verify"),
    t(lang, "隔离目录", "Paths"),
    t(lang, "生成", "Create")
  ];

  const previewSlug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "profile";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h2 style={{ margin: 0, fontSize: 19 }}>
                {t(lang, "创建多开隔离配置", "Create Isolated Profile")}
              </h2>
              <span
                className="status-chip pass"
                style={{ fontSize: 11, padding: "2px 9px" }}
              >
                <Shield size={12} />
                <span>{t(lang, "本地 AES-256 加密保存", "AES-256 Encrypted")}</span>
              </span>
            </div>
            <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--text-muted)" }}>
              {t(
                lang,
                "生成独立的用户数据目录、凭据域与桌面快捷启动器。",
                "Generate an isolated desktop profile with dedicated credentials and launcher."
              )}
            </p>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="stepper-row">
            {steps.map((label, idx) => {
              const num = idx + 1;
              const cls = num === step ? "active" : num < step ? "done" : "";
              return (
                <div key={label} className={`step-pill ${cls}`}>
                  <span className="step-num">{num}</span>
                  <span>{label}</span>
                </div>
              );
            })}
          </div>

          {step === 1 && (
            <div className="form-grid">
              <div className="field-group">
                <label className="field-label">
                  {t(lang, "选择目标桌面客户端引擎", "Select Desktop Engine")}
                </label>
                <div className="engine-choice-grid">
                  <button
                    type="button"
                    className={`engine-choice-card ${engine === "antigravity" ? "selected" : ""}`}
                    onClick={() => setEngine("antigravity")}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
                      <Sparkles size={17} color="var(--agy-color)" />
                      <span>Google Antigravity</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 5 }}>
                      {t(
                        lang,
                        "支持 Antigravity 2.0 桌面端与 Antigravity IDE，多 Google 账号 / Gemini API 独立运行",
                        "Antigravity 2.0 & IDE with isolated .gemini & keyring scope"
                      )}
                    </div>
                  </button>

                  <button
                    type="button"
                    className={`engine-choice-card ${engine === "codex" ? "selected" : ""}`}
                    onClick={() => setEngine("codex")}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
                      <Terminal size={17} color="var(--codex-color)" />
                      <span>OpenAI Codex</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 5 }}>
                      {t(
                        lang,
                        "支持 Codex / ChatGPT 桌面端与微软商店版，多账号与第三方 Responses 接口隔离",
                        "Codex / ChatGPT Desktop with isolated CODEX_HOME"
                      )}
                    </div>
                  </button>
                </div>
              </div>

              {engine === "antigravity" && (
                <div className="field-group">
                  <label className="field-label">
                    {t(lang, "Antigravity 客户端形态", "Antigravity Surface")}
                  </label>
                  <select
                    className="select-input"
                    value={variant}
                    onChange={(e) => setVariant(e.target.value as AntigravityVariant)}
                  >
                    <option value="antigravity_app">
                      Antigravity 2.0 Desktop (Hub 桌面应用)
                    </option>
                    <option value="antigravity_ide">
                      Antigravity IDE (独立编辑器 + 独立插件目录)
                    </option>
                  </select>
                </div>
              )}

              <div className="form-row-2">
                <div className="field-group">
                  <label className="field-label">
                    {t(lang, "Profile 名称", "Profile Name")}
                  </label>
                  <input
                    className="text-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例如：工作号 / 个人号 / Gemini 网关"
                  />
                </div>
                <div className="field-group">
                  <label className="field-label">
                    {t(lang, "标识颜色", "Accent Color")}
                  </label>
                  <div className="swatch-row" style={{ paddingTop: 5 }}>
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

              <div className="toggle-card">
                <div>
                  <div style={{ fontWeight: 650, fontSize: 13.5 }}>
                    {engine === "antigravity"
                      ? t(lang, "继承默认 Antigravity 配置与技能", "Inherit Default Antigravity Config")
                      : t(lang, "继承默认 Codex 配置与技能", "Inherit Default Codex Config")}
                  </div>
                  <div className="field-hint">
                    {engine === "antigravity"
                      ? t(
                          lang,
                          "自动复制已有 MCP 服务、Skills、Plugins 及全局权限策略，并自动挂载本机 .ssh / .gitconfig。",
                          "Copy MCP servers, Skills, Plugins & link .ssh/.gitconfig."
                        )
                      : t(
                          lang,
                          "保留已有 AGENTS.md、MCP 服务、Skills、Plugins 与可信工作区设置。",
                          "Copy AGENTS.md, MCP servers, Skills & Plugins."
                        )}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={inheritDefaultConfig}
                  onChange={(e) => setInheritDefaultConfig(e.target.checked)}
                />
              </div>

              <div className="toggle-card">
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 650, fontSize: 13.5 }}>
                    {t(lang, "同步历史对话记录", "Sync Conversation History")}
                  </div>
                  <div className="field-hint">
                    {t(
                      lang,
                      "从默认客户端或已有多开配置复制历史会话记录到新窗口。",
                      "Copy conversation history from default app or another profile."
                    )}
                  </div>
                  {syncHistoryEnabled && (
                    <select
                      className="select-input"
                      style={{ marginTop: 8 }}
                      value={syncSourceProfileId}
                      onChange={(e) => setSyncSourceProfileId(e.target.value)}
                    >
                      <option value="default">
                        {engine === "antigravity"
                          ? t(lang, "当前默认 Antigravity 客户端", "Default Antigravity App")
                          : t(lang, "当前默认 Codex 客户端", "Default Codex App")}
                      </option>
                      {sameEngineProfiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.id})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <input
                  type="checkbox"
                  checked={syncHistoryEnabled}
                  onChange={(e) => setSyncHistoryEnabled(e.target.checked)}
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="form-grid">
              <div className="field-group">
                <label className="field-label">
                  {t(lang, "登录与认证方式", "Authentication Mode")}
                </label>
                <select
                  className="select-input"
                  value={authMode}
                  onChange={(e) => {
                    setAuthMode(e.target.value as ProfileAuthMode);
                    setTestResult(null);
                  }}
                >
                  {engine === "antigravity" ? (
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

              <div className="form-row-2">
                <div className="field-group">
                  <label className="field-label">
                    {t(lang, "服务商显示名称", "Provider Label")}
                  </label>
                  <input
                    className="text-input"
                    value={providerName}
                    onChange={(e) => setProviderName(e.target.value)}
                  />
                </div>
                <div className="field-group">
                  <label className="field-label">{t(lang, "默认模型", "Default Model")}</label>
                  <div className="input-with-btn">
                    <input
                      className="text-input"
                      list="wizard-model-list"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                    />
                    <datalist id="wizard-model-list">
                      {fetchedModels.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                    <button
                      type="button"
                      className="btn"
                      onClick={handleFetchModels}
                      disabled={loadingModels}
                    >
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
                    placeholder="https://api.example.com/v1"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                  />
                </div>
              )}

              {needsApiKey && (
                <div className="field-group">
                  <label className="field-label">API Key</label>
                  <input
                    type="password"
                    className="text-input"
                    placeholder={
                      engine === "antigravity" ? "AIzaSy... / Gateway Key" : "sk-..."
                    }
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </div>
              )}

              <div className="form-row-2">
                <div className="field-group">
                  <label className="field-label">
                    {t(lang, "独立网络代理 (可选)", "HTTP/HTTPS Proxy (Optional)")}
                  </label>
                  <input
                    className="text-input"
                    placeholder="http://127.0.0.1:7890"
                    value={proxyUrl}
                    onChange={(e) => setProxyUrl(e.target.value)}
                  />
                </div>

                {engine === "antigravity" ? (
                  <div className="field-group">
                    <label className="field-label">
                      {t(lang, "绑定 WSL 发行版 (可选)", "WSL Distro (Optional)")}
                    </label>
                    <input
                      className="text-input"
                      list="wsl-distro-options"
                      placeholder={t(lang, "留空使用本地 Windows 环境", "Leave empty for local")}
                      value={wslDistro}
                      onChange={(e) => setWslDistro(e.target.value)}
                    />
                    <datalist id="wsl-distro-options">
                      {(envReport?.wslDistros ?? []).map((d) => (
                        <option key={d} value={d} />
                      ))}
                    </datalist>
                  </div>
                ) : (
                  <div className="field-group">
                    <label className="field-label">
                      {t(lang, "推理强度 (Reasoning Effort)", "Reasoning Effort")}
                    </label>
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

              {engine === "antigravity" && (
                <div className="field-group">
                  <label className="field-label">
                    {t(lang, "Google Cloud Project ID (可选)", "Google Cloud Project ID (Optional)")}
                  </label>
                  <input
                    className="text-input"
                    placeholder="my-gcp-project-id"
                    value={googleCloudProject}
                    onChange={(e) => setGoogleCloudProject(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="form-grid">
              <div className="toggle-card">
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {AUTH_MODE_LABELS[lang][authMode]}
                  </div>
                  <div className="field-hint" style={{ marginTop: 4 }}>
                    {needsApiKey
                      ? t(
                          lang,
                          "点击右侧按钮验证 API Key 与接口连通性。",
                          "Click Verify to test API Key and endpoint connectivity."
                        )
                      : t(
                          lang,
                          "账号登录模式无需预先配置密钥：启动隔离窗口后直接在浏览器完成登录即可，凭据将保存在该配置专属凭据域中。",
                          "Sign in inside the isolated window after launch; credentials stay isolated."
                        )}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleRunTest}
                  disabled={testing}
                >
                  <RefreshCw size={14} />
                  <span>{t(lang, "执行检查", "Verify")}</span>
                </button>
              </div>

              {testResult && (
                <div
                  className="surface-card"
                  style={{
                    marginBottom: 0,
                    padding: 16,
                    borderColor: testResult.ok ? "var(--success)" : "var(--danger)"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
                    <CheckCircle2
                      size={17}
                      color={testResult.ok ? "var(--success)" : "var(--danger)"}
                    />
                    <span>{testResult.summary}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 6 }}>
                    {testResult.details}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="form-grid">
              <div className="field-group">
                <label className="field-label">
                  {t(
                    lang,
                    "客户端程序路径 (留空自动检测)",
                    "Client Executable Path (Auto-detected if empty)"
                  )}
                </label>
                <div className="input-with-btn">
                  <input
                    className="text-input"
                    placeholder={
                      engine === "antigravity"
                        ? envReport?.antigravityAppPath || "Antigravity.exe"
                        : envReport?.codexAppPath || "Codex.exe"
                    }
                    value={customAppPath}
                    onChange={(e) => setCustomAppPath(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={async () => {
                      const picked = await window.multiLauncher.pickExecutablePath(engine);
                      if (picked) setCustomAppPath(picked);
                    }}
                  >
                    <FolderOpen size={14} />
                  </button>
                </div>
              </div>

              <div className="field-group">
                <label className="field-label">
                  {t(lang, "桌面快捷启动器输出目录", "Shortcut Launcher Directory")}
                </label>
                <div className="input-with-btn">
                  <input
                    className="text-input"
                    placeholder={appInfo?.defaultLauncherRoot || ""}
                    value={customLauncherDir}
                    onChange={(e) => setCustomLauncherDir(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={async () => {
                      const picked = await window.multiLauncher.pickDirectory(
                        customLauncherDir || appInfo?.defaultLauncherRoot
                      );
                      if (picked) setCustomLauncherDir(picked);
                    }}
                  >
                    <FolderOpen size={14} />
                  </button>
                </div>
              </div>

              <div className="field-group">
                <label className="field-label">
                  {t(lang, "即将生成的隔离参数预览", "Isolation Layout Preview")}
                </label>
                <div className="path-box">
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {engine === "antigravity" ? "Isolated .gemini Home" : "Isolated CODEX_HOME"}
                    </div>
                    <div className="mono-text">
                      {engine === "antigravity"
                        ? `${appInfo?.antigravityProfileRoot ?? "~/.antigravity-profiles"}/${previewSlug}/home/.gemini`
                        : `${appInfo?.codexProfileRoot ?? "~/.codex-profiles"}/${previewSlug}/codex-home`}
                    </div>
                  </div>
                </div>
                {engine === "antigravity" && (
                  <div className="path-box">
                    <div>
                      <div style={{ fontWeight: 600 }}>ANTIGRAVITY_CREDENTIAL_SCOPE</div>
                      <div className="mono-text">agy-profile-{previewSlug}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="form-grid">
              <div className="surface-card" style={{ marginBottom: 0, padding: 18 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <span
                    className="profile-color-dot"
                    style={{ width: 14, height: 14, backgroundColor: iconColor }}
                  />
                  <strong style={{ fontSize: 16 }}>{name}</strong>
                  <span className={`engine-badge ${engine}`}>
                    {engine === "antigravity"
                      ? variant === "antigravity_ide"
                        ? "Antigravity IDE"
                        : "Antigravity 2.0"
                      : "Codex"}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.8 }}>
                  <div>
                    <strong>{t(lang, "认证模式：", "Auth Mode: ")}</strong>
                    {AUTH_MODE_LABELS[lang][authMode]}
                  </div>
                  <div>
                    <strong>{t(lang, "默认模型：", "Default Model: ")}</strong>
                    {model}
                  </div>
                  <div>
                    <strong>{t(lang, "继承默认配置：", "Inherit Default Config: ")}</strong>
                    {inheritDefaultConfig ? t(lang, "开启", "Yes") : t(lang, "关闭", "No")}
                  </div>
                  <div>
                    <strong>{t(lang, "同步历史对话：", "Sync History: ")}</strong>
                    {syncHistoryEnabled ? t(lang, "开启", "Yes") : t(lang, "关闭", "No")}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn"
            disabled={step === 1 || submitting}
            onClick={() => setStep((s) => Math.max(1, s - 1))}
          >
            <ChevronLeft size={15} />
            <span>{t(lang, "上一步", "Back")}</span>
          </button>

          {step < 5 ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                if (step === 1 && !name.trim()) {
                  onNotify(t(lang, "请先填写 Profile 名称", "Profile name is required"));
                  return;
                }
                if (step === 2 && needsApiKey && !apiKey.trim()) {
                  onNotify(t(lang, "请填写 API Key", "API Key is required"));
                  return;
                }
                setStep((s) => Math.min(5, s + 1));
              }}
            >
              <span>{t(lang, "下一步", "Next")}</span>
              <ChevronRight size={15} />
            </button>
          ) : (
            <div className="btn-group">
              <button
                type="button"
                className="btn"
                disabled={submitting}
                onClick={() => handleSubmit(false)}
              >
                <span>{t(lang, "仅创建配置", "Create Only")}</span>
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={submitting}
                onClick={() => handleSubmit(true)}
              >
                <Play size={14} />
                <span>{t(lang, "创建并立即启动", "Create & Launch")}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
