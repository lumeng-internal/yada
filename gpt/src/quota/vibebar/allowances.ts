/**
 * Upstream: AstroQore/vibe-bar
 * Upstream file: Sources/VibeBarCore/Adapters/ChatGPTChatProModels.swift
 * Commit: af26391c5bcc074108072af8f2807fc4c47edf21
 * License: AGPL-3.0
 * Port: Swift → TypeScript for ChatGPT Yada
 */

import type { ChatGPTChatProAllowance, ChatPlan } from "./types";

export const GPT6_PRO = "gpt-6-pro";
export const SOL_PRO = "gpt-5-6-pro";
export const WEEK_SECONDS = 7 * 86_400;
export const DAY_SECONDS = 86_400;
export const GPT6_PRO_NAME = "GPT-6 Astra Pro";
export const SOL_PRO_NAME = "GPT-5.6 Sol Pro";
export const PRO_MODELS_NAME = "Pro Models";

export function allowances(plan: string | null | undefined): ChatGPTChatProAllowance[] {
  switch (plan?.trim().toLowerCase()) {
    case "pro":
      return [
        { id: "gpt6_pro_weekly", group: GPT6_PRO_NAME, title: "Weekly", models: new Set([GPT6_PRO]), limit: 200, windowSeconds: WEEK_SECONDS },
        { id: "sol_pro_daily", group: SOL_PRO_NAME, title: "Daily", models: new Set([SOL_PRO]), limit: 170, windowSeconds: DAY_SECONDS },
        { id: "pro_daily", group: PRO_MODELS_NAME, title: "Daily", models: new Set([GPT6_PRO, SOL_PRO]), limit: 200, windowSeconds: DAY_SECONDS }
      ];
    case "prolite":
      return [
        { id: "pro_weekly", group: PRO_MODELS_NAME, title: "Weekly", models: new Set([GPT6_PRO, SOL_PRO]), limit: 50, windowSeconds: WEEK_SECONDS }
      ];
    default:
      return [];
  }
}

export function parsePlanType(value: unknown): ChatPlan {
  if (!value || typeof value !== "object") return null;
  const raw = (value as { plan_type?: unknown }).plan_type;
  if (typeof raw !== "string") return null;
  const plan = raw.trim().toLowerCase();
  if (plan === "pro" || plan === "prolite") return plan;
  return null;
}
