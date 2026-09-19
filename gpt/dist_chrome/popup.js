"use strict";
(() => {
  // src/quota/iconRenderer.ts
  var COLORS = {
    outer: "#ff375f",
    middle: "#9cd326",
    inner: "#1ad6d0",
    track: "rgba(255,255,255,0.18)"
  };
  function remainingToRatio(remaining, limit) {
    if (limit <= 0) return 0;
    return Math.max(0, Math.min(1, remaining / limit));
  }
  function ringGeometry(size) {
    const padding = Math.max(1, size * 0.045);
    const outerWidth = Math.max(1.5, size * 0.11);
    const gap = Math.max(0.75, size * 0.045);
    const cx = size / 2;
    const outerRadius = cx - padding - outerWidth / 2;
    const middleWidth = outerWidth * 0.92;
    const innerWidth = outerWidth * 0.84;
    const middleRadius = outerRadius - outerWidth / 2 - gap - middleWidth / 2;
    const innerRadius = middleRadius - middleWidth / 2 - gap - innerWidth / 2;
    return [
      { radius: outerRadius, width: outerWidth },
      { radius: middleRadius, width: middleWidth },
      { radius: innerRadius, width: innerWidth }
    ];
  }
  function renderQuotaIcon(size, rings) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("OffscreenCanvas is unavailable");
    ctx.clearRect(0, 0, size, size);
    const cx = size / 2;
    const cy = size / 2;
    const geometry = ringGeometry(size);
    const values = [rings.outer, rings.middle, rings.inner];
    const colors = [COLORS.outer, COLORS.middle, COLORS.inner];
    geometry.forEach((ring, index) => {
      drawTrack(ctx, cx, cy, ring.radius, ring.width);
      drawArc(ctx, cx, cy, ring.radius, ring.width, colors[index], values[index]);
    });
    if (size >= 32 && rings.center) {
      ctx.fillStyle = "#f5f5f7";
      ctx.font = `600 ${Math.round(size * (rings.center === "?" ? 0.42 : 0.34))}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(rings.center, cx, cy + size * 0.02);
    }
    return ctx.getImageData(0, 0, size, size);
  }
  function drawTrack(ctx, cx, cy, radius, width) {
    ctx.beginPath();
    ctx.strokeStyle = COLORS.track;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  function drawArc(ctx, cx, cy, radius, width, color, ratio) {
    const filled = Math.max(0, Math.min(0.999, ratio));
    if (filled <= 0) return;
    const start = -Math.PI / 2;
    const end = start + filled * Math.PI * 2;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.arc(cx, cy, radius, start, end);
    ctx.stroke();
  }

  // src/quota/iconState.ts
  function snapshotToRings(snapshot) {
    const incomplete = snapshot.coverageLabel !== "完整" || snapshot.tightestRemainingPercent == null;
    return {
      outer: remainingToRatio(snapshot.gpt6ProWeekly?.estimatedRemaining ?? 0, snapshot.gpt6ProWeekly?.limit ?? 1),
      middle: remainingToRatio(snapshot.solProDaily?.estimatedRemaining ?? 0, snapshot.solProDaily?.limit ?? 1),
      inner: remainingToRatio(snapshot.combinedDaily?.estimatedRemaining ?? 0, snapshot.combinedDaily?.limit ?? 1),
      center: incomplete ? "?" : String(snapshot.tightestRemainingPercent ?? 0)
    };
  }

  // src/shared/timeout.ts
  function withTimeout(promise, timeoutMs, message = "timeout") {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return Promise.reject(new Error(message));
    }
    let timer;
    return new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      Promise.resolve(promise).then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  // src/shared/messages.ts
  var MESSAGE_TIMEOUT_MS = 15e3;
  var REFRESH_TIMEOUT_MS = 45e3;
  function sendRuntimeMessage(message, timeoutMs = MESSAGE_TIMEOUT_MS) {
    return withTimeout(Promise.resolve(chrome.runtime.sendMessage(message)), timeoutMs, "扩展消息超时");
  }

  // src/popup/app.ts
  function setPopupState(root, state) {
    root.dataset.state = state;
  }
  function renderPopupLoading(root, manual = false) {
    setPopupState(root, "loading");
    if (!root.childElementCount) root.textContent = manual ? "刷新中…" : "读取中…";
  }
  function renderPopupError(root, message) {
    root.replaceChildren();
    setPopupState(root, "error");
    const node = document.createElement("p");
    node.className = "error";
    node.textContent = message;
    root.append(node);
  }
  async function loadQuotaPopup(root, send = sendRuntimeMessage, options = {}) {
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
  function popupErrorText(error, manual = false) {
    const message = error instanceof Error ? error.message : String(error || "");
    if (/超时|timeout/i.test(message)) return manual ? "刷新超时，后台未响应" : "读取超时，后台未响应";
    if (/无法读取额度账本/.test(message)) return message;
    if (/扩展消息/.test(message) || /Could not establish connection|Receiving end does not exist/i.test(message)) {
      return "无法连接扩展后台";
    }
    if (/没有可刷新/.test(message)) return message;
    return message && /[\u4e00-\u9fff]/.test(message) ? message : "无法读取额度账本";
  }
  function messageFor(manual) {
    return manual ? { type: "quota/refresh-current", conversationId: "" } : { type: "quota/get-state" };
  }
  function renderPopup(root, snapshot) {
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
    button.addEventListener("click", () => {
      void loadQuotaPopup(root, sendRuntimeMessage, { manual: true });
    });
    root.append(button);
  }
  function metricBlock(title, metric, snapshot) {
    const wrap = el("section", "metric");
    wrap.append(el("div", "metric-title", title));
    if (!metric) {
      wrap.append(el("p", "note", "当前套餐无此桶"));
      return wrap;
    }
    const row = el("div", "metric-row");
    const remaining = metric.estimatedRemaining == null ? `已记录 ${metric.used} / ${metric.limit}` : `预计剩余 ${metric.estimatedRemaining} / ${metric.limit}`;
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
  function formatTime(value) {
    return new Date(value).toLocaleString();
  }
  function el(tag, className = "", text = "") {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  // src/popup/popup.ts
  var app = document.getElementById("app");
  if (!app) throw new Error("popup root missing");
  void loadQuotaPopup(app);
})();
