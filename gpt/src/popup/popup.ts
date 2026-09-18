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
  header.append(el("h1", "", "Pro 模型额度"), el("time", "", snapshot.updatedLabel));
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

  if (!snapshot.plan) {
    root.append(el("p", "warn", "未确认 ChatGPT 套餐，不猜测额度桶。"));
  } else if (snapshot.plan === "prolite") {
    root.append(metricBlock("两个 Pro · 过去 7 天估算", snapshot.combinedDaily, snapshot));
  } else {
    root.append(metricBlock("GPT-6 Pro · 过去 7 天估算", snapshot.gpt6ProWeekly, snapshot));
    root.append(metricBlock("GPT-5.6 Sol Pro · 过去 24 小时估算", snapshot.solProDaily, snapshot));
    root.append(metricBlock("两个 Pro · 过去 24 小时合计估算", snapshot.combinedDaily, snapshot));
  }

  root.append(el("p", "note", "预计剩余"));
  root.append(el("p", "note", "根据保存的 Chat 历史和本地记录估算，特殊重试可能存在误差。"));
  root.append(el("p", "note", "只统计个人 Chat，不统计 Work 和 Codex"));
  root.append(el("p", "note", snapshot.historyComplete ? "历史同步完整" : "历史同步不完整"));
  root.append(el("p", "note", `已记录 ${snapshot.recordedCount}`));
  root.append(el("p", "note", `未分类轮次 ${snapshot.unclassifiedTurns}`));
  if (snapshot.fallbackModel) {
    root.append(el("p", "note", `当前 fallback 模型：${snapshot.fallbackModel}`));
  }
  if (!snapshot.personalProEligible) {
    root.append(el("p", "warn", "当前工作区不计入个人 Pro Chat 额度"));
  }

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "立即刷新";
  button.addEventListener("click", () => { void refresh(true); });
  root.append(button);
}

function metricBlock(title: string, metric: QuotaMetric | null, snapshot: QuotaSnapshot): HTMLElement {
  const wrap = el("section", "metric");
  wrap.append(el("div", "metric-title", title));
  if (!metric) {
    wrap.append(el("p", "note", "当前套餐无此桶"));
    return wrap;
  }
  const row = el("div", "metric-row");
  const remaining = metric.estimatedRemaining == null
    ? `已记录 ${metric.used} / ${metric.limit}`
    : `预计剩余 ${metric.estimatedRemaining} / ${metric.limit}`;
  row.append(document.createTextNode(remaining));
  const percent = metric.remainingRatio == null ? "?" : `${Math.round(metric.remainingRatio * 100)}%`;
  row.append(el("span", "", percent));
  wrap.append(row);
  const bar = el("div", "bar");
  const fill = document.createElement("span");
  fill.style.width = `${remainingToRatio(metric.estimatedRemaining ?? 0, metric.limit) * 100}%`;
  fill.style.background = metric.id.includes("gpt6") ? "#ff375f" : metric.id.includes("sol") ? "#9cd326" : "#1ad6d0";
  bar.append(fill);
  wrap.append(bar);
  if (metric.nextReleaseAt) wrap.append(el("p", "note", `下一次释放 ${formatTime(metric.nextReleaseAt)}`));
  if (metric.serverResetAt) wrap.append(el("p", "note", `服务端真实恢复时间 ${formatTime(metric.serverResetAt)}`));
  if (metric.exhausted) wrap.append(el("p", "warn", "该模型已耗尽"));
  wrap.append(el("p", "note", snapshot.coverageLabel === "完整" ? "统计完整" : snapshot.historyComplete ? "历史估算" : "历史同步不完整"));
  return wrap;
}

function formatTime(value: number): string {
  return new Date(value).toLocaleString();
}

function el(tag: string, className = "", text = ""): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
