/**
 * Upstream: AstroQore/vibe-bar
 * Upstream file: Sources/VibeBarCore/Adapters/ChatGPTChatProModels.swift
 *               Sources/VibeBarCore/Adapters/ChatGPTChatParser.swift
 *               Sources/VibeBarCore/Utilities/PrivacyPreservingHash.swift
 * Commit: af26391c5bcc074108072af8f2807fc4c47edf21
 * License: AGPL-3.0
 * Port: Swift → TypeScript for ChatGPT Yada
 */

import type {
  ChatGPTChatConversation,
  ChatGPTChatProAllowance,
  ChatGPTChatTurn,
  QuotaBucket,
  QuotaQuantity
} from "./types";
import { asObject, parseDate, validModel, type JsonObject } from "./json";
import { modelLimits } from "./modelLimits";

const HEX = "0123456789abcdef";

export async function identity(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const bytes = new Uint8Array(digest);
  let out = "chat-";
  for (const byte of bytes) {
    out += HEX[byte >> 4];
    out += HEX[byte & 0x0f];
  }
  return out;
}

export { asObject, parseDate, validModel };

export function isWork(origin: string | null | undefined, model: string | null | undefined): boolean {
  const originKey = origin?.toLowerCase() ?? "";
  const modelKey = model?.toLowerCase() ?? "";
  return ["tpp", "flora", "codex"].includes(originKey)
    || modelKey.endsWith("-wm")
    || modelKey.includes("codex");
}

export function isTemporary(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as JsonObject;
  return record.is_temporary_chat === true || record.isTemporary === true;
}

export function conversationOrigin(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const origin = (value as JsonObject).conversation_origin;
  return typeof origin === "string" && origin.trim() ? origin.trim() : null;
}

export async function parseConversation(
  data: unknown,
  id: string,
  updatedAt: number,
  since: number
): Promise<ChatGPTChatConversation> {
  const root = asObject(data);
  const conversationId = typeof root.conversation_id === "string" ? root.conversation_id
    : typeof root.id === "string" ? root.id
    : null;
  const mapping = root.mapping;
  if (conversationId !== id || !mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
    throw new Error("ChatGPT Chat conversation identity or mapping is missing.");
  }
  const origin = conversationOrigin(root);
  const defaultModel = typeof root.default_model_slug === "string" ? root.default_model_slug : null;
  if (isWork(origin, defaultModel)) {
    return { updatedAt, turns: [], isWork: true, unclassifiedTurns: 0 };
  }
  const knownOrigin = origin == null || origin === "chat" || origin === "chatgpt";
  const nodes = mapping as Record<string, JsonObject>;
  const users: Record<string, JsonObject> = {};
  for (const [key, node] of Object.entries(nodes)) {
    const message = messageOf(node);
    if (roleOf(message) !== "user") continue;
    const created = parseDate(message.create_time);
    if (created != null && created < since) continue;
    users[key] = message;
  }
  const replies: Record<string, JsonObject[]> = {};
  const owners = new Map<string, string>(Object.keys(users).map((key) => [key, key]));
  const orphans = new Set<string>();
  for (const [key, node] of Object.entries(nodes)) {
    const message = messageOf(node);
    if (!isFinalAssistant(message)) continue;
    let cursor: string | null = key;
    const path: string[] = [];
    const visited = new Set<string>();
    let owner: string | undefined;
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      const known = owners.get(cursor);
      if (known) {
        owner = known;
        break;
      }
      if (orphans.has(cursor)) break;
      const candidate = messageOf(nodes[cursor]);
      if (roleOf(candidate) === "user") break;
      path.push(cursor);
      cursor = typeof nodes[cursor]?.parent === "string" ? nodes[cursor].parent as string : null;
    }
    if (owner) {
      for (const nodeId of path) owners.set(nodeId, owner);
      (replies[owner] ??= []).push(message);
    } else {
      for (const nodeId of path) orphans.add(nodeId);
    }
  }
  const turns = new Map<string, ChatGPTChatTurn>();
  let unknown = 0;
  for (const [nodeID, user] of Object.entries(users)) {
    const messageID = typeof user.id === "string" ? user.id : "";
    const created = parseDate(user.create_time);
    const reply = newest(replies[nodeID] ?? []);
    const metadata = reply && typeof reply.metadata === "object" && reply.metadata ? reply.metadata as JsonObject : null;
    const model = typeof metadata?.model_slug === "string" ? metadata.model_slug : null;
    if (!knownOrigin || !messageID || created == null || !reply || !model || !validModel(model)) {
      unknown += 1;
      continue;
    }
    if (isWork(origin, model)) continue;
    const key = await identity(`${id}:${messageID}`);
    turns.set(key, { id: key, createdAt: created, model });
  }
  return { updatedAt, turns: [...turns.values()], isWork: false, unclassifiedTurns: unknown };
}

export function proBuckets(
  allowanceList: ChatGPTChatProAllowance[],
  turns: readonly ChatGPTChatTurn[],
  limits: readonly { model: string; resetsAt: number | null }[],
  complete: boolean,
  now: number
): QuotaBucket[] {
  const unique = new Map(turns.map((turn) => [turn.id, turn])).values();
  const uniqueTurns = [...unique];
  const limited = new Map(limits.map((limit) => [limit.model, limit]));
  return allowanceList.map((allowance) => {
    const start = now - allowance.windowSeconds * 1000;
    const used = uniqueTurns.filter((turn) => allowance.models.has(turn.model) && turn.createdAt > start && turn.createdAt <= now).length;
    const exhausted = [...allowance.models].every((model) => limited.has(model));
    let quantity: QuotaQuantity;
    let resetAt: number | null;
    let rolling = false;
    if (exhausted) {
      quantity = { used: allowance.limit, remaining: 0, limit: allowance.limit, isEstimated: true, coverageComplete: true };
      resetAt = Math.max(0, ...[...allowance.models].map((model) => limited.get(model)?.resetsAt ?? 0)) || null;
    } else {
      quantity = {
        used,
        remaining: complete ? Math.max(0, allowance.limit - used) : null,
        limit: allowance.limit,
        isEstimated: true,
        coverageComplete: complete
      };
      const oldest = uniqueTurns
        .filter((turn) => allowance.models.has(turn.model) && turn.createdAt > start && turn.createdAt <= now)
        .map((turn) => turn.createdAt)
        .sort((a, b) => a - b)[0];
      resetAt = (oldest ?? now) + allowance.windowSeconds * 1000;
      rolling = true;
    }
    const usedPercent = quantity.coverageComplete && quantity.limit
      ? Math.min(100, 100 * (quantity.used ?? 0) / quantity.limit)
      : 0;
    return {
      id: allowance.id,
      title: allowance.title,
      shortLabel: allowance.title,
      usedPercent,
      resetAt,
      rawWindowSeconds: allowance.windowSeconds,
      groupTitle: allowance.group,
      quantity,
      hasRollingReset: rolling
    };
  });
}

export { modelLimits };

function messageOf(node: JsonObject | undefined): JsonObject {
  if (!node || typeof node.message !== "object" || !node.message) return {};
  return node.message as JsonObject;
}

function roleOf(message: JsonObject): string | null {
  const author = message.author;
  if (!author || typeof author !== "object") return null;
  const role = (author as JsonObject).role;
  return typeof role === "string" ? role : null;
}

function isFinalAssistant(message: JsonObject): boolean {
  if (roleOf(message) !== "assistant") return false;
  if (message.recipient !== "all") return false;
  if (message.status !== "finished_successfully") return false;
  if (!(message.channel == null || message.channel === "final")) return false;
  const content = message.content;
  const contentType = content && typeof content === "object" ? (content as JsonObject).content_type : null;
  return contentType === "text" || contentType === "multimodal_text";
}

function newest(messages: JsonObject[]): JsonObject | null {
  if (!messages.length) return null;
  return messages.reduce((best, current) => {
    const a = parseDate(best.create_time) ?? 0;
    const b = parseDate(current.create_time) ?? 0;
    return b > a ? current : best;
  });
}
