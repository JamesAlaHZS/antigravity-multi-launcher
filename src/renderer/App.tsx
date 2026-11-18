import React, { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AppInfo,
  AppSettings,
  EngineType,
  EnvironmentReport,
  LegacyCodexProfileCandidate,
  ProfileRecord,
  RuntimeStatusItem
} from "@shared/types";
import { CreateProfileModal } from "./components/CreateProfileModal";
import { DashboardView } from "./components/DashboardView";
import { EnvironmentModal } from "./components/EnvironmentModal";
import { ImportLegacyModal } from "./components/ImportLegacyModal";
import { ProfileDetailView } from "./components/ProfileDetailView";
import { SettingsModal } from "./components/SettingsModal";
import { Sidebar } from "./components/Sidebar";
import { t } from "./i18n";

export const App: React.FC = () => {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<AppSettings>({
    language: "zh-CN",
    theme: "light",
    autoRefreshRuntimeSeconds: 5
  });
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [runtimeItems, setRuntimeItems] = useState<RuntimeStatusItem[]>([]);
  const [envReport, setEnvReport] = useState<EnvironmentReport | null>(null);
  const [legacyCandidates, setLegacyCandidates] = useState<LegacyCodexProfileCandidate[]>([]);

  const [selectedView, setSelectedView] = useState<"dashboard" | string>("dashboard");
  const [engineFilter, setEngineFilter] = useState<"all" | EngineType>("all");
  const [showDeleted, setShowDeleted] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const [createModalEngine, setCreateModalEngine] = useState<EngineType | null>(null);
  const [showEnvModal, setShowEnvModal] = useState<boolean>(false);
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [showLegacyModal, setShowLegacyModal] = useState<boolean>(false);
  const [toast, setToast] = useState<string | null>(null);

  const lang = settings.language;

  const notify = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 3400);
  }, []);

  const loadAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const [info, cfg, profs, rt, env, legacy] = await Promise.all([
        window.multiLauncher.getAppInfo(),
        window.multiLauncher.getSettings(),
        window.multiLauncher.listProfiles(true),
        window.multiLauncher.getRuntimeStatus(),
        window.multiLauncher.getEnvironmentReport(),
        window.multiLauncher.detectLegacyCodexProfiles()
      ]);
      setAppInfo(info);
      setSettings(cfg);
      setProfiles(profs);
      setRuntimeItems(rt);
      setEnvReport(env);
      setLegacyCandidates(legacy);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }, [notify]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", settings.theme);
  }, [settings.theme]);

  useEffect(() => {
    const intervalSec = Math.max(3, settings.autoRefreshRuntimeSeconds || 5);
    const timer = setInterval(async () => {
      try {
        const rt = await window.multiLauncher.getRuntimeStatus();
        setRuntimeItems(rt);
      } catch {
        // ignore background poll errors
      }
    }, intervalSec * 1000);
    return () => clearInterval(timer);
  }, [settings.autoRefreshRuntimeSeconds]);

  const runtimeMap = useMemo(() => {
    const map = new Map<string, RuntimeStatusItem>();
    for (const item of runtimeItems) {
      map.set(item.profileId, item);
    }
    return map;
  }, [runtimeItems]);

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === selectedView) ?? null,
    [profiles, selectedView]
  );

  const unimportedLegacyCount = useMemo(
    () =>
      legacyCandidates.filter(
        (c) => !c.alreadyImported && c.legacyStatus === "active"
      ).length,
    [legacyCandidates]
  );

  async function handleLaunchProfile(profileId: string) {
    try {
      const res = await window.multiLauncher.openProfile(profileId);
      notify(
        t(
          lang,
          `已启动隔离窗口${res.pid ? ` (PID ${res.pid})` : ""}`,
          `Launched isolated instance${res.pid ? ` (PID ${res.pid})` : ""}`
        )
      );
      setTimeout(async () => {
        const rt = await window.multiLauncher.getRuntimeStatus();
        setRuntimeItems(rt);
      }, 1500);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleStopProfile(profileId: string) {
    try {
      const res = await window.multiLauncher.stopProfile(profileId);
      notify(
        res.stoppedPids.length > 0
          ? t(lang, `已停止进程 PID: ${res.stoppedPids.join(", ")}`, "Stopped instance")
          : t(lang, "未发现运行中的进程", "Instance already stopped")
      );
      const rt = await window.multiLauncher.getRuntimeStatus();
      setRuntimeItems(rt);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleCopyDiagnostics() {
    const report = await window.multiLauncher.getDiagnosticsReport();
    await navigator.clipboard.writeText(report);
    notify(t(lang, "已复制脱敏诊断报告到剪贴板", "Sanitized diagnostics copied to clipboard"));
  }

  return (
    <div className="app-shell">
      <Sidebar
        lang={lang}
        profiles={profiles}
        runtimeMap={runtimeMap}
        selectedView={selectedView}
        engineFilter={engineFilter}
        showDeleted={showDeleted}
        legacyCandidateCount={unimportedLegacyCount}
        onSelectView={setSelectedView}
        onChangeEngineFilter={setEngineFilter}
        onToggleShowDeleted={setShowDeleted}
        onOpenCreate={(eng) => setCreateModalEngine(eng ?? "antigravity")}
        onOpenEnvironment={() => setShowEnvModal(true)}
        onOpenSettings={() => setShowSettingsModal(true)}
        onOpenLegacyImport={() => setShowLegacyModal(true)}
      />

      <main className="main-area">
        {selectedView === "dashboard" || !activeProfile ? (
          <DashboardView
            lang={lang}
            profiles={profiles}
            runtimeMap={runtimeMap}
            envReport={envReport}
            legacyCandidateCount={unimportedLegacyCount}
            refreshing={refreshing}
            onRefresh={loadAll}
            onCopyDiagnostics={handleCopyDiagnostics}
            onOpenEnvironment={() => setShowEnvModal(true)}
            onOpenCreate={(eng) => setCreateModalEngine(eng)}
            onSelectProfile={(id) => setSelectedView(id)}
            onLaunchProfile={handleLaunchProfile}
            onStopProfile={handleStopProfile}
            onRevealPath={(p) => window.multiLauncher.revealPath(p)}
            onOpenLegacyImport={() => setShowLegacyModal(true)}
          />
        ) : (
          <ProfileDetailView
            lang={lang}
            profile={activeProfile}
            allProfiles={profiles}
            appInfo={appInfo}
            runtime={runtimeMap.get(activeProfile.id)}
            wslDistros={envReport?.wslDistros ?? []}
            onLaunch={handleLaunchProfile}
            onStop={handleStopProfile}
            onUpdated={loadAll}
            onDeleted={() => {
              setSelectedView("dashboard");
              void loadAll();
            }}
            onNotify={notify}
          />
        )}
      </main>

      {createModalEngine && (
        <CreateProfileModal
          lang={lang}
          initialEngine={createModalEngine}
          existingProfiles={profiles}
          appInfo={appInfo}
          envReport={envReport}
          onClose={() => setCreateModalEngine(null)}
          onNotify={notify}
          onCreated={(createdProfile, launchImmediately) => {
            setCreateModalEngine(null);
            setSelectedView(createdProfile.id);
            void loadAll().then(() => {
              if (launchImmediately) {
                void handleLaunchProfile(createdProfile.id);
              } else {
                notify(t(lang, `已创建配置：${createdProfile.name}`, "Profile created"));
              }
            });
          }}
        />
      )}

      {showEnvModal && (
        <EnvironmentModal
          lang={lang}
          report={envReport}
          onRefresh={async () => {
            const env = await window.multiLauncher.getEnvironmentReport();
            setEnvReport(env);
          }}
          onClose={() => setShowEnvModal(false)}
        />
      )}

      {showSettingsModal && (
        <SettingsModal
          lang={lang}
          settings={settings}
          appInfo={appInfo}
          onSave={async (patch) => {
            const updated = await window.multiLauncher.updateSettings(patch);
            setSettings(updated);
            const env = await window.multiLauncher.getEnvironmentReport();
            setEnvReport(env);
            notify(t(updated.language, "设置已保存", "Settings saved"));
          }}
          onClose={() => setShowSettingsModal(false)}
        />
      )}

      {showLegacyModal && (
        <ImportLegacyModal
          lang={lang}
          candidates={legacyCandidates}
          onImport={async (ids) => {
            const res = await window.multiLauncher.importLegacyCodexProfiles(ids);
            await loadAll();
            notify(
              t(
                lang,
                `成功导入 ${res.importedCount} 个 Codex 配置`,
                `Imported ${res.importedCount} Codex profiles`
              )
            );
          }}
          onClose={() => setShowLegacyModal(false)}
        />
      )}

      {toast && <div className="toast-banner">{toast}</div>}
    </div>
  );
};
