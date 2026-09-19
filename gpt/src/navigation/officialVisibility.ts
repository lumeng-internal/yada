import { RAIL_HOST_ID } from "../rail/view";
import { listOfficialNavigationRoots } from "./nativeCapability";

export const OFFICIAL_NAV_STYLE_ID = "chatgpt-yada-official-nav-visibility-style";

const ROOT_AT_END = `main [class$="_convSearchResultHighlightRoot"]`;
const ROOT_BEFORE_SPACE = `main [class*="_convSearchResultHighlightRoot "]`;
const FIXED_CHILD = '> [class~="fixed"][class~="inset-e-4"][class~="top-1/2"][class~="z-20"][class~="-translate-y-1/2"]:not([data-yada-root])';

export type OfficialVisibilityGate = {
  yadaReady: boolean;
  officialReady: boolean;
};

export function officialNavigationHideGate(options: {
  conversationPage: boolean;
  snapshot: { activeTurns: readonly unknown[] } | null;
}): OfficialVisibilityGate {
  const host = document.getElementById(RAIL_HOST_ID);
  return {
    yadaReady: Boolean(
      options.conversationPage
      && options.snapshot
      && options.snapshot.activeTurns.length > 0
      && host
      && !host.hidden
    ),
    officialReady: listOfficialNavigationRoots().length === 1
  };
}

export class OfficialNavigationVisibilityController {
  private yadaReady = false;
  private observer: MutationObserver | null = null;
  private raf = 0;

  update(gate: OfficialVisibilityGate): void {
    this.yadaReady = gate.yadaReady;
    this.apply();
    if (this.yadaReady) this.ensureWatch();
    else this.stopWatch();
  }

  dispose(): void {
    this.yadaReady = false;
    this.stopWatch();
    this.removeStyle();
  }

  private apply(): void {
    this.setHidden(this.yadaReady && listOfficialNavigationRoots().length === 1);
  }

  private setHidden(hidden: boolean): void {
    if (hidden) this.ensureStyle();
    else this.removeStyle();
  }

  private ensureWatch(): void {
    if (this.observer) return;
    this.observer = new MutationObserver(() => this.scheduleApply());
    this.observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"]
    });
  }

  private stopWatch(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private scheduleApply(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.apply();
    });
  }

  private ensureStyle(): void {
    if (document.getElementById(OFFICIAL_NAV_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = OFFICIAL_NAV_STYLE_ID;
    style.textContent = `
${ROOT_AT_END} ${FIXED_CHILD},
${ROOT_BEFORE_SPACE} ${FIXED_CHILD} {
  opacity: 0 !important;
  pointer-events: none !important;
}
`;
    document.head.append(style);
  }

  private removeStyle(): void {
    document.getElementById(OFFICIAL_NAV_STYLE_ID)?.remove();
  }
}
