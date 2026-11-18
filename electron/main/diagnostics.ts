import os from "node:os";
import { getEnvironmentReport } from "./environment.js";
import { APP_NAME, getRealHomeDir } from "./paths.js";
import { listProfiles } from "./registry.js";
import { inspectProfilesRuntime } from "./runtime.js";

function sanitizeUserHome(text: string): string {
  const home = getRealHomeDir();
  if (!home) return text;
  const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(escaped, "gi"), "~");
}

export async function buildSanitizedDiagnosticsReport(appVersion: string): Promise<string> {
  const [envReport, profiles] = await Promise.all([
    getEnvironmentReport(),
    listProfiles(true)
  ]);
  const runtime = await inspectProfilesRuntime(profiles.filter((p) => p.status === "active"));

  const payload = {
    generatedAt: new Date().toISOString(),
    app: {
      name: APP_NAME,
      version: appVersion,
      electron: process.versions.electron ?? "n/a",
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release()
    },
    environment: {
      antigravityAppExists: envReport.antigravityAppExists,
      antigravityIdeExists: envReport.antigravityIdeExists,
      antigravityLsStamp: envReport.antigravityLsStamp,
      codexAppExists: envReport.codexAppExists,
      codexCliVersion: envReport.codexCliVersion,
      wslDistrosCount: envReport.wslDistros.length,
      checks: envReport.checks.map((c) => ({
        id: c.id,
        status: c.status,
        path: c.path ? sanitizeUserHome(c.path) : undefined,
        detail: sanitizeUserHome(c.detail)
      }))
    },
    profilesSummary: profiles.map((p) => {
      const rt = runtime.find((r) => r.profileId === p.id);
      return {
        id: p.id,
        engine: p.engine,
        variant: p.antigravityVariant,
        status: p.status,
        authMode: p.auth.mode,
        model: p.provider.model,
        hasBaseUrl: Boolean(p.provider.baseUrl),
        hasProxy: Boolean(p.provider.proxyUrl),
        credentialScope: p.credentialScope,
        runningStatus: rt?.status ?? "not_running",
        pid: rt?.pid ?? null
      };
    })
  };

  return JSON.stringify(payload, null, 2);
}
