"use strict";
(() => {
  // src/quota/iconRenderer.ts
  var COLORS = {
    outer: "#ff375f",
    middle: "#9cd326",
    inner: "#1ad6d0",
    track: "rgba(255,255,255,0.18)"
  };
  var DARK_ICON_PALETTE = {
    track: COLORS.track,
    center: "#f5f5f7"
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
  function renderQuotaIcon(size, rings, palette = DARK_ICON_PALETTE) {
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
      drawTrack(ctx, cx, cy, ring.radius, ring.width, palette.track);
      drawArc(ctx, cx, cy, ring.radius, ring.width, colors[index], values[index]);
    });
    if (size >= 32 && rings.center) {
      ctx.fillStyle = palette.center;
      const symbolic = rings.center === "…" || rings.center === "—" || rings.center === "!";
      ctx.font = `600 ${Math.round(size * (symbolic ? 0.42 : 0.34))}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(rings.center, cx, cy + size * 0.02);
    }
    return ctx.getImageData(0, 0, size, size);
  }
  function drawTrack(ctx, cx, cy, radius, width, color) {
    ctx.beginPath();
    ctx.strokeStyle = color;
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

  // src/quota/presentation.ts
  function metricRemainingLabel(metric) {
    if (!metric) return "当前套餐无此桶";
    if (metric.estimatedRemaining == null) return `已记录 ${metric.used} / ${metric.limit}`;
    return `预计剩余 ${metric.estimatedRemaining} / ${metric.limit}`;
  }
  function metricPercentLabel(metric) {
    if (!metric || metric.remainingRatio == null) return "—";
    return `${Math.round(metric.remainingRatio * 100)}%`;
  }
  function historySyncLabel(snapshot) {
    if (snapshot.historyComplete) return "历史同步完整";
    switch (snapshot.syncStatus) {
      case "loading":
        return "正在读取额度";
      case "backfill":
        return `正在首次同步最近 7 天 ChatGPT 历史… · 已记录 ${snapshot.recordedCount} 个 Pro 使用轮次`;
      case "ready":
        return "历史同步完整";
      case "error":
        return `额度读取失败${snapshot.historyError ? ` · ${snapshot.historyError}` : ""}`;
      default:
        return `历史暂未补齐 · 已记录 ${snapshot.recordedCount} 个 Pro 使用轮次，暂不猜剩余次数`;
    }
  }
  function planStatusNote(snapshot) {
    if (!snapshot.plan) return "未确认 ChatGPT 套餐，不猜测额度桶。";
    return null;
  }
  function workspaceStatusNote(snapshot) {
    return snapshot.personalProEligible ? null : "当前工作区不计入个人 Pro Chat 额度";
  }

  // src/quota/iconState.ts
  function snapshotToRings(snapshot) {
    const center = snapshot.syncStatus === "loading" || snapshot.syncStatus === "backfill" ? "…" : snapshot.syncStatus === "error" ? "!" : snapshot.syncStatus === "partial" || snapshot.tightestRemainingPercent == null ? "—" : String(snapshot.tightestRemainingPercent);
    return {
      outer: remainingToRatio(snapshot.gpt6ProWeekly?.estimatedRemaining ?? 0, snapshot.gpt6ProWeekly?.limit ?? 1),
      middle: remainingToRatio(snapshot.solProDaily?.estimatedRemaining ?? 0, snapshot.solProDaily?.limit ?? 1),
      inner: remainingToRatio(snapshot.combinedDaily?.estimatedRemaining ?? 0, snapshot.combinedDaily?.limit ?? 1),
      center
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
    root.append(el(
      "p",
      snapshot.syncStatus === "error" ? "warn" : "note",
      historySyncLabel(snapshot)
    ));
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
    const planNote = planStatusNote(snapshot);
    if (planNote) {
      root.append(el("p", "warn", planNote));
    } else if (snapshot.plan === "prolite") {
      root.append(metricBlock("两个 Pro · 过去 7 天估算", snapshot.combinedDaily, snapshot));
    } else {
      root.append(metricBlock("GPT-6 Pro · 过去 7 天估算", snapshot.gpt6ProWeekly, snapshot));
      root.append(metricBlock("GPT-5.6 Sol Pro · 过去 24 小时估算", snapshot.solProDaily, snapshot));
      root.append(metricBlock("两个 Pro · 过去 24 小时合计估算", snapshot.combinedDaily, snapshot));
    }
    if (snapshot.syncStatus === "ready") root.append(el("p", "note", "预计剩余"));
    else root.append(el("p", "note", "历史补齐前不估算剩余"));
    root.append(el("p", "note", "根据保存的 Chat 历史和本地记录估算，特殊重试可能存在误差。"));
    root.append(el("p", "note", "只统计个人 Chat，不统计 Work 和 Codex"));
    root.append(el("p", "note", `已记录 ${snapshot.recordedCount}`));
    root.append(el("p", "note", `未分类轮次 ${snapshot.unclassifiedTurns}`));
    if (snapshot.fallbackModel) {
      root.append(el("p", "note", `当前 fallback 模型：${snapshot.fallbackModel}`));
    }
    const workspace = workspaceStatusNote(snapshot);
    if (workspace) root.append(el("p", "warn", workspace));
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
      wrap.append(el("p", "note", metricRemainingLabel(null)));
      return wrap;
    }
    const row = el("div", "metric-row");
    row.append(document.createTextNode(metricRemainingLabel(metric)));
    row.append(el("span", "", metricPercentLabel(metric)));
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
    wrap.append(el("p", "note", snapshot.syncStatus === "ready" ? "统计完整" : "暂不估算剩余"));
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
