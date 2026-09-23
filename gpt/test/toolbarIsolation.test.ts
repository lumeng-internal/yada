import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatGptYadaApp } from "../src/content";
import { YadaToolbar } from "../src/ui/toolbar";
import { paintQuotaCanvas, renderQuotaIcon } from "../src/quota/iconRenderer";

describe("toolbar isolation", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    history.replaceState({}, "", "/");
  });

  it("keeps copy and prompts when the quota indicator constructor fails", () => {
    const toolbar = new YadaToolbar();
    vi.spyOn(toolbar, "attachQuotaIndicator").mockImplementation(() => { throw new Error("quota down"); });
    toolbar.mount();
    const root = document.getElementById("chatgpt-yada-toolbar-host")!.shadowRoot!;
    expect(root.querySelector("[data-copy-all]")).toBeTruthy();
    expect(root.querySelector("[data-prompts]")).toBeTruthy();
    expect(root.querySelector("[data-quota]")?.getAttribute("aria-label")).toContain("异常");
    toolbar.dispose();
  });

  it("paints page rings on an HTML canvas without constructing OffscreenCanvas", () => {
    const Original = globalThis.OffscreenCanvas;
    let constructed = 0;
    globalThis.OffscreenCanvas = class extends Original {
      constructor(width: number, height: number) {
        constructed += 1;
        super(width, height);
      }
    };
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    paintQuotaCanvas(canvas, { outer: 0.5, middle: 0.25, inner: 0.1, center: "86" });
    expect(constructed).toBe(0);
    renderQuotaIcon(16, { outer: 1, middle: 1, inner: 1, center: null });
    expect(constructed).toBeGreaterThan(0);
    globalThis.OffscreenCanvas = Original;
  });

  it("mounts the toolbar shell before navigator or quota", () => {
    const order: string[] = [];
    const app = new ChatGptYadaApp();
    const toolbar = app as unknown as { ensureToolbar(): void; ensureNavigator(): void; ensureQuota(): void };
    const originalToolbar = toolbar.ensureToolbar.bind(app);
    const originalNavigator = toolbar.ensureNavigator.bind(app);
    const originalQuota = toolbar.ensureQuota.bind(app);
    toolbar.ensureToolbar = () => { order.push("toolbar"); originalToolbar(); };
    toolbar.ensureNavigator = () => { order.push("navigator"); originalNavigator(); };
    toolbar.ensureQuota = () => { order.push("quota"); originalQuota(); };
    app.mount(true);
    expect(order.indexOf("toolbar")).toBeLessThan(order.indexOf("navigator"));
    expect(order.indexOf("toolbar")).toBeLessThan(order.indexOf("quota"));
    expect(document.getElementById("chatgpt-yada-toolbar-host")).toBeTruthy();
    app.dispose();
  });
});
