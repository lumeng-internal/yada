export const TARGET_NUM_TURNS = 100;
export const PREPARE_TTL_MS = 10_000;
export const PREPARE_RENEW_MS = 4_000;
export const MAX_CAPTURE_BYTES = 16 * 1024 * 1024;
export const MAX_CAPTURE_MS = 8_000;
export const MAX_CLONE_READERS = 2;
export const MAX_MESSAGE_IDS = 10_000;
export const PAGE_COMMIT_MS = 240;
export const USER_IDLE_MS = 2_500;
export const MAX_RESUMES = 3;
export const MAX_EXTRA_PAGES = 20;
export const MAX_ACTIVE_MS = 60_000;
export const MIN_USER_TURNS = 5;
export const MIN_VIEWPORT_WIDTH = 1024;
export const READ_DRIFT_PX = 8;
export const MISSING_ANCHOR_FRAMES = 3;
export const STALLED_ROUNDS = 2;
export const SENTINEL_WAIT_MS = 3_000;
export const SENTINEL_REPLACE_MS = 1_000;
export const NATIVE_NAV_WAIT_MS = 2_500;
export const DOM_COALESCE_MS = 80;
export const SENTINEL_TEST_ID = "conversation-pagination-sentinel";

export const YADA_PAGE_SOURCE = "chatgpt-yada-page";
export const YADA_CONTENT_SOURCE = "chatgpt-yada-content";

export type HistoryBoundary = "unknown" | "more" | "complete";
export type HistoryIssue =
  | "unlinked"
  | "stalled"
  | "limit"
  | "http-error"
  | "capture-unavailable"
  | null;

export interface HistoryState {
  conversationId: string;
  generation: number;
  initialVersion: number;
  revision: number;
  pending: number;
  pages: number;
  messages: number;
  prompts: number;
  boundary: HistoryBoundary;
  cursor: string | null;
  issue: HistoryIssue;
  boosted: boolean;
}

export type CaptureKind = "initial" | "older";

export interface CaptureContext {
  requestId: number;
  conversationId: string;
  routeGeneration: number;
  initialVersion: number;
  kind: CaptureKind;
  before: string | null;
}

export type ConversationApiKind = "paginated-initial" | "paginated-messages";

export interface ConversationApiMatch {
  kind: ConversationApiKind;
  conversationId: string;
}

export interface HistoryPageInfo {
  has_previous_page?: boolean;
  start_cursor?: string | null;
}

export interface HistoryPayload {
  current_node?: string | null;
  messages?: Array<{ id?: string; author?: { role?: string } }>;
  page_info?: HistoryPageInfo;
}

export type PrepareStatusKind = "hidden" | "preparing" | "ready" | "incomplete";

export interface PrepareStatus {
  kind: PrepareStatusKind;
  current?: number;
  total?: number;
  reason?: string;
  title?: string;
}

export interface PageToContentMessage {
  source: typeof YADA_PAGE_SOURCE;
  type: "history-state";
  state: HistoryState;
}

export interface ContentToPageMessage {
  source: typeof YADA_CONTENT_SOURCE;
  type: "prepare-boost" | "request-state";
  conversationId: string;
  active?: boolean;
}

export function historySessionKey(state: Pick<HistoryState, "conversationId" | "generation" | "initialVersion">): string {
  return `${state.conversationId}:${state.generation}:${state.initialVersion}`;
}

export function emptyHistoryState(conversationId = ""): HistoryState {
  return {
    conversationId,
    generation: 0,
    initialVersion: 0,
    revision: 0,
    pending: 0,
    pages: 0,
    messages: 0,
    prompts: 0,
    boundary: "unknown",
    cursor: null,
    issue: null,
    boosted: false
  };
}

export function waitForPageCommit(ms = PAGE_COMMIT_MS): Promise<void> {
  return new Promise(resolve => {
    const finish = (): void => {
      window.setTimeout(resolve, ms);
    };
    if (document.visibilityState === "hidden" || typeof requestAnimationFrame !== "function") {
      window.setTimeout(finish, 50);
      return;
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.setTimeout(finish, 0));
    });
  });
}
