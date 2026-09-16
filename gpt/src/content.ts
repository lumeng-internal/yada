import { isChatGptConversationPage, isChatGptPage } from "./platform/chatgptAdapter";
import { YadaToolbar } from "./ui/toolbar";
import { observeRouteChange } from "./utils/route";

console.info("ChatGPT Yada Copy loaded");

class ChatGptYadaCopyApp {
  private readonly toolbar = new YadaToolbar();
  private routeDispose: (() => void) | null = null;
  private mounted = false;

  mount(): void {
    if (this.mounted) return;
    this.mounted = true;
    this.toolbar.mount();
    this.syncPageState();
    this.routeDispose = observeRouteChange(() => this.syncPageState());
  }

  dispose(): void {
    this.routeDispose?.();
    this.routeDispose = null;
    this.toolbar.dispose();
    this.mounted = false;
  }

  private syncPageState(): void {
    this.toolbar.ensurePlacement();
    this.toolbar.setVisible(isChatGptConversationPage());
  }
}

if (isChatGptPage()) {
  const app = new ChatGptYadaCopyApp();
  app.mount();
}
