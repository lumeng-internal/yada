import type { YadaTurn } from "../conversation/types";
import type { ChatGPTChatTurn } from "../quota/vibebar/types";

export type WorkspaceKind = "personal" | "work" | "unknown";

export type ConversationSnapshot = {
  conversationId: string;
  revision: number;
  capturedAt: number;
  activeTurns: YadaTurn[];
  quotaTurns: ChatGPTChatTurn[];
  quotaIsWork: boolean;
  quotaUnclassifiedTurns: number;
  quotaOrigin: string | null;
  quotaTemporary: boolean;
  title?: string;
  /** full is the only publishable conversation truth. recent is a tail awaiting merge. */
  coverage?: "full" | "recent";
};

export type ConversationListener = (snapshot: ConversationSnapshot | null) => void | Promise<void>;

export type ReadConversation = (conversationId: string, signal?: AbortSignal) => Promise<ConversationSnapshot>;
