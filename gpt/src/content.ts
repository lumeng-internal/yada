import { isChatGptConversationPage, isChatGptPage } from "./platform/chatgptAdapter";
import { YadaToolbar } from "./ui/toolbar";
import { RailController } from "./rail/controller";
import { observeRouteChange } from "./utils/route";

class ChatGptYadaApp {
  private rail: RailController | null = null;
  private toolbar: YadaToolbar | null = null;
  private routeDispose: (() => void) | null = null;
  mount(): void {
    this.rail = new RailController();
    this.toolbar = new YadaToolbar(assistant => this.rail?.setPreviewMode(assistant));
    this.toolbar.mount(); this.syncPageState();
    this.routeDispose = observeRouteChange(() => { this.toolbar?.closePanels(); this.syncPageState(); });
  }
  dispose = (): void => {
    this.routeDispose?.(); this.routeDispose = null;
    this.rail?.dispose(); this.rail = null;
    this.toolbar?.dispose(); this.toolbar = null;
  };
  private syncPageState(): void {
    this.toolbar?.ensurePlacement();
    // The prompt library is also useful before the first message on a new conversation.
    this.toolbar?.setVisible(isChatGptPage());
    const copy = document.getElementById("chatgpt-yada-toolbar-host")?.shadowRoot?.querySelector<HTMLButtonElement>("[data-copy-all]");
    if (copy) copy.hidden = !isChatGptConversationPage();
    this.rail?.syncRoute();
  }
}
if (isChatGptPage()) {
  const key = "__chatgptYadaDispose";
  const state = globalThis as typeof globalThis & { [key]?: () => void };
  state[key]?.();
  const app = new ChatGptYadaApp(); app.mount();
  const onPageHide = (): void => app.dispose();
  const onPageShow = (event: PageTransitionEvent): void => { if (event.persisted) { app.dispose(); app.mount(); } };
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
  state[key] = () => {
    app.dispose();
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
  };
}
