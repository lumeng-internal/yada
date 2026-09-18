import { ConversationRepository } from "./core/conversationRepository";
import { NavigatorController } from "./navigation/navigatorController";
import { isChatGptConversationPage, isChatGptPage, getConversationIdFromUrl } from "./platform/chatgptAdapter";
import { QuotaTracker } from "./quota/tracker";
import { YadaRailController } from "./rail/controller";
import { YadaToolbar } from "./ui/toolbar";
import { observeRouteChange } from "./utils/route";

class ChatGptYadaApp {
  private readonly repository = new ConversationRepository();
  private navigator: NavigatorController | null = null;
  private rail: YadaRailController | null = null;
  private toolbar: YadaToolbar | null = null;
  private quota: QuotaTracker | null = null;
  private routeDispose: (() => void) | null = null;
  private messageDispose: (() => void) | null = null;

  mount(): void {
    this.navigator = new NavigatorController(this.repository);
    this.navigator.mount();
    this.rail = new YadaRailController(this.repository, this.navigator);
    this.rail.mount();
    this.quota = new QuotaTracker(this.repository);
    this.quota.mount();
    this.toolbar = new YadaToolbar((assistant) => this.rail?.setPreviewMode(assistant), this.repository);
    this.toolbar.mount();
    this.syncPageState();
    this.routeDispose = observeRouteChange(() => {
      this.toolbar?.closePanels();
      this.rail?.clear();
      this.navigator?.cancel();
      this.syncPageState();
    });
    const onMessage = (message: { type?: string; conversationId?: string }): void => {
      if (message?.type === "quota/refresh-current") void this.quota?.refreshCurrent();
    };
    chrome.runtime.onMessage.addListener(onMessage);
    this.messageDispose = () => chrome.runtime.onMessage.removeListener(onMessage);
  }

  dispose = (): void => {
    this.routeDispose?.();
    this.routeDispose = null;
    this.messageDispose?.();
    this.messageDispose = null;
    this.quota?.dispose();
    this.quota = null;
    this.rail?.dispose();
    this.rail = null;
    this.navigator?.dispose();
    this.navigator = null;
    this.toolbar?.dispose();
    this.toolbar = null;
    this.repository.dispose();
  };

  private syncPageState(): void {
    this.toolbar?.ensurePlacement();
    this.toolbar?.setVisible(isChatGptPage());
    const copy = document.getElementById("chatgpt-yada-toolbar-host")?.shadowRoot?.querySelector<HTMLButtonElement>("[data-copy-all]");
    if (copy) copy.hidden = !isChatGptConversationPage();
    const id = getConversationIdFromUrl();
    this.quota?.setConversationId(id);
    this.repository.setActiveConversation(id);
  }
}

if (isChatGptPage()) {
  const key = "__chatgptYadaDispose";
  const state = globalThis as typeof globalThis & { [key]?: () => void };
  state[key]?.();
  const app = new ChatGptYadaApp();
  app.mount();
  const onPageHide = (): void => app.dispose();
  const onPageShow = (event: PageTransitionEvent): void => {
    if (event.persisted) {
      app.dispose();
      app.mount();
    }
  };
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
  state[key] = () => {
    app.dispose();
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
  };
}
