/**
 * Upstream: AstroQore/vibe-bar
 * Upstream file: Sources/VibeBarCore/Adapters/ChatGPTChatProModels.swift
 * Commit: af26391c5bcc074108072af8f2807fc4c47edf21
 * License: AGPL-3.0
 * Port: Swift → TypeScript for ChatGPT Yada
 */

import { parseDate, validModel, type JsonObject } from "./json";
import type { ChatGPTChatModelLimit } from "./types";

export function modelLimits(data: unknown, now: number): ChatGPTChatModelLimit[] {
  if (!data || typeof data !== "object") return [];
  const rows = (data as JsonObject).model_limits;
  if (!Array.isArray(rows)) return [];
  const limits: ChatGPTChatModelLimit[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as JsonObject;
    const model = typeof record.model_slug === "string" ? record.model_slug : null;
    if (!model || !validModel(model)) continue;
    const reset = parseDate(record.resets_after);
    if (reset != null && reset <= now) continue;
    const fallbackRaw = typeof record.using_default_model_slug === "string" ? record.using_default_model_slug : null;
    const fallbackModel = fallbackRaw && validModel(fallbackRaw) ? fallbackRaw : null;
    limits.push({ model, resetsAt: reset, fallbackModel });
  }
  return limits;
}
