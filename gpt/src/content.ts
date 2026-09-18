import { ConversationSync } from "./core/conversationSync";
import { NavigatorController } from "./navigation/navigatorController";
import { isChatGptConversationPage, isChatGptPage, getConversationIdFromUrl } from "./platform/chatgptAdapter";
import { QuotaTracker } from "./quota/tracker";
import { YadaRailController } from "./rail/controller";
import { YadaToolbar } from "./ui/toolbar";
import { observeRouteChange } from "./utils/route";

class ChatGptYadaApp {
  private readonly sync = new ConversationSync();
  private navigator: NavigatorController | null = null;
  private rail: YadaRailController | null = null;
  private toolbar: YadaToolbar | null = null;
  private quota: QuotaTracker | null = null;
  private routeDispose: (() => void) | null = null;
  private messageDispose: (() => void) | null = null;

  mount(): void {
    this.sync.mountPageObserver();
    this.navigator = new NavigatorController(this.sync);
    this.navigator.mount();
    this.rail = new YadaRailController(this.sync, this.navigator);
    this.rail.mount();
    this.quota = new QuotaTracker(this.sync);
    this.quota.mount();
    this.toolbar = new YadaToolbar((assistant) => this.rail?.setPreviewMode(assistant), this.sync);
    this.toolbar.mount();
    this.syncPageState();
    this.routeDispose = observeRouteChange(() => {
      this.toolbar?.closePanels();
      this.rail?.clear();
      this.navigator?.cancel();
      this.syncPageState();
    });
    const onMessage = (
      message: { type?: string; conversationId?: string },
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void
    ): boolean => {
      if (message?.type !== "quota/refresh-current") return false;
      void this.quota?.refreshCurrent()
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ error: String(error) }));
      return true;
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
    this.sync.dispose();
  };

  private syncPageState(): void {
    this.toolbar?.ensurePlacement();
    this.toolbar?.setVisible(isChatGptPage());
    const copy = document.getElementById("chatgpt-yada-toolbar-host")?.shadowRoot?.querySelector<HTMLButtonElement>("[data-copy-all]");
    if (copy) copy.hidden = !isChatGptConversationPage();
    this.sync.setActiveConversation(getConversationIdFromUrl());
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
