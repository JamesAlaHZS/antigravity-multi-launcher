import type { LanguageCode, ProfileAuthMode } from "@shared/types";

export const AUTH_MODE_LABELS: Record<LanguageCode, Record<ProfileAuthMode, string>> = {
  "zh-CN": {
    google_account: "Google 账号独立登录",
    gemini_api_key: "Gemini 官方 API Key",
    custom_gateway: "自定义 LLM Gateway / 反代",
    chatgpt_account: "ChatGPT 账号独立登录",
    official_openai: "OpenAI 官方 API Key",
    third_party_responses: "第三方 Responses 兼容接口"
  },
  en: {
    google_account: "Google Account Login (Isolated)",
    gemini_api_key: "Official Gemini API Key",
    custom_gateway: "Custom LLM Gateway / Proxy",
    chatgpt_account: "ChatGPT Account Login (Isolated)",
    official_openai: "Official OpenAI API Key",
    third_party_responses: "Third-Party Responses API"
  }
};

export const COLOR_PALETTE = [
  "#4F46E5",
  "#2563EB",
  "#0EA5E9",
  "#10B981",
  "#F59E0B",
  "#EC4899",
  "#8B5CF6",
  "#EF4444"
];

export function t(lang: LanguageCode, zh: string, en: string): string {
  return lang === "zh-CN" ? zh : en;
}
