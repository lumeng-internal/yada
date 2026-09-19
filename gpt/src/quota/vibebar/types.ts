/**
 * Upstream: AstroQore/vibe-bar
 * Upstream file: Sources/VibeBarCore/Adapters/ChatGPTChatProModels.swift
 *               Sources/VibeBarCore/Models/ChatGPTChatSettings.swift
 *               Sources/VibeBarCore/Models/QuotaQuantity.swift
 * Commit: af26391c5bcc074108072af8f2807fc4c47edf21
 * License: AGPL-3.0
 * Port: Swift → TypeScript for ChatGPT Yada
 */

export type ChatGPTChatTurn = {
  id: string;
  createdAt: number;
  model: string;
};

export type ChatGPTChatModelLimit = {
  model: string;
  resetsAt: number | null;
  fallbackModel: string | null;
};

export type ChatGPTChatConversation = {
  updatedAt: number;
  turns: ChatGPTChatTurn[];
  isWork: boolean;
  unclassifiedTurns: number;
};

export type ChatGPTChatProAllowance = {
  id: string;
  group: string;
  title: string;
  models: Set<string>;
  limit: number;
  windowSeconds: number;
};

export type QuotaQuantity = {
  used: number | null;
  remaining: number | null;
  limit: number | null;
  isEstimated: boolean;
  coverageComplete: boolean;
};

export type QuotaBucket = {
  id: string;
  title: string;
  shortLabel: string;
  usedPercent: number;
  resetAt: number | null;
  rawWindowSeconds: number;
  groupTitle: string;
  quantity: QuotaQuantity;
  hasRollingReset: boolean;
};

export type ChatGPTChatHistorySummary = {
  queriedAt: number;
  observedFrom: number;
  complete: boolean;
  conversationsRead: number;
  excludedWorkConversations: number;
  unclassifiedTurns: number;
  failedConversations: number;
  retryableFailures: number;
  permanentFailures: number;
  cancelled: boolean;
  hitDetailBudget: boolean;
  hitDeadline: boolean;
};

export type ChatGPTChatHistoryCache = {
  conversations: Record<string, ChatGPTChatConversation>;
};

export type ChatPlan = "pro" | "prolite" | null;
