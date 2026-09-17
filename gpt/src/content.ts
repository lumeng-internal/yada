import { isChatGptConversationPage, isChatGptPage } from "./platform/chatgptAdapter";
import { NativePreviewController } from "./nativePreview/controller";
import { YadaToolbar } from "./ui/toolbar";
import { observeRouteChange } from "./utils/route";

class ChatGptYadaApp {
  private nativePreview: NativePreviewController | null = null;
  private toolbar: YadaToolbar | null = null;
  private routeDispose: (() => void) | null = null;

  mount(): void {
    this.nativePreview = new NativePreviewController();
    this.toolbar = new YadaToolbar(assistant => this.nativePreview?.setPreviewMode(assistant));
    this.toolbar.mount();
    this.syncPageState();
    this.routeDispose = observeRouteChange(() => {
      this.toolbar?.closePanels();
      this.syncPageState();
    });
  }

  dispose = (): void => {
    this.routeDispose?.();
    this.routeDispose = null;
    this.nativePreview?.dispose();
    this.nativePreview = null;
    this.toolbar?.dispose();
    this.toolbar = null;
  };

  private syncPageState(): void {
    this.toolbar?.ensurePlacement();
    this.toolbar?.setVisible(isChatGptPage());
    const copy = document.getElementById("chatgpt-yada-toolbar-host")?.shadowRoot?.querySelector<HTMLButtonElement>("[data-copy-all]");
    if (copy) copy.hidden = !isChatGptConversationPage();
    this.nativePreview?.syncRoute();
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
