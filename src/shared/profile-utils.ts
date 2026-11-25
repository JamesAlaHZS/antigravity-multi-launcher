import type { EngineType, ProfileRecord } from "./types.js";

export const ENGINE_NAME_PREFIX: Record<EngineType, string> = {
  antigravity: "anti-",
  codex: "cx-"
};

export const ENGINE_SORT_ORDER: Record<EngineType, number> = {
  antigravity: 0,
  codex: 1
};

const ANTIGRAVITY_PREFIX_RE = /^anti[-_\s]+(.*)$/i;
const CODEX_PREFIX_RE = /^cx[-_\s]+(.*)$/i;
const ANY_ENGINE_PREFIX_RE = /^(?:anti|cx)[-_\s]+(.*)$/i;

export function getEnginePrefix(engine: EngineType): string {
  return ENGINE_NAME_PREFIX[engine];
}

export function stripEnginePrefix(name: string, engine?: EngineType): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  const regex =
    engine === "antigravity"
      ? ANTIGRAVITY_PREFIX_RE
      : engine === "codex"
        ? CODEX_PREFIX_RE
        : ANY_ENGINE_PREFIX_RE;
  const match = regex.exec(trimmed);
  if (!match) return trimmed;
  const rest = match[1].trim();
  return rest || trimmed;
}

export function normalizeProfileName(rawName: string, engine: EngineType): string {
  const trimmed = rawName.trim();
  if (!trimmed) return "";

  const prefix = ENGINE_NAME_PREFIX[engine];
  const barePrefix = prefix.slice(0, -1); // "anti" | "cx"

  if (trimmed.toLowerCase() === barePrefix) {
    return barePrefix;
  }

  const ownRegex = engine === "antigravity" ? ANTIGRAVITY_PREFIX_RE : CODEX_PREFIX_RE;
  const ownMatch = ownRegex.exec(trimmed);
  if (ownMatch) {
    const body = ownMatch[1].trim();
    return body ? `${prefix}${body}` : barePrefix;
  }

  return `${prefix}${trimmed}`;
}

export function switchEnginePrefix(rawName: string, targetEngine: EngineType): string {
  const trimmed = rawName.trim();
  if (!trimmed) return "";

  const match = ANY_ENGINE_PREFIX_RE.exec(trimmed);
  if (match) {
    const body = match[1].trim();
    return body
      ? `${ENGINE_NAME_PREFIX[targetEngine]}${body}`
      : ENGINE_NAME_PREFIX[targetEngine].slice(0, -1);
  }

  const lower = trimmed.toLowerCase();
  if (lower === "anti" || lower === "cx") {
    return ENGINE_NAME_PREFIX[targetEngine].slice(0, -1);
  }

  return trimmed;
}

export function getProfileAvatarLabel(profile: Pick<ProfileRecord, "name" | "engine">): string {
  const stripped = stripEnginePrefix(profile.name, profile.engine);
  const source = stripped || profile.name.trim();
  return source ? source.slice(0, 1).toUpperCase() : "?";
}

export function compareProfiles(a: ProfileRecord, b: ProfileRecord): number {
  const engineDiff =
    (ENGINE_SORT_ORDER[a.engine] ?? 99) - (ENGINE_SORT_ORDER[b.engine] ?? 99);
  if (engineDiff !== 0) {
    return engineDiff;
  }

  const statusOrderA = a.status === "deleted" ? 1 : 0;
  const statusOrderB = b.status === "deleted" ? 1 : 0;
  if (statusOrderA !== statusOrderB) {
    return statusOrderA - statusOrderB;
  }

  const nameA = normalizeProfileName(a.name, a.engine);
  const nameB = normalizeProfileName(b.name, b.engine);
  const nameDiff = nameA.localeCompare(nameB, undefined, {
    numeric: true,
    sensitivity: "base"
  });
  if (nameDiff !== 0) {
    return nameDiff;
  }

  const exactNameDiff = nameA.localeCompare(nameB, undefined, { numeric: true });
  if (exactNameDiff !== 0) {
    return exactNameDiff;
  }

  return a.id.localeCompare(b.id, undefined, { numeric: true });
}

export function sortProfiles(profiles: readonly ProfileRecord[]): ProfileRecord[] {
  return [...profiles].sort(compareProfiles);
}
