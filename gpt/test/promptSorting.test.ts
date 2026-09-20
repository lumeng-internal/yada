import { afterEach, describe, expect, it, vi } from "vitest";
import Sortable from "sortablejs";
import { PromptPanel } from "../src/prompts/panel";
import { parseLibrary, PROMPT_KEY, readLibrary, saveLibrary } from "../src/prompts/storage";
import type { Prompt } from "../src/prompts/types";

const prompt = (id: string, updatedAt: number): Prompt => ({ id, title: id, content: `body ${id}`, createdAt: 1, updatedAt });
const initial = [prompt("a", 10), prompt("b", 30), prompt("c", 20)];
let panel: PromptPanel | undefined;
afterEach(() => { panel?.dispose(); panel = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); });

async function open() {
  const button = document.createElement("button"); document.body.append(button);
  panel = new PromptPanel(button); button.click();
  await vi.waitFor(() => expect(panel!.host.shadowRoot!.querySelectorAll("article")).toHaveLength(3));
  const root = panel.host.shadowRoot!;
  const list = root.querySelector<HTMLElement>(".yada-prompt-list")!;
  return { root, list, button };
}
const ids = (list: HTMLElement) => [...list.querySelectorAll<HTMLElement>("article")].map(item => item.dataset.promptId);
const storedIds = async () => (await readLibrary()).prompts.map(item => item.id);
function drag(list: HTMLElement) {
  const sortable = Sortable.get(list)!;
  list.prepend(list.lastElementChild!);
  // Exercise the real Sortable instance's onEnd adapter; jsdom does not emulate physical dragging.
  sortable.option("onEnd")!.call(sortable, {} as Sortable.SortableEvent);
}

describe("canonical prompt order", () => {
  it("migrates v1 once using the previous updatedAt order and persists v2", async () => {
    await chrome.storage.local.set({ [PROMPT_KEY]: { version: 1, prompts: initial } });
    expect(await storedIds()).toEqual(["b", "c", "a"]);
    expect((await chrome.storage.local.get(PROMPT_KEY))[PROMPT_KEY].version).toBe(2);
    expect(await storedIds()).toEqual(["b", "c", "a"]);
    expect(parseLibrary({ version: 2, prompts: initial }).prompts.map(p => p.id)).toEqual(["a", "b", "c"]);
  });

  it("saves real Sortable DOM order, survives reopen/recreation, and destroys each instance", async () => {
    await saveLibrary({ version: 2, prompts: initial });
    const { list, button } = await open();
    const instance = Sortable.get(list)!;
    expect(instance.option("handle")).toBe(".yada-prompt-grip");
    expect(instance.option("scroll")).toBe(list);
    const destroy = vi.spyOn(instance, "destroy");
    drag(list);
    await vi.waitFor(async () => expect(await storedIds()).toEqual(["c", "a", "b"]));
    expect(ids(list)).toEqual(["c", "a", "b"]);
    expect(destroy).toHaveBeenCalledOnce();
    panel!.close(); expect(Sortable.get(list)).toBeNull();
    button.click(); await vi.waitFor(() => expect(Sortable.get(list)).toBeTruthy());
    expect(ids(list)).toEqual(["c", "a", "b"]);
    panel!.dispose(); expect(Sortable.get(list)).toBeNull();
    const reopened = await open();
    expect(ids(reopened.list)).toEqual(["c", "a", "b"]);
  });

  it("restores the pre-drag order when storage fails", async () => {
    await saveLibrary({ version: 2, prompts: initial });
    const { root, list } = await open();
    vi.spyOn(chrome.storage.local, "set").mockRejectedValueOnce(new Error("disk"));
    drag(list);
    await vi.waitFor(() => expect(root.querySelector('[role="alert"]')!.textContent).toBe("排序保存失败，请重试"));
    expect(ids(list)).toEqual(["a", "b", "c"]);
    expect(await storedIds()).toEqual(["a", "b", "c"]);
  });

  it("edits in place, inserts at the top, and deletes without disturbing other cards", async () => {
    await saveLibrary({ version: 2, prompts: initial });
    const { root, list } = await open();
    root.querySelector<HTMLButtonElement>('[data-prompt-action="edit"][data-prompt-id="b"]')!.click();
    expect(Sortable.get(list)).toBeNull();
    root.querySelector<HTMLInputElement>('[name="title"]')!.value = "edited";
    root.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(async () => expect((await readLibrary()).prompts[1].title).toBe("edited"));
    expect(await storedIds()).toEqual(["a", "b", "c"]);
    root.querySelector<HTMLButtonElement>('[data-prompt-action="add"]')!.click();
    root.querySelector<HTMLInputElement>('[name="title"]')!.value = "new";
    root.querySelector<HTMLTextAreaElement>('[name="content"]')!.value = "new body";
    root.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(list.children).toHaveLength(4));
    const newest = (await readLibrary()).prompts[0];
    expect(newest.title).toBe("new");
    expect(await storedIds()).toEqual([newest.id, "a", "b", "c"]);
    root.querySelector<HTMLButtonElement>('[data-prompt-action="delete"][data-prompt-id="a"]')!.click();
    await vi.waitFor(async () => expect(await storedIds()).toEqual([newest.id, "b", "c"]));
  });
});
