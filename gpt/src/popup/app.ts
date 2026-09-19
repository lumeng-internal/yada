import { remainingToRatio, renderQuotaIcon } from "../quota/iconRenderer";
import { snapshotToRings } from "../quota/iconState";
import type { QuotaMetric, QuotaSnapshot } from "../quota/types";
import { MESSAGE_TIMEOUT_MS, REFRESH_TIMEOUT_MS, sendRuntimeMessage } from "../shared/messages";
import { withTimeout } from "../shared/timeout";

export type PopupState = "loading" | "ready" | "error";
export type PopupMessage = { snapshot?: QuotaSnapshot; error?: string };

export function setPopupState(root: HTMLElement, state: PopupState): void {
  root.dataset.state = state;
}

export function popupStateOf(root: HTMLElement): PopupState | "" {
  const state = root.dataset.state;
  return state === "loading" || state === "ready" || state === "error" ? state : "";
}

export function isPopupReady(root: HTMLElement): boolean {
  return popupStateOf(root) === "ready";
}

export function isPopupTerminal(root: HTMLElement): boolean {
  const state = popupStateOf(root);
  return state === "ready" || state === "error";
}

export function renderPopupLoading(root: HTMLElement, manual = false): void {
  setPopupState(root, "loading");
  if (!root.childElementCount) root.textContent = manual ? "刷新中…" : "读取中…";
}

export function renderPopupError(root: HTMLElement, message: string): void {
  root.replaceChildren();
  setPopupState(root, "error");
  const node = document.createElement("p");
  node.className = "error";
  node.textContent = message;
  root.append(node);
}

export async function loadQuotaPopup(
  root: HTMLElement,
  send: (message: unknown, timeoutMs: number) => Promise<PopupMessage> = sendRuntimeMessage,
  options: { manual?: boolean; timeoutMs?: number } = {}
): Promise<void> {
  const manual = options.manual === true;
  const timeoutMs = options.timeoutMs ?? (manual ? REFRESH_TIMEOUT_MS : MESSAGE_TIMEOUT_MS);
  renderPopupLoading(root, manual);
  try {
    const response = await withTimeout(
      Promise.resolve(send(messageFor(manual), timeoutMs)),
      timeoutMs,
      manual ? "刷新超时，后台未响应" : "读取超时，后台未响应"
    );
    if (response?.error) throw new Error(response.error);
    if (!response?.snapshot) throw new Error("无法读取额度账本");
    renderPopup(root, response.snapshot);
    setPopupState(root, "ready");
  } catch (error) {
    renderPopupError(root, popupErrorText(error, manual));
  }
}

export function popupErrorText(error: unknown, manual = false): string {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/超时|timeout/i.test(message)) return manual ? "刷新超时，后台未响应" : "读取超时，后台未响应";
  if (/无法读取额度账本/.test(message)) return message;
  if (/扩展消息/.test(message) || /Could not establish connection|Receiving end does not exist/i.test(message)) {
    return "无法连接扩展后台";
  }
  if (/没有可刷新/.test(message)) return message;
  return message && /[\u4e00-\u9fff]/.test(message) ? message : "无法读取额度账本";
}

function messageFor(manual: boolean): { type: string; conversationId?: string } {
  return manual ? { type: "quota/refresh-current", conversationId: "" } : { type: "quota/get-state" };
}

function renderPopup(root: HTMLElement, snapshot: QuotaSnapshot): void {
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
  button.addEventListener("click", () => { void loadQuotaPopup(root, sendRuntimeMessage, { manual: true }); });
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
