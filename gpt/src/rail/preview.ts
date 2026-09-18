import type { YadaTurn } from "../conversation/types";

export function formatPreviewTime(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return "";
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 ${["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()]} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function renderPreviewContent(
  preview: HTMLElement,
  turn: YadaTurn,
  assistant: boolean
): void {
  const title = document.createElement("strong");
  title.textContent = `第 ${turn.index + 1} 轮`;
  const heading = document.createElement("div");
  heading.className = "preview-header";
  heading.append(title);
  const timestamp = formatPreviewTime(turn.userCreatedAt);
  if (timestamp) {
    const time = document.createElement("time");
    time.textContent = timestamp;
    heading.append(time);
  }
  preview.replaceChildren(heading, block("Harson", turn.userPreview));
  if (assistant) preview.append(block("ChatGPT", turn.assistantPreview || "该轮暂无 ChatGPT 回复"));
}

function block(role: string, text: string): HTMLElement {
  const section = document.createElement("section");
  section.dataset.previewRole = role;
  const label = document.createElement("strong");
  label.textContent = role;
  const summary = document.createElement("p");
  summary.textContent = text;
  section.append(label, summary);
  return section;
}
