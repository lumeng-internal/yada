import { CHATGPT_OFFICIAL_NAV_FIXED_CHILD_SELECTOR, CHATGPT_OFFICIAL_NAV_ROOT_SELECTOR } from "./nativeCapability";

export const OFFICIAL_NAV_STYLE_ID = "chatgpt-yada-official-nav-visibility-style";

const ROOT_AT_END = CHATGPT_OFFICIAL_NAV_ROOT_SELECTOR.split(",")[0]!;
const ROOT_BEFORE_SPACE = CHATGPT_OFFICIAL_NAV_ROOT_SELECTOR.split(",")[1]!;
const FIXED_CHILD = `> ${CHATGPT_OFFICIAL_NAV_FIXED_CHILD_SELECTOR.map((token) => `[class~="${token}"]`).join("")}:not([data-yada-root])`;

export class OfficialNavigationVisibilityController {
  private enabled = false;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) this.ensureStyle();
    else this.removeStyle();
  }

  dispose(): void {
    this.enabled = false;
    this.removeStyle();
  }

  private ensureStyle(): void {
    if (!this.enabled || document.getElementById(OFFICIAL_NAV_STYLE_ID)) return;
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
