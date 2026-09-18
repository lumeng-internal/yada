"use strict";
(() => {
  // src/quota/rules.ts
  var QUOTA_RULES = {
    id: "openai-pro-200-chat-2026-09-18",
    effectiveFrom: "2026-09-18",
    sourceUrl: "https://help.openai.com/en/articles/20001354-gpt-56-in-chatgpt",
    gpt6ProWeekly: 200,
    solProDaily: 170,
    combinedDaily: 200
  };
  var WEEK_MS = 7 * 24 * 60 * 60 * 1e3;
  var DAY_MS = 24 * 60 * 60 * 1e3;

  // src/quota/calculator.ts
  function calculateQuotaSnapshot(input) {
    const now = input.now ?? Date.now();
    const personal = input.events.filter(
      (event) => event.accountKey === input.accountKey && event.workspaceKind === "personal"
    );
    const unknownModelCount = personal.filter((event) => event.model === "unknown").length;
    const gpt6 = personal.filter((event) => event.model === "gpt-6-pro");
    const sol = personal.filter((event) => event.model === "gpt-5.6-sol-pro");
    const usedObservedTime = personal.some((event) => event.timeSource === "observed");
    const degraded = Boolean(input.writeError) || unknownModelCount > 0 || usedObservedTime || input.backfillStatus === "error" || input.workspaceKind === "unknown";
    const gpt6ProWeekly = metric(QUOTA_RULES.gpt6ProWeekly, gpt6, now, WEEK_MS, coverageFor(input, now, WEEK_MS, degraded));
    const solProDaily = metric(QUOTA_RULES.solProDaily, sol, now, DAY_MS, coverageFor(input, now, DAY_MS, degraded));
    const combinedEvents = personal.filter((event) => event.model === "gpt-6-pro" || event.model === "gpt-5.6-sol-pro");
    const combinedDaily = metric(QUOTA_RULES.combinedDaily, combinedEvents, now, DAY_MS, coverageFor(input, now, DAY_MS, degraded));
    const coverages = [gpt6ProWeekly.coverage, solProDaily.coverage, combinedDaily.coverage];
    const coverageLabel = coverages.includes("degraded") || coverages.includes("partial") ? coverages.includes("degraded") ? "数据不完整" : "历史估算" : "完整";
    const ratios = [gpt6ProWeekly, solProDaily, combinedDaily].filter((item) => item.coverage === "complete-local").map((item) => item.remainingRatio);
    const tightestRemainingPercent = ratios.length ? Math.round(Math.min(...ratios) * 100) : null;
    return {
      accountKey: input.accountKey,
      workspaceKind: input.workspaceKind,
      updatedAt: now,
      gpt6ProWeekly,
      solProDaily,
      combinedDaily,
      unknownModelCount,
      recordedCount: personal.length,
      ruleId: QUOTA_RULES.id,
      ruleDate: QUOTA_RULES.effectiveFrom,
      backfillStatus: input.backfillStatus,
      coverageLabel,
      tightestRemainingPercent,
      personalProEligible: input.workspaceKind === "personal"
    };
  }
  function coverageFor(input, now, windowMs, degraded) {
    if (degraded) return "degraded";
    if (!input.liveStartedAt || now - input.liveStartedAt < windowMs) return "partial";
    if (input.backfillStatus === "running" || input.backfillStatus === "paused") return "partial";
    if (input.lastLiveAt && now - input.lastLiveAt > windowMs) return "partial";
    return "complete-local";
  }
  function metric(limit, events, now, windowMs, coverage) {
    const inWindow = events.filter((event) => event.occurredAt > now - windowMs).sort((a, b) => a.occurredAt - b.occurredAt);
    const used = inWindow.length;
    const estimatedRemaining = Math.max(0, limit - used);
    const oldest = inWindow[0];
    return {
      limit,
      used,
      estimatedRemaining,
      remainingRatio: limit <= 0 ? 0 : estimatedRemaining / limit,
      nextReleaseAt: oldest ? oldest.occurredAt + windowMs : null,
      coverage
    };
  }

  // src/quota/types.ts
  var LEDGER_KEY = "chatgpt-yada:quota-ledger:v1";
  var STATE_KEY = "chatgpt-yada:quota-state:v1";
  var BACKFILL_KEY = "chatgpt-yada:quota-backfill:v1";
  var MAX_EVENTS = 5e3;
  var EVENT_TTL_MS = 14 * 24 * 60 * 60 * 1e3;

  // src/quota/ledger.ts
  var memoryFallback = /* @__PURE__ */ new Map();
  function createChromeQuotaStorage() {
    return {
      async get(keys) {
        if (typeof chrome === "undefined" || !chrome.storage?.local) {
          return Object.fromEntries(keys.map((key) => [key, memoryFallback.get(key)]));
        }
        return chrome.storage.local.get(keys);
      },
      async set(values) {
        if (typeof chrome === "undefined" || !chrome.storage?.local) {
          for (const [key, value] of Object.entries(values)) memoryFallback.set(key, value);
          return;
        }
        await chrome.storage.local.set(values);
      }
    };
  }
  var QuotaLedger = class {
    constructor(storage = createChromeQuotaStorage()) {
      this.storage = storage;
    }
    queue = Promise.resolve();
    ingest(events, now = Date.now()) {
      return this.serialize(async () => {
        const { ledger: ledger2, state } = await this.read();
        const byId = new Map(ledger2.events.map((event) => [`${event.accountKey}:${event.id}`, event]));
        for (const event of events) {
          const key = `${event.accountKey}:${event.id}`;
          if (!byId.has(key)) byId.set(key, event);
        }
        ledger2.events = prune([...byId.values()], now);
        const accountKey = events[0]?.accountKey;
        if (accountKey) {
          state.liveStartedAt[accountKey] ??= now;
          state.lastLiveAt[accountKey] = now;
        }
        const snapshot = accountKey ? calculateQuotaSnapshot({
          accountKey,
          workspaceKind: events[0]?.workspaceKind ?? "unknown",
          events: ledger2.events,
          now,
          liveStartedAt: state.liveStartedAt[accountKey],
          lastLiveAt: state.lastLiveAt[accountKey],
          writeError: state.writeError,
          backfillStatus: "idle"
        }) : null;
        if (snapshot) state.lastSnapshot = snapshot;
        await this.write(ledger2, state);
        return snapshot;
      });
    }
    async getSnapshot(accountKey, workspaceKind, backfillStatus = "idle", now = Date.now()) {
      const { ledger: ledger2, state } = await this.read();
      return calculateQuotaSnapshot({
        accountKey,
        workspaceKind,
        events: ledger2.events,
        now,
        liveStartedAt: state.liveStartedAt[accountKey],
        lastLiveAt: state.lastLiveAt[accountKey],
        writeError: state.writeError,
        backfillStatus
      });
    }
    async restore() {
      return this.read();
    }
    serialize(work) {
      const run = this.queue.then(work, work);
      this.queue = run.then(() => void 0, () => void 0);
      return run;
    }
    async read() {
      const data = await this.storage.get([LEDGER_KEY, STATE_KEY]);
      return {
        ledger: parseLedger(data[LEDGER_KEY]),
        state: parseState(data[STATE_KEY])
      };
    }
    async write(ledger2, state) {
      try {
        await this.storage.set({ [LEDGER_KEY]: ledger2, [STATE_KEY]: state });
        state.writeError = void 0;
      } catch (error) {
        state.writeError = error instanceof Error ? error.message : "storage-write-failed";
        throw error;
      }
    }
  };
  function prune(events, now) {
    const kept = events.filter((event) => now - event.occurredAt <= EVENT_TTL_MS).sort((a, b) => a.occurredAt - b.occurredAt);
    return kept.length > MAX_EVENTS ? kept.slice(kept.length - MAX_EVENTS) : kept;
  }
  function parseLedger(value) {
    if (!value || typeof value !== "object") return { version: 1, events: [] };
    const record = value;
    if (record.version !== 1 || !Array.isArray(record.events)) return { version: 1, events: [] };
    return {
      version: 1,
      events: record.events.filter((event) => event && typeof event.id === "string" && typeof event.accountKey === "string")
    };
  }
  function parseState(value) {
    if (!value || typeof value !== "object") return { version: 1, liveStartedAt: {}, lastLiveAt: {} };
    const record = value;
    return {
      version: 1,
      liveStartedAt: record.liveStartedAt ?? {},
      lastLiveAt: record.lastLiveAt ?? {},
      writeError: record.writeError,
      lastSnapshot: record.lastSnapshot
    };
  }

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
  function renderQuotaIcons(rings) {
    return {
      16: renderQuotaIcon(16, rings),
      32: renderQuotaIcon(32, rings),
      48: renderQuotaIcon(48, rings),
      128: renderQuotaIcon(128, rings)
    };
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
    const incomplete = snapshot.gpt6ProWeekly.coverage !== "complete-local" || snapshot.solProDaily.coverage !== "complete-local" || snapshot.combinedDaily.coverage !== "complete-local";
    return {
      outer: remainingToRatio(snapshot.gpt6ProWeekly.estimatedRemaining, snapshot.gpt6ProWeekly.limit),
      middle: remainingToRatio(snapshot.solProDaily.estimatedRemaining, snapshot.solProDaily.limit),
      inner: remainingToRatio(snapshot.combinedDaily.estimatedRemaining, snapshot.combinedDaily.limit),
      center: incomplete ? "?" : String(snapshot.tightestRemainingPercent ?? 0)
    };
  }
  function snapshotTitle(snapshot) {
    const coverage = snapshot.coverageLabel === "完整" ? "完整" : snapshot.coverageLabel;
    const workspace = snapshot.personalProEligible ? "" : "\n当前工作区不计入个人 Pro Chat 额度";
    return [
      "ChatGPT Yada Pro 额度",
      "",
      `GPT-6 Pro 本周：预计剩余 ${snapshot.gpt6ProWeekly.estimatedRemaining} / ${snapshot.gpt6ProWeekly.limit}`,
      `GPT-5.6 Sol Pro 今日：预计剩余 ${snapshot.solProDaily.estimatedRemaining} / ${snapshot.solProDaily.limit}`,
      `Pro 今日合计：预计剩余 ${snapshot.combinedDaily.estimatedRemaining} / ${snapshot.combinedDaily.limit}`,
      "",
      `统计覆盖：${coverage}`,
      "更新时间：刚刚",
      workspace
    ].join("\n").trim();
  }
  function nextAlarmAt(snapshot, now = Date.now()) {
    const times = [
      snapshot.gpt6ProWeekly.nextReleaseAt,
      snapshot.solProDaily.nextReleaseAt,
      snapshot.combinedDaily.nextReleaseAt
    ].filter((value) => typeof value === "number" && value > now);
    return times.length ? Math.min(...times) : now + Math.min(DAY_MS, WEEK_MS);
  }
  async function applyQuotaIcon(snapshot) {
    if (typeof chrome === "undefined" || !chrome.action?.setIcon) return;
    const imageData = renderQuotaIcons(snapshotToRings(snapshot));
    await chrome.action.setIcon({ imageData });
    await chrome.action.setTitle({ title: snapshotTitle(snapshot) });
  }

  // src/background/serviceWorker.ts
  var ALARM_NAME = "chatgpt-yada-quota-window";
  var ledger = new QuotaLedger();
  chrome.runtime.onInstalled.addListener(() => {
    void restore();
  });
  chrome.runtime.onStartup.addListener(() => {
    void restore();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes["chatgpt-yada:quota-ledger:v1"] || changes["chatgpt-yada:quota-state:v1"] || changes[BACKFILL_KEY]) {
      void restore();
    }
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) void restore();
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    void handle(message).then(sendResponse).catch((error) => sendResponse({ error: String(error) }));
    return true;
  });
  async function handle(message) {
    if (message.type === "quota/ingest") return ingest(message);
    if (message.type === "quota/get-state") return getState(message);
    if (message.type === "quota/refresh-current") {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const tabId = tabs[0]?.id;
      if (tabId != null) await chrome.tabs.sendMessage(tabId, message);
      return getState({ type: "quota/get-state" });
    }
    if (message.type === "quota/backfill-status") {
      const backfill = await readBackfill();
      return { status: backfill.status, scannedCount: Object.keys(backfill.scanned).length };
    }
    if (message.type === "quota/backfill-progress") return getState({ type: "quota/get-state" });
    return { error: "unknown-message" };
  }
  async function ingest(message) {
    const snapshot = await ledger.ingest(message.events);
    if (snapshot) await publish(snapshot);
    return { snapshot };
  }
  async function getState(message) {
    const restored = await ledger.restore();
    const accountKey = message.accountKey ?? restored.state.lastSnapshot?.accountKey ?? "account-unknown:unknown";
    const workspaceKind = message.workspaceKind ?? restored.state.lastSnapshot?.workspaceKind ?? "unknown";
    const backfill = await readBackfill();
    const snapshot = calculateQuotaSnapshot({
      accountKey,
      workspaceKind,
      events: restored.ledger.events,
      liveStartedAt: restored.state.liveStartedAt[accountKey],
      lastLiveAt: restored.state.lastLiveAt[accountKey],
      writeError: restored.state.writeError,
      backfillStatus: backfill.status
    });
    await publish(snapshot);
    return { snapshot };
  }
  async function restore() {
    const restored = await ledger.restore();
    const last = restored.state.lastSnapshot;
    const accountKey = last?.accountKey ?? Object.keys(restored.state.liveStartedAt)[0] ?? "account-unknown:unknown";
    const backfill = await readBackfill();
    const snapshot = calculateQuotaSnapshot({
      accountKey,
      workspaceKind: last?.workspaceKind ?? "unknown",
      events: restored.ledger.events,
      liveStartedAt: restored.state.liveStartedAt[accountKey],
      lastLiveAt: restored.state.lastLiveAt[accountKey],
      writeError: restored.state.writeError,
      backfillStatus: backfill.status
    });
    await publish(snapshot);
  }
  async function publish(snapshot) {
    await applyQuotaIcon(snapshot);
    const when = nextAlarmAt(snapshot);
    if (when) await chrome.alarms.create(ALARM_NAME, { when });
    try {
      await chrome.runtime.sendMessage({ type: "quota/storage-changed", snapshot });
    } catch {
    }
  }
  async function readBackfill() {
    const data = await chrome.storage.local.get(BACKFILL_KEY);
    const value = data[BACKFILL_KEY];
    if (!value || value.version !== 1) {
      return { version: 1, status: "idle", cutoffAt: 0, scanned: {}, cursorOffset: 0, updatedAt: 0 };
    }
    return value;
  }
})();
