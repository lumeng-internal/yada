import type { NavigationDiagnostics } from "./types";

const DEBUG_KEY = "chatgpt-yada:nav-debug";

declare global {
  var __YADA_NAV_DIAGNOSTICS__: NavigationDiagnostics | undefined;
}

export function isNavDebugEnabled(): boolean {
  try {
    return localStorage.getItem(DEBUG_KEY) === "1";
  } catch {
    return false;
  }
}

export function publishNavigationDiagnostics(snapshot: NavigationDiagnostics | null): void {
  if (!isNavDebugEnabled() || !snapshot) {
    delete globalThis.__YADA_NAV_DIAGNOSTICS__;
    return;
  }
  globalThis.__YADA_NAV_DIAGNOSTICS__ = snapshot;
}
