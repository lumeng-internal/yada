import { ConversationSync } from "./core/conversationSync";
import { OfficialNavigatorHydrator } from "./nativeNavigator/hydrator";
import { isChatGptConversationPage, isChatGptPage, getConversationIdFromUrl } from "./platform/chatgptAdapter";
import { QuotaTracker } from "./quota/tracker";
import { YadaToolbar } from "./ui/toolbar";
import { observeRouteChange } from "./utils/route";

class ChatGptYadaApp {
  private sync: ConversationSync | null = null;
  private hydrator: OfficialNavigatorHydrator | null = null;
  private toolbar: YadaToolbar | null = null;
  private quota: QuotaTracker | null = null;
  private routeDispose: (() => void) | null = null;
  private messageDispose: (() => void) | null = null;
  private hostGuard: MutationObserver | null = null;
  private remounts = 0;

  mount(): void {
    this.sync = new ConversationSync();
    this.sync.mountPageObserver();
    this.hydrator = new OfficialNavigatorHydrator(this.sync);
    this.hydrator.mount();
    this.quota = new QuotaTracker(this.sync);
    this.quota.mount();
    this.toolbar = new YadaToolbar(this.sync);
    this.toolbar.mount();
    this.syncPageState();
    this.routeDispose = observeRouteChange(() => {
      this.toolbar?.closePanels();
      this.hydrator?.resetRoute();
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
    this.hostGuard = new MutationObserver(() => {
      if (document.getElementById("chatgpt-yada-toolbar-host")) return;
      if (this.remounts >= 5) return;
      this.remounts += 1;
      this.dispose();
      this.mount();
    });
    this.hostGuard.observe(document, { childList: true });
    this.hostGuard.observe(document.documentElement, { childList: true });
  }

  dispose = (): void => {
    this.hostGuard?.disconnect();
    this.hostGuard = null;
    this.routeDispose?.();
    this.routeDispose = null;
    this.messageDispose?.();
    this.messageDispose = null;
    this.hydrator?.dispose();
    this.hydrator = null;
    this.quota?.dispose();
    this.quota = null;
    this.toolbar?.dispose();
    this.toolbar = null;
    this.sync?.dispose();
    this.sync = null;
  };

  private syncPageState(): void {
    this.toolbar?.ensurePlacement();
    this.toolbar?.setVisible(isChatGptPage());
    const copy = document.getElementById("chatgpt-yada-toolbar-host")?.shadowRoot?.querySelector<HTMLButtonElement>("[data-copy-all]");
    if (copy) copy.hidden = !isChatGptConversationPage();
    this.sync?.setActiveConversation(getConversationIdFromUrl());
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
