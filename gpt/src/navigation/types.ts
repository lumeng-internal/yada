export type NavigationStatus =
  | "found"
  | "cancelled"
  | "exhausted"
  | "timed-out"
  | "unresolved"
  | "failed";

export type NavigationPath = "direct" | "virtual";

export type NavigationResult = {
  ok: boolean;
  status: NavigationStatus;
  path?: NavigationPath;
  attempts?: number;
};

export type NavigateToOptions = {
  signal?: AbortSignal;
};
