import { ConversationBootGate } from "./core/bootGate";
import { ConversationSync } from "./core/conversationSync";
import { OfficialNavigatorHydrator } from "./nativeNavigator/hydrator";
import { NATIVE_NAV_CHANNEL, record } from "./nativeNavigator/protocol";
import { isChatGptConversationPage, isChatGptPage, getConversationIdFromUrl } from "./platform/chatgptAdapter";
import { QuotaTracker } from "./quota/tracker";
import type { QuotaSnapshot } from "./quota/types";
import { YadaToolbar } from "./ui/toolbar";

const USER_IDLE_MS = 1_500;

export function startIsolated<T>(start: () => T): { value: T | null; error: unknown } {
  try {
    return { value: start(), error: null };
  } catch (error) {
    return { value: null, error };
  }
}

export class ChatGptYadaApp {
  private sync: ConversationSync | null = null;
  private hydrator: OfficialNavigatorHydrator | null = null;
  private toolbar: YadaToolbar | null = null;
  private quota: QuotaTracker | null = null;
  private boot: ConversationBootGate | null = null;
  private messageDispose: (() => void) | null = null;
  private routeListening = false;
  private visibilityListening = false;
  private inputListening = false;
  private lastUserInput = 0;
  private readonly moduleErrors = new Map<string, unknown>();

  mount(page = isChatGptPage()): void {
    if (!page) return;
    this.ensureSync();
    this.ensureToolbar();
    this.toolbar?.setVisible(true);
    this.syncPageState();
    this.ensureBoot();
    this.ensureSyncObserver();
    this.ensureNavigator();
    this.ensureQuota();
    this.ensureQuotaIndicator();
    this.ensureListeners();
  }

  recover(): void {
    if (!isChatGptPage()) return;
    this.mount();
    if (document.visibilityState === "visible") this.boot?.arm(getConversationIdFromUrl());
  }

  dispose = (): void => {
    if (this.routeListening) removeEventListener("message", this.onRouteMessage);
    this.routeListening = false;
    if (this.visibilityListening) document.removeEventListener("visibilitychange", this.onVisibility);
    this.visibilityListening = false;
    this.detachInput();
    this.messageDispose?.();
    this.messageDispose = null;
    this.boot?.dispose();
    this.boot = null;
    this.hydrator?.dispose();
    this.hydrator = null;
    this.quota?.dispose();
    this.quota = null;
    this.toolbar?.dispose();
    this.toolbar = null;
    this.sync?.dispose();
    this.sync = null;
    this.moduleErrors.clear();
  };

  private ensureSync(): void {
    if (this.sync) return;
    const started = startIsolated(() => new ConversationSync());
    this.sync = started.value;
    if (started.error) this.moduleErrors.set("sync", started.error);
  }

  private ensureToolbar(): void {
    if (this.toolbar?.isMounted()) return;
    const started = startIsolated(() => {
      const toolbar = new YadaToolbar();
      toolbar.setConversationSync(this.sync);
      toolbar.mountShell();
      return toolbar;
    });
    if (started.error || !started.value) {
      this.moduleErrors.set("toolbar", started.error ?? new Error("toolbar missing"));
      return;
    }
    this.toolbar = started.value;
    this.moduleErrors.delete("toolbar");
  }

  private ensureBoot(): void {
    if (!this.sync) return;
    if (!this.boot) this.boot = new ConversationBootGate(this.sync);
    if (document.visibilityState === "visible") this.boot.arm(this.sync.getActiveConversationId());
  }

  private ensureSyncObserver(): void {
    if (!this.sync) return;
    const started = startIsolated(() => this.sync?.mountPageObserver());
    if (started.error) this.moduleErrors.set("sync-observer", started.error);
    else this.moduleErrors.delete("sync-observer");
  }

  private ensureNavigator(): void {
    if (this.hydrator || !this.sync) return;
    const started = startIsolated(() => {
      const hydrator = new OfficialNavigatorHydrator(this.sync!);
      try {
        hydrator.mount();
      } catch (error) {
        hydrator.dispose();
        throw error;
      }
      return hydrator;
    });
    if (started.error || !started.value) {
      this.moduleErrors.set("navigator", started.error ?? new Error("navigator missing"));
      return;
    }
    this.hydrator = started.value;
    this.moduleErrors.delete("navigator");
  }

  private ensureQuota(): void {
    if (this.quota || !this.sync) return;
    const started = startIsolated(() => {
      const tracker = new QuotaTracker(this.sync!, {
        blocked: () => this.maintenanceBlocked()
      });
      try {
        tracker.mount();
      } catch (error) {
        tracker.dispose();
        throw error;
      }
      return tracker;
    });
    if (started.error || !started.value) {
      this.moduleErrors.set("quota", started.error ?? new Error("quota missing"));
      return;
    }
    this.quota = started.value;
    this.moduleErrors.delete("quota");
  }

  private ensureQuotaIndicator(): void {
    if (!this.toolbar || this.toolbar.hasQuotaIndicator()) return;
    const started = startIsolated(() => this.toolbar?.attachQuotaIndicator({
      onRefresh: (snapshot) => this.refreshQuotaLight(snapshot)
    }));
    if (started.error) {
      this.moduleErrors.set("quota-indicator", started.error);
      this.toolbar.showQuotaFault();
      return;
    }
    this.moduleErrors.delete("quota-indicator");
  }

  private async refreshQuotaLight(snapshot: QuotaSnapshot | null): Promise<void> {
    if (!this.quota) throw new Error("额度模块暂不可用");
    await this.quota.refreshCurrentLight(snapshot);
  }

  private ensureListeners(): void {
    if (!this.routeListening) {
      addEventListener("message", this.onRouteMessage);
      this.routeListening = true;
    }
    if (!this.visibilityListening) {
      document.addEventListener("visibilitychange", this.onVisibility);
      this.visibilityListening = true;
    }
    if (!this.inputListening) {
      addEventListener("pointerdown", this.onUserInput, { capture: true, passive: true });
      addEventListener("keydown", this.onUserInput, { capture: true, passive: true });
      this.inputListening = true;
    }
    if (this.messageDispose) return;
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

  private detachInput(): void {
    if (!this.inputListening) return;
    removeEventListener("pointerdown", this.onUserInput, true);
    removeEventListener("keydown", this.onUserInput, true);
    this.inputListening = false;
  }

  private readonly onUserInput = (): void => {
    this.lastUserInput = Date.now();
  };

  private readonly onVisibility = (): void => {
    if (document.visibilityState !== "visible") return;
    this.recover();
  };

  private readonly onRouteMessage = (event: MessageEvent): void => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = record(event.data);
    if (message?.channel !== NATIVE_NAV_CHANNEL || message.kind !== "route") return;
    this.toolbar?.closePanels();
    this.boot?.clear();
    this.hydrator?.resetRoute();
    this.syncPageState();
    this.recover();
  };

  private syncPageState(): void {
    this.toolbar?.ensurePlacement();
    this.toolbar?.setVisible(isChatGptPage());
    const copy = document.getElementById("chatgpt-yada-toolbar-host")?.shadowRoot?.querySelector<HTMLButtonElement>("[data-copy-all]");
    if (copy) copy.hidden = !isChatGptConversationPage();
    this.sync?.setActiveConversation(getConversationIdFromUrl());
  }

  private maintenanceBlocked(): boolean {
    if (Date.now() - this.lastUserInput < USER_IDLE_MS) return true;
    if (document.querySelector('[data-is-streaming="true"], [data-message-author-role="assistant"].result-streaming')) return true;
    if (this.boot?.isPending() || this.boot?.isActive()) return true;
    if (this.sync?.isReading()) return true;
    return this.hydrator?.isMaintenanceBlocked() === true;
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
    if (event.persisted) app.recover();
  };
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
  state[key] = () => {
    app.dispose();
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
  };
}
