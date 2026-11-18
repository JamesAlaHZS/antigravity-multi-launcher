import type {
  ProviderModelsResult,
  ProviderTestInput,
  ProviderTestResult
} from "../../src/shared/types.js";

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

export async function testProviderConnection(
  input: ProviderTestInput
): Promise<ProviderTestResult> {
  if (input.authMode === "google_account" || input.authMode === "chatgpt_account") {
    return {
      ok: true,
      status: "skipped",
      summary:
        input.authMode === "google_account"
          ? "Google OAuth 独立账号模式（启动后在窗口内登录）"
          : "ChatGPT 独立账号模式（启动后在窗口内登录）",
      details:
        input.engine === "antigravity"
          ? "该配置通过独立的 --user-data-dir、.gemini 目录与 ANTIGRAVITY_CREDENTIAL_SCOPE 隔离，不同窗口登录不同 Google 账号互不覆盖。"
          : "该配置通过独立的 CODEX_HOME 与 --user-data-dir 隔离，不同窗口登录不同 ChatGPT 账号互不干扰。"
    };
  }

  const apiKey = input.apiKey?.trim();
  if (!apiKey) {
    return {
      ok: false,
      status: "auth_failed",
      summary: "缺少 API Key",
      details: "请输入有效的 API Key 后再执行连接测试。"
    };
  }

  const start = Date.now();
  try {
    if (input.engine === "antigravity" && input.authMode === "gemini_api_key") {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(10000) });
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          ok: false,
          status: res.status === 401 || res.status === 403 ? "auth_failed" : "unknown_error",
          summary: `Gemini API 返回 HTTP ${res.status}`,
          details: text.slice(0, 300) || res.statusText,
          latencyMs
        };
      }
      const json = (await res.json()) as { models?: Array<{ name?: string }> };
      const count = json.models?.length ?? 0;
      return {
        ok: true,
        status: "ok",
        summary: `Gemini API 连接正常（检测到 ${count} 个可用模型）`,
        details: `耗时 ${latencyMs} ms`,
        latencyMs
      };
    }

    // OpenAI / Custom Gateway / Third-party Responses
    const rawBase =
      input.authMode === "official_openai"
        ? "https://api.openai.com/v1"
        : normalizeBaseUrl(input.baseUrl || "");
    if (!rawBase) {
      return {
        ok: false,
        status: "unknown_error",
        summary: "缺少接口地址 (Base URL)",
        details: "请填写有效的 Base URL（例如 https://api.example.com/v1）。"
      };
    }

    const modelsUrl = rawBase.endsWith("/models") ? rawBase : `${rawBase}/models`;
    const res = await fetch(modelsUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "x-api-key": apiKey
      },
      signal: AbortSignal.timeout(10000)
    });
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status === 401 || res.status === 403 ? "auth_failed" : "unknown_error",
        summary: `接口返回 HTTP ${res.status}`,
        details: text.slice(0, 300) || res.statusText,
        latencyMs
      };
    }
    return {
      ok: true,
      status: "ok",
      summary: `接口连接正常 (${latencyMs} ms)`,
      details: `已成功验证 ${modelsUrl}`,
      latencyMs
    };
  } catch (err) {
    return {
      ok: false,
      status: "network_error",
      summary: "网络连接失败",
      details: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - start
    };
  }
}

export async function fetchProviderModels(
  input: ProviderTestInput
): Promise<ProviderModelsResult> {
  if (input.authMode === "google_account") {
    return {
      ok: true,
      summary: "Antigravity 内置推荐模型列表",
      details: "Google 账号登录模式下在应用内可直接切换模型。",
      models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"]
    };
  }
  if (input.authMode === "chatgpt_account") {
    return {
      ok: true,
      summary: "Codex 内置推荐模型列表",
      details: "ChatGPT 账号登录模式下在应用内可直接切换模型。",
      models: ["gpt-5.2", "gpt-5.1-codex", "o3", "gpt-4.1"]
    };
  }

  const apiKey = input.apiKey?.trim();
  if (!apiKey) {
    return {
      ok: false,
      summary: "缺少 API Key",
      details: "请先输入 API Key。",
      models: []
    };
  }

  try {
    if (input.engine === "antigravity" && input.authMode === "gemini_api_key") {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) {
        return {
          ok: false,
          summary: `HTTP ${res.status}`,
          details: await res.text().catch(() => res.statusText),
          models: []
        };
      }
      const data = (await res.json()) as { models?: Array<{ name?: string }> };
      const models = (data.models ?? [])
        .map((m) => (m.name || "").replace(/^models\//, ""))
        .filter((name) => name.startsWith("gemini"));
      return {
        ok: true,
        summary: `获取到 ${models.length} 个模型`,
        details: "来自 Google Generative Language API",
        models
      };
    }

    const rawBase =
      input.authMode === "official_openai"
        ? "https://api.openai.com/v1"
        : normalizeBaseUrl(input.baseUrl || "");
    if (!rawBase) {
      return {
        ok: false,
        summary: "缺少 Base URL",
        details: "请先填写接口地址。",
        models: []
      };
    }

    const res = await fetch(`${rawBase}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "x-api-key": apiKey
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) {
      return {
        ok: false,
        summary: `HTTP ${res.status}`,
        details: await res.text().catch(() => res.statusText),
        models: []
      };
    }
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    const models = (data.data ?? []).map((item) => item.id || "").filter(Boolean);
    return {
      ok: true,
      summary: `获取到 ${models.length} 个模型`,
      details: `来自 ${rawBase}/models`,
      models
    };
  } catch (err) {
    return {
      ok: false,
      summary: "获取模型失败",
      details: err instanceof Error ? err.message : String(err),
      models: []
    };
  }
}
