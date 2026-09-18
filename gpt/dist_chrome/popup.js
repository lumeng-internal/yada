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

  // src/quota/rules.ts
  var WEEK_MS = 7 * 24 * 60 * 60 * 1e3;
  var DAY_MS = 24 * 60 * 60 * 1e3;

  // src/quota/iconState.ts
  function snapshotToRings(snapshot) {
    const incomplete = snapshot.gpt6ProWeekly.coverage !== "complete-local" || snapshot.solProDaily.coverage !== "complete-local" || snapshot.combinedDaily.coverage !== "complete-local";
    return {
      outer: remainingToRatio(snapshot.gpt6ProWeekly.estimatedRemaining, snapshot.gpt6ProWeekly.limit),
      middle: remainingToRatio(snapshot.solProDaily.estimatedRemaining, snapshot.solProDaily.limit),
      inner: remainingToRatio(snapshot.combinedDaily.estimatedRemaining, snapshot.combinedDaily.limit),
      center: incomplete ? "?" : String(snapshot.tightestRemainingPercent ?? 0)
    };
  }

  // src/popup/popup.ts
  var app = document.getElementById("app");
  if (!app) throw new Error("popup root missing");
  void refresh();
  async function refresh(manual = false) {
    renderLoading(app, manual);
    if (manual) {
      await chrome.runtime.sendMessage({ type: "quota/refresh-current", conversationId: "" });
    }
    const response = await chrome.runtime.sendMessage({ type: "quota/get-state" });
    if (!response?.snapshot) {
      app.textContent = "无法读取额度账本";
      return;
    }
    render(app, response.snapshot);
  }
  function renderLoading(root, manual) {
    if (!root.childElementCount) root.textContent = manual ? "刷新中…" : "读取中…";
  }
  function render(root, snapshot) {
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
    button.addEventListener("click", () => {
      void refresh(true);
    });
    root.append(button);
  }
  function metricBlock(title, metric, coverageLabel, recorded, color) {
    const wrap = el("section", "metric");
    wrap.append(el("div", "metric-title", title));
    const row = el("div", "metric-row");
    const remaining = metric.coverage === "complete-local" ? `预计剩余 ${metric.estimatedRemaining} / ${metric.limit}` : `预计剩余不超过 ${metric.estimatedRemaining} / ${metric.limit}`;
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
  function coverageText(label) {
    if (label === "完整") return "统计完整";
    if (label === "历史估算") return "历史估算";
    return "数据不完整";
  }
  function el(tag, className = "", text = "") {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }
})();
