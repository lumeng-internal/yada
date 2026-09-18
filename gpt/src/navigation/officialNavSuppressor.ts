import { OFFICIAL_BUTTON_SELECTOR } from "./officialFastPath";

const STYLE_ID = "chatgpt-yada-official-nav-suppressor";

export class OfficialNavSuppressor {
  private style: HTMLStyleElement | null = null;

  enable(): void {
    if (this.style?.isConnected) return;
    document.getElementById(STYLE_ID)?.remove();
    this.style = document.createElement("style");
    this.style.id = STYLE_ID;
    this.style.textContent = `${OFFICIAL_BUTTON_SELECTOR}{opacity:0!important;pointer-events:none!important;}`;
    document.documentElement.append(this.style);
  }

  disable(): void {
    this.style?.remove();
    document.getElementById(STYLE_ID)?.remove();
    this.style = null;
  }

  dispose(): void {
    this.disable();
  }
}
