import type { YadaTurn } from "../conversation/types";

export type WorkspaceKind = "personal" | "work" | "unknown";

export type AssistantUsageEventCandidate = {
  assistantMessageId: string;
  conversationId: string;
  createdAt: number | null;
  observedAt: number;
  modelSlug: string | null;
  status: "final" | "unknown";
  workspaceKind: WorkspaceKind;
};

export type ConversationSnapshot = {
  conversationId: string;
  revision: number;
  capturedAt: number;
  activeTurns: YadaTurn[];
  assistantEvents: AssistantUsageEventCandidate[];
  title?: string;
};

export type ConversationLoadOptions = {
  signal?: AbortSignal;
  force?: boolean;
};

export type ConversationListener = (snapshot: ConversationSnapshot | null) => void;
