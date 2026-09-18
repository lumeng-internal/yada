import type { ProModelKind } from "./types";

const GPT6_PRO_ALIASES = new Set([
  "gpt-6-pro",
  "gpt6-pro",
  "gpt-6pro",
  "chatgpt-gpt-6-pro",
  "gpt-6-pro-2026"
]);

const SOL_PRO_ALIASES = new Set([
  "gpt-5.6-sol-pro",
  "gpt-5-6-sol-pro",
  "gpt-5.6-thinking-pro",
  "gpt-5.6-pro",
  "gpt56-sol-pro",
  "chatgpt-gpt-5.6-sol-pro"
]);

export type ModelDetection = {
  kind: ProModelKind;
  slug: string | null;
};

export function detectProModel(slug: string | null | undefined): ModelDetection {
  if (!slug || !slug.trim()) return { kind: "unknown", slug: slug ?? null };
  const normalized = normalizeSlug(slug);
  if (GPT6_PRO_ALIASES.has(normalized) || /^gpt-?6(?:\.0)?-pro(?:-|$)/.test(normalized)) {
    return { kind: "gpt-6-pro", slug };
  }
  if (SOL_PRO_ALIASES.has(normalized) || /^gpt-?5(?:\.|-)6(?:-sol)?-pro(?:-|$)/.test(normalized)) {
    return { kind: "gpt-5.6-sol-pro", slug };
  }
  if (normalized.includes("pro") && (normalized.includes("gpt") || normalized.includes("o1") || normalized.includes("o3") || normalized.includes("sol"))) {
    return { kind: "unknown", slug };
  }
  if (normalized.includes("pro") && !KNOWN_OTHER.has(normalized)) {
    return { kind: "unknown", slug };
  }
  return { kind: "other", slug };
}

const KNOWN_OTHER = new Set(["gpt-5.4", "gpt-4o", "gpt-4.1", "gpt-5", "o3", "o4-mini"]);

function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase().replace(/_/g, "-");
}
