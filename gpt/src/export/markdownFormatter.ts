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
    formatSection("User", turn.userMarkdown),
    formatSection("ChatGPT", turn.assistantMarkdown)
  ].filter(Boolean);
  return sections.join("\n\n");
}

function formatSection(role: "User" | "ChatGPT", markdown: string): string {
  const content = markdown.trim();
  if (!content) return "";
  return `# ${role}\n\n${content}`;
}
