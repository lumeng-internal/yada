import type { YadaTurn } from "../conversation/types";

export function formatTurnsAsMarkdown(turns: readonly YadaTurn[]): string {
  const markdown = turns
    .map(formatTurn)
    .filter(Boolean)
    .join("\n\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

  return markdown ? `${markdown}\n` : "";
}

function formatTurn(turn: YadaTurn): string {
  const sections = [
    formatSection("User", turn.userMarkdown, turn.userCreatedAt),
    formatSection("ChatGPT", turn.assistantMarkdown, turn.assistantCreatedAt)
  ].filter(Boolean);
  return sections.join("\n\n");
}

function formatSection(role: "User" | "ChatGPT", markdown: string, createdAt?: number): string {
  const content = markdown.trim();
  if (!content) return "";
  const timestamp = formatTimestamp(createdAt);
  return `# ${role}\n\n${timestamp ? `${timestamp}\n\n` : ""}${content}`;
}

export function formatTimestamp(seconds?: number): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "";
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
