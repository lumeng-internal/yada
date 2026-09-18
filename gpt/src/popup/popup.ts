import { remainingToRatio, renderQuotaIcon } from "../quota/iconRenderer";
import { snapshotToRings } from "../quota/iconState";
import type { QuotaMetric, QuotaSnapshot } from "../quota/types";

const app = document.getElementById("app");
if (!app) throw new Error("popup root missing");

void refresh();

async function refresh(manual = false): Promise<void> {
  renderLoading(app!, manual);
  if (manual) {
    await chrome.runtime.sendMessage({ type: "quota/refresh-current", conversationId: "" });
  }
  const response = await chrome.runtime.sendMessage({ type: "quota/get-state" }) as { snapshot?: QuotaSnapshot };
  if (!response?.snapshot) {
    app!.textContent = "无法读取额度账本";
    return;
  }
  render(app!, response.snapshot);
}

function renderLoading(root: HTMLElement, manual: boolean): void {
  if (!root.childElementCount) root.textContent = manual ? "刷新中…" : "读取中…";
}

function render(root: HTMLElement, snapshot: QuotaSnapshot): void {
  root.replaceChildren();
  const header = el("div", "header");
  header.append(el("h1", "", "Pro 模型额度"), el("time", "", "刚刚更新"));
  root.append(header);

  const rings = el("div", "rings");
  const canvas = document.createElement("canvas");
  canvas.width = 148;
  canvas.height = 148;
  const image = renderQuotaIcon(128, snapshotToRings(snapshot));
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const offscreen = new OffscreenCanvas(128, 128);
    const offCtx = offscreen.getContext("2d");
    offCtx?.putImageData(image, 0, 0);
    ctx.drawImage(offscreen, 0, 0, 148, 148);
  }
  rings.append(canvas);
  root.append(rings);

  root.append(metricBlock("GPT-6 Pro · 本周", snapshot.gpt6ProWeekly, snapshot.coverageLabel, snapshot.recordedCount, "#ff375f"));
  root.append(metricBlock("GPT-5.6 Sol Pro · 今日", snapshot.solProDaily, snapshot.coverageLabel, null, "#9cd326"));
  root.append(metricBlock("两个 Pro · 今日合计", snapshot.combinedDaily, snapshot.coverageLabel, null, "#1ad6d0"));

  root.append(el("p", "rule", `规则日期：${snapshot.ruleDate}`));
  root.append(el("p", "note", "只统计个人 Chat，不统计 Work 和 Codex"));
  if (!snapshot.personalProEligible) {
    root.append(el("p", "warn", "当前工作区不计入个人 Pro Chat 额度"));
  }
  if (snapshot.unknownModelCount > 0) {
    root.append(el("p", "warn", `有 ${snapshot.unknownModelCount} 次模型未识别`));
  }

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "立即刷新";
  button.addEventListener("click", () => { void refresh(true); });
  root.append(button);
}

function metricBlock(title: string, metric: QuotaMetric, coverageLabel: string, recorded: number | null, color: string): HTMLElement {
  const wrap = el("section", "metric");
  wrap.append(el("div", "metric-title", title));
  const row = el("div", "metric-row");
  const remaining = metric.coverage === "complete-local"
    ? `预计剩余 ${metric.estimatedRemaining} / ${metric.limit}`
    : `预计剩余不超过 ${metric.estimatedRemaining} / ${metric.limit}`;
  row.append(document.createTextNode(remaining));
  const percent = metric.coverage === "complete-local" ? `${Math.round(metric.remainingRatio * 100)}%` : "?";
  row.append(el("span", "", percent));
  wrap.append(row);
  const bar = el("div", "bar");
  const fill = document.createElement("span");
  fill.style.width = `${remainingToRatio(metric.estimatedRemaining, metric.limit) * 100}%`;
  fill.style.background = color;
  bar.append(fill);
  wrap.append(bar);
  if (recorded != null) wrap.append(el("p", "note", `已记录 ${recorded}`));
  wrap.append(el("p", "note", coverageText(coverageLabel)));
  return wrap;
}

function coverageText(label: string): string {
  if (label === "完整") return "统计完整";
  if (label === "历史估算") return "历史估算";
  return "数据不完整";
}

function el(tag: string, className = "", text = ""): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
