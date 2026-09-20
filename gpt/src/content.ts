import { ConversationSync } from "./core/conversationSync";
import { OfficialNavigatorHydrator } from "./nativeNavigator/hydrator";
import { NATIVE_NAV_CHANNEL, record } from "./nativeNavigator/protocol";
import { isChatGptConversationPage, isChatGptPage, getConversationIdFromUrl } from "./platform/chatgptAdapter";
import { QuotaTracker } from "./quota/tracker";
import { YadaToolbar } from "./ui/toolbar";

class ChatGptYadaApp {
  private sync: ConversationSync | null = null;
  private hydrator: OfficialNavigatorHydrator | null = null;
  private toolbar: YadaToolbar | null = null;
  private quota: QuotaTracker | null = null;
  private messageDispose: (() => void) | null = null;

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
    addEventListener("message", this.onRouteMessage);
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
    removeEventListener("message", this.onRouteMessage);
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

  private readonly onRouteMessage = (event: MessageEvent): void => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = record(event.data);
    if (message?.channel !== NATIVE_NAV_CHANNEL || message.kind !== "route") return;
    this.toolbar?.closePanels();
    this.hydrator?.resetRoute();
    this.syncPageState();
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
