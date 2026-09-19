import type { PromptLibrary } from "./types";
export const PROMPT_KEY = "chatgpt-yada:prompt-library:v1";

export function parseLibrary(value: unknown): PromptLibrary {
  if (value === undefined) return { version: 1, prompts: [] };
  if (!value || typeof value !== "object") throw new Error("提示词数据无效");
  const data = value as PromptLibrary;
  if (data.version !== 1 || !Array.isArray(data.prompts)) throw new Error("提示词版本不支持");
  const ids = new Set<string>();
  for (const p of data.prompts) {
    if (!p || typeof p.id !== "string" || !p.id || ids.has(p.id)
      || typeof p.title !== "string" || typeof p.content !== "string"
      || !Number.isFinite(p.createdAt) || !Number.isFinite(p.updatedAt)) throw new Error("提示词数据无效");
    ids.add(p.id);
  }
  return data;
}
export async function readLibrary(): Promise<PromptLibrary> {
  return parseLibrary((await chrome.storage.local.get(PROMPT_KEY))[PROMPT_KEY]);
}
export async function saveLibrary(library: PromptLibrary): Promise<void> {
  await chrome.storage.local.set({ [PROMPT_KEY]: parseLibrary(library) });
}
