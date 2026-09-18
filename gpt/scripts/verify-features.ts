import { normalizeConversation } from "../src/conversation/normalizeConversation";
import type { ApiConversation, ApiConversationMessage } from "../src/conversation/fetchConversation";
import { fetchCompleteConversation } from "../src/conversation/completeConversation";
import { ConversationSync } from "../src/core/conversationSync";
import { RailView } from "../src/rail/view";
import { formatPreviewTime } from "../src/rail/preview";
import { readLibrary, saveLibrary, PROMPT_KEY, PREVIEW_KEY } from "../src/prompts/storage";
import { YadaToolbar } from "../src/ui/toolbar";
import type { YadaTurn } from "../src/conversation/types";

const savedChecks = JSON.parse(sessionStorage.getItem("yada-reload-checks") || "[]") as string[];
const result = { done: false, checks: savedChecks, error: "" };
Object.assign(globalThis, { yadaVerification: result });
const assert = (value: unknown, message: string): void => { if (!value) throw new Error(message); };
const pass = (message: string): void => { result.checks.push(message); };
const wait = (ms = 80): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
async function until(fn: () => boolean, message: string, rounds = 90): Promise<void> {
  for (let i = 0; i < rounds; i++) { if (fn()) return; await wait(); }
  throw new Error(message);
}

function el(tag: string, text = ""): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

const css = el("style");
css.textContent = `body{margin:0;font:14px/1.4 system-ui}header{position:fixed;top:0;left:0;right:0;height:96px;z-index:20;background:white}#conversation-header-actions{float:right}#draft{position:fixed;bottom:10px}`;
document.head.append(css);
const header = el("header"); header.id = "page-header";
const actions = el("div"); actions.id = "conversation-header-actions"; header.append(actions);
const draft = el("textarea") as HTMLTextAreaElement; draft.id = "draft"; draft.value = "Existing unsent draft";
document.body.append(header, draft);

function makeApi(count: number, id = "fixture-1"): ApiConversation {
  const api: ApiConversation = { id, current_node: `a${count - 1}`, mapping: { root: { id: "root", parent: "", message: null } } };
  for (let i = 0; i < count; i++) {
    api.mapping![`u${i}`] = {
      id: `u${i}`,
      parent: i ? `a${i - 1}` : "root",
      message: { id: `u${i}`, author: { role: "user" }, content: { content_type: "text", parts: ["identical user question"] }, create_time: 1700000000 + i }
    };
    api.mapping![`a${i}`] = {
      id: `a${i}`,
      parent: `u${i}`,
      message: { id: `a${i}`, author: { role: "assistant" }, recipient: "all", channel: "final", status: "finished_successfully", content: { content_type: "text", parts: [`Assistant ${i} answer`] }, metadata: { model_slug: "gpt-6-pro" }, create_time: 1700000001 + i }
    };
  }
  return api;
}

const api = makeApi(18);
const turns = normalizeConversation(api);
const storage = {
  async get(key: string) { const value = localStorage.getItem(key); return { [key]: value === null ? undefined : JSON.parse(value) }; },
  async set(values: Record<string, unknown>) { for (const [key, value] of Object.entries(values)) localStorage.setItem(key, JSON.stringify(value)); }
};
Object.assign(globalThis, {
  chrome: {
    storage: { local: storage, onChanged: { addListener() {}, removeListener() {} } },
    runtime: { sendMessage: async () => ({}), onMessage: { addListener() {}, removeListener() {} } },
    action: { setIcon: async () => undefined, setTitle: async () => undefined },
    alarms: { create: async () => undefined, onAlarm: { addListener() {} } }
  }
});
const originalFetch = window.fetch;
const originalObserver = window.IntersectionObserver;
const normalFetch = async (): Promise<Response> => new Response(JSON.stringify(api));
Object.assign(globalThis, { fetch: normalFetch });

let toolbar: YadaToolbar | null = null;
let reloading = false;
const promptHost = (): HTMLElement => document.getElementById("chatgpt-yada-prompt-host")!;
const modal = (): ShadowRoot => promptHost().shadowRoot!;
const promptButton = (): HTMLButtonElement => document.getElementById("chatgpt-yada-toolbar-host")!.shadowRoot!.querySelector("[data-prompts]")!;
const clickAction = (action: string): void => {
  const button = modal().querySelector<HTMLButtonElement>(`[data-prompt-action="${action}"]`);
  assert(button, `missing ${action}`);
  button!.click();
};
async function openPanel(): Promise<void> {
  promptButton().click();
  await until(() => !promptHost().hidden && modal().activeElement?.getAttribute("data-prompt-action") === "add", "prompt panel did not load");
}

async function apiChecks(): Promise<void> {
  const calls: string[] = [];
  const message = (id: string, role: "user" | "assistant"): ApiConversationMessage => ({ id, author: { role }, content: { content_type: "text", parts: [id] }, create_time: 1700000000 });
  Object.assign(globalThis, { fetch: async (url: string) => {
    calls.push(url);
    if (url.includes("include_full_conversation")) return new Response(JSON.stringify({ current_node: "a2", mapping: { a2: { id: "a2", parent: "missing", message: message("a2", "assistant") } } }));
    if (url.includes("/messages?")) return new Response(JSON.stringify({ messages: [message("u1", "user"), message("a1", "assistant"), message("u2", "user")], page_info: { has_previous_page: false } }));
    return new Response(JSON.stringify({ current_node: "a2", messages: [message("u2", "user"), message("a2", "assistant")], page_info: { has_previous_page: true, start_cursor: "cursor a/1" } }));
  } });
  const full = await fetchCompleteConversation("pagination", {});
  const normalized = normalizeConversation(full);
  assert(normalized.length === 2 && normalized[0].userMessageId === "u1" && normalized[1].assistantMessageId === "a2", "partial response treated as complete");
  assert(Array.isArray(full.messages) && full.messages.some((item) => item.id === "u1"), "paginated messages view was dropped");
  Object.assign(globalThis, { fetch: normalFetch });
  pass("API full parameter, actual cursor pagination/overlap merge, and preserved messages view");
}

function railChecks(): void {
  history.replaceState({}, "", "/c/fixture-1");
  const view = new RailView(() => undefined);
  view.setTurns(turns);
  assert(view.host.id === "chatgpt-yada-rail-host", "rail host missing");
  assert(view.host.shadowRoot!.querySelectorAll("button.mark").length === 18, "18-turn rail missing ticks");
  view.setTurns(normalizeConversation(makeApi(50)));
  assert(view.host.shadowRoot!.querySelectorAll("button.mark").length === 50, "50-turn rail missing ticks");
  view.setTurns(normalizeConversation(makeApi(150)));
  assert(view.host.shadowRoot!.querySelectorAll("button.mark").length === 150, "150-turn rail missing ticks");
  const many = normalizeConversation(makeApi(300));
  view.setTurns(many);
  assert(view.host.shadowRoot!.querySelectorAll("button.mark").length === 300, "300-turn rail missing ticks");
  view.setActive(2);
  assert(view.host.shadowRoot!.querySelector('[data-active="true"]')?.getAttribute("aria-label") === "跳到第 3 轮", "active tick is not green/current");
  const button = view.host.shadowRoot!.querySelectorAll<HTMLButtonElement>("button.mark")[6];
  button.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientY: 0 }));
  view.previewIndex(6);
  const preview = view.host.shadowRoot!.querySelector<HTMLElement>(".preview")!;
  assert(preview.querySelector('[data-preview-role="Harson"]') && !preview.querySelector('[data-preview-role="ChatGPT"]'), "gray preview should only show Harson");
  view.setPreviewMode(true);
  assert(preview.querySelector('[data-preview-role="ChatGPT"]'), "green preview should show ChatGPT");
  const userTime = new Date(2026, 8, 17, 21, 32, 18).getTime() / 1000;
  const timed: YadaTurn = { ...many[72], userCreatedAt: userTime };
  view.setTurns([timed]);
  view.previewIndex(0);
  assert(view.host.shadowRoot!.querySelector("time")?.textContent === formatPreviewTime(userTime), "preview time incorrect");
  view.dispose();
  assert(!document.getElementById("chatgpt-yada-rail-host"), "rail leaked");
  pass("rail renders 18/50/150/300 ticks from API turns; gray/green preview; timestamps");
}

async function repositoryChecks(): Promise<void> {
  let reads = 0;
  Object.assign(globalThis, { fetch: async (url: string) => {
    if (String(url).includes("/api/auth/session")) return new Response("{}");
    reads += 1;
    await wait(30);
    return new Response(JSON.stringify(makeApi(6, "shared")));
  } });
  const sync = new ConversationSync();
  sync.setActiveConversation("shared");
  await Promise.all([sync.requestSync("a"), sync.requestSync("b")]);
  const snapshot = sync.getSnapshot();
  assert(reads === 1 && snapshot?.activeTurns.length === 6 && snapshot.quotaTurns.length >= 0, "consumers did not share one request");
  const branched = makeApi(1, "branch");
  branched.mapping!["old"] = { id: "old", parent: "u0", message: { id: "old", author: { role: "assistant" }, channel: "final", status: "finished_successfully", content: { content_type: "text", parts: ["old"] }, metadata: { model_slug: "gpt-6-pro" } } };
  Object.assign(globalThis, { fetch: async () => new Response(JSON.stringify(branched)) });
  sync.setActiveConversation("branch");
  await sync.requestSync("branch");
  const next = sync.getSnapshot();
  assert(next?.activeTurns[0].assistantMessageId !== "old", "active branch lost");
  sync.dispose();
  Object.assign(globalThis, { fetch: normalFetch });
  pass("conversation sync shares one request and keeps branch assistant events");
}

async function run(): Promise<void> {
  if (savedChecks.length) {
    toolbar = new YadaToolbar(); toolbar.mount(); toolbar.setVisible(true);
    await until(() => document.getElementById("chatgpt-yada-toolbar-host")!.shadowRoot!.querySelector("[data-preview-mode]")?.getAttribute("aria-pressed") === "true", "preview mode lost on reload");
    await openPanel();
    assert(modal().querySelector(".yada-prompt-item-title")?.textContent === "Reload retained", "prompt lost on reload");
    assert((await readLibrary()).prompts[0].id === "existing-210-id", "ID lost on reload");
    pass("real browser reload retains preview preference and existing v1 prompt IDs/content");
    sessionStorage.removeItem("yada-reload-checks"); return;
  }

  await apiChecks();
  await repositoryChecks();
  railChecks();

  toolbar = new YadaToolbar(); toolbar.mount(); toolbar.setVisible(true);
  const mode = document.getElementById("chatgpt-yada-toolbar-host")!.shadowRoot!.querySelector<HTMLButtonElement>("[data-preview-mode]")!;
  await wait(); mode.click(); await until(() => localStorage.getItem(PREVIEW_KEY) === "true", "preview preference not retained");
  const original = { id: "existing-210-id", title: "<img src=x onerror=alert(1)>", content: "  Full prompt\nwith whitespace\n" + "Body ".repeat(200), createdAt: 10, updatedAt: 20 };
  await saveLibrary({ version: 1, prompts: [original] }); await openPanel();
  const panel = modal().querySelector<HTMLElement>(".yada-prompt-panel")!, list = modal().querySelector<HTMLElement>(".yada-prompt-list")!;
  assert(promptHost().parentElement === document.body && !modal().querySelector('input[type="search"], .yada-prompt-footer'), "search/footer or wrong host");
  assert(modal().querySelector(".yada-prompt-header")!.querySelectorAll("button").length === 2, "header must only have add/close");
  assert(!modal().querySelector("img") && getComputedStyle(panel).minHeight === "0px" && panel.getBoundingClientRect().height < 320, "one-item panel not compact/safe");
  const card = modal().querySelector<HTMLElement>(".yada-prompt-item")!, icons = [...card.querySelectorAll<HTMLButtonElement>("button")];
  assert(icons.length === 3 && icons.every((b) => b.querySelector("svg") && !b.textContent!.trim() && b.title === b.getAttribute("aria-label")), "icons must be SVG-only and accessible");
  assert(icons.map((b) => b.title).join(",") === "复制提示词,编辑提示词,删除提示词", "wrong icon labels");
  let copied = "", copies = 0;
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { copied = text; copies++; } } });
  card.click(); assert(!copies && modal().querySelector<HTMLElement>("form")!.hidden && draft.value === "Existing unsent draft", "card has action");
  const copyIcon = icons[0], oldSvg = copyIcon.innerHTML; copyIcon.click(); await wait();
  assert(copied === original.content && !promptHost().hidden && copyIcon.innerHTML !== oldSvg && !copyIcon.textContent!.trim(), "copy is truncated/title included/closes/not check icon");
  await wait(1400); assert(copyIcon.innerHTML === oldSvg, "check icon did not restore");
  clickAction("edit"); modal().querySelector<HTMLInputElement>('[name="title"]')!.value = "Updated title";
  modal().querySelector<HTMLTextAreaElement>('[name="content"]')!.value = "Updated body"; modal().querySelector<HTMLButtonElement>('[type="submit"]')!.click();
  await until(() => modal().querySelector(".yada-prompt-item-title")?.textContent === "Updated title", "edit failed");
  clickAction("add"); modal().querySelector<HTMLInputElement>('[name="title"]')!.value = "Second"; modal().querySelector<HTMLTextAreaElement>('[name="content"]')!.value = "Second body"; modal().querySelector<HTMLButtonElement>('[type="submit"]')!.click();
  await until(() => modal().querySelectorAll(".yada-prompt-item").length === 2, "add failed");
  clickAction("delete"); await until(() => modal().querySelectorAll(".yada-prompt-item").length === 1, "delete failed");
  assert((await readLibrary()).prompts[0].id === original.id, "delete affected another prompt");
  clickAction("close");
  await saveLibrary({ version: 1, prompts: Array.from({ length: 40 }, (_, i) => ({ id: `many-${i}`, title: `Prompt ${i}`, content: "Long preview ".repeat(60), createdAt: i, updatedAt: i })) }); await openPanel();
  assert(list.scrollHeight > list.clientHeight && getComputedStyle(list).overflowY === "auto", "only list should scroll within max-height");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); assert(promptHost().hidden, "escape close failed");
  pass("prompt add/edit/delete/copy SVG still work");
  await saveLibrary({ version: 1, prompts: [{ ...original, title: "Reload retained" }] });
  assert(localStorage.getItem(PROMPT_KEY), "v1 key lost"); toolbar.dispose(); toolbar = null;
  assert(window.fetch === originalFetch || window.fetch === normalFetch, "production path wrapped window.fetch");
  assert(window.IntersectionObserver === originalObserver, "production path wrapped IntersectionObserver");
  sessionStorage.setItem("yada-reload-checks", JSON.stringify(result.checks)); reloading = true; location.reload();
}

void run().catch((error) => { result.error = error.stack ?? String(error); }).finally(() => {
  if (!reloading) { toolbar?.dispose(); result.done = true; }
});
