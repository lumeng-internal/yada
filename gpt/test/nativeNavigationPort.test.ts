import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeNavigationPort } from "../src/navigation/nativeNavigationPort";
import { collectOfficialButtons } from "../src/navigation/nativeCapability";
import { normalizeConversation } from "../src/conversation/normalizeConversation";
import { linearConversation } from "./helpers";
import {
  installScrollTopCounter,
  mountMain,
  mountOfficialButtons,
  mountStableSlots,
  mountUserMessages,
  turns
} from "./navFixtures";

describe("NativeNavigationPort", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
    delete globalThis.__YADA_NAV_DIAGNOSTICS__;
    localStorage.removeItem("chatgpt-yada:nav-debug");
  });

  it("jumps directly when the target user message is already rendered", async () => {
    const scroller = mountMain();
    mountUserMessages(["u0", "a0", "u1", "a1"], scroller);
    const port = new NativeNavigationPort();
    const result = await port.navigateTo("u0", turns(2), "conversation-1");
    expect(result).toEqual({ ok: true, path: "direct" });
    port.dispose();
  });

  it("does not confirm a target by duplicate prompt text", async () => {
    const scroller = mountMain();
    mountUserMessages(["u0", "u2"], scroller);
    const port = new NativeNavigationPort();
    const items = turns(4);
    expect(items[0].userMarkdown).toBe(items[2].userMarkdown);
    const result = await port.navigateTo(items[2].userMessageId!, items, "conversation-1");
    expect(result).toEqual({ ok: true, path: "direct" });
    expect(document.querySelector('[data-message-id="u2"]')).toBeTruthy();
    port.dispose();
  });

  it("cancels the first jump when a second tick is clicked", async () => {
    const scroller = mountMain();
    mountUserMessages(["u0"], scroller);
    mountOfficialButtons(2);
    const port = new NativeNavigationPort();
    const items = turns(2);
    const first = port.navigateTo("u1", items, "conversation-1");
    const second = await port.navigateTo("u0", items, "conversation-1");
    const firstResult = await first;
    expect(firstResult).toEqual({ ok: false, status: "cancelled" });
    expect(second).toEqual({ ok: true, path: "direct" });
    port.dispose();
  });

  it("cancels on wheel and does not auto-restart", async () => {
    mountMain();
    mountOfficialButtons(8);
    const port = new NativeNavigationPort();
    const pending = port.navigateTo("u0", turns(8), "conversation-1");
    window.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    const result = await pending;
    expect(result).toEqual({ ok: false, status: "cancelled" });
    expect(port.lastDiagnostics?.result).toBe("cancelled");
    port.dispose();
  });

  it("reuses the same promise for the same target", async () => {
    mountMain();
    mountOfficialButtons(2);
    const port = new NativeNavigationPort();
    const items = turns(2);
    const first = port.navigateTo("u0", items, "conversation-1");
    const second = port.navigateTo("u0", items, "conversation-1");
    expect(second).toBe(first);
    window.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    await first;
    port.dispose();
  });

  it("uses official buttons for unmounted targets without writing scrollTop", async () => {
    const scroller = mountMain();
    const writes = installScrollTopCounter(scroller);
    const clicked: number[] = [];
    mountUserMessages(["u145", "u146", "u147", "u148", "u149"], scroller);
    mountOfficialButtons(150, (index) => {
      clicked.push(index);
      mountUserMessages([`u${index}`], scroller);
    });
    const port = new NativeNavigationPort();
    const items = turns(150);
    for (const index of [0, 74]) {
      clicked.length = 0;
      const result = await port.navigateTo(items[index]!.userMessageId!, items, "conversation-1");
      expect(result).toEqual({ ok: true, path: "official-button" });
      expect(clicked).toEqual([index]);
      expect(port.lastDiagnostics?.yadaScrollWrites).toBe(0);
      expect(port.lastDiagnostics?.targetMessageId).toBe(`u${index}`);
    }
    clicked.length = 0;
    const last = await port.navigateTo(items[149]!.userMessageId!, items, "conversation-1");
    expect(last).toEqual({ ok: true, path: "direct" });
    expect(clicked).toEqual([]);
    expect(writes.writes).toBe(0);
    port.dispose();
  });

  it("does not use the official path when buttons are incomplete", async () => {
    const scroller = mountMain();
    const clicked: number[] = [];
    mountUserMessages(["u145", "u146", "u147", "u148", "u149"], scroller);
    mountOfficialButtons(5, (index) => clicked.push(index));
    const port = new NativeNavigationPort();
    const result = await port.navigateTo("u0", turns(150), "conversation-1");
    expect(result).toEqual({ ok: false, status: "unsupported" });
    expect(clicked).toEqual([]);
    port.dispose();
  });

  it("uses a stable slot with one coarse locate and at most two alignments", async () => {
    const scroller = mountMain();
    mountUserMessages(["u145", "u146", "u147", "u148", "u149"], scroller);
    const slots = mountStableSlots(150, scroller);
    const userSlot = slots[0]!;
    let coarse = 0;
    let alignments = 0;
    userSlot.scrollIntoView = ((args?: ScrollIntoViewOptions) => {
      coarse += 1;
      mountUserMessages(["u0"], scroller);
      const mounted = document.querySelector<HTMLElement>('[data-message-id="u0"]');
      if (mounted) {
        mounted.scrollIntoView = () => {
          alignments += 1;
        };
        Object.defineProperty(mounted, "getBoundingClientRect", {
          configurable: true,
          value: () => (alignments >= 1
            ? { top: 0, bottom: 40, left: 0, right: 40, width: 40, height: 40, x: 0, y: 0, toJSON() { return {}; } }
            : { top: 40, bottom: 80, left: 0, right: 40, width: 40, height: 40, x: 0, y: 40, toJSON() { return {}; } })
        });
      }
    }) as typeof userSlot.scrollIntoView;

    const port = new NativeNavigationPort();
    const result = await port.navigateTo("u0", turns(150), "conversation-1");
    expect(result).toEqual({ ok: true, path: "stable-slot" });
    expect(coarse).toBe(1);
    expect(alignments).toBeLessThanOrEqual(2);
    expect(port.lastDiagnostics?.alignmentAttempts).toBeLessThanOrEqual(2);
    expect(port.lastDiagnostics?.targetMessageId).toBe("u0");
    port.dispose();
  });

  it("times out deterministically on official buttons that never mount", async () => {
    vi.useFakeTimers();
    mountMain();
    mountOfficialButtons(2);
    const port = new NativeNavigationPort();
    const pending = port.navigateTo("u0", turns(2), "conversation-1");
    await vi.advanceTimersByTimeAsync(16_000);
    await expect(pending).resolves.toEqual({ ok: false, status: "timeout" });
    port.dispose();
  });

  it("fails closed on identity conflict", async () => {
    mountMain();
    const items = normalizeConversation(linearConversation(2));
    items[1] = { ...items[1]!, userMessageId: items[0]!.userMessageId, id: items[0]!.userMessageId! };
    const port = new NativeNavigationPort();
    const result = await port.navigateTo(items[0]!.userMessageId!, items, "conversation-1");
    expect(result).toEqual({ ok: false, status: "identity-conflict" });
    port.dispose();
  });

  it("does not treat ordinary buttons as official navigation", () => {
    mountMain();
    const send = document.createElement("button");
    send.setAttribute("aria-label", "Send prompt");
    document.querySelector("main")!.append(send);
    expect(collectOfficialButtons()).toEqual([]);
  });

  it("publishes diagnostics only when debug is enabled", async () => {
    const scroller = mountMain();
    mountUserMessages(["u0"], scroller);
    const port = new NativeNavigationPort();
    await port.navigateTo("u0", turns(1), "conversation-1");
    expect(globalThis.__YADA_NAV_DIAGNOSTICS__).toBeUndefined();
    localStorage.setItem("chatgpt-yada:nav-debug", "1");
    await port.navigateTo("u0", turns(1), "conversation-1");
    expect(globalThis.__YADA_NAV_DIAGNOSTICS__).toMatchObject({
      conversationId: "conversation-1",
      targetMessageId: "u0",
      path: "direct",
      result: "direct"
    });
    expect(JSON.stringify(globalThis.__YADA_NAV_DIAGNOSTICS__)).not.toMatch(/identical user question|Assistant /);
    port.dispose();
  });
});
