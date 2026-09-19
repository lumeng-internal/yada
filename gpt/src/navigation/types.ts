export type NavigationPath = "direct" | "official-button" | "stable-slot";

export type NavigationFailure =
  | "cancelled"
  | "unsupported"
  | "timeout"
  | "stale-target"
  | "identity-conflict"
  | "failed";

export type NavigationResult =
  | { ok: true; path: NavigationPath }
  | { ok: false; status: NavigationFailure };

export type NavigateToOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type NavigationDiagnostics = {
  conversationId: string;
  targetIndex: number;
  targetMessageId: string;
  path: NavigationPath | null;
  officialButtonCount: number;
  expectedTurnCount: number;
  slotCount: number;
  reloadAttempted: boolean;
  yadaScrollWrites: number;
  alignmentAttempts: number;
  result: NavigationPath | NavigationFailure;
  duration: number;
};
