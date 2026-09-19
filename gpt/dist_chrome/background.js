"use strict";
(() => {
  // src/quota/vibebar/allowances.ts
  var GPT6_PRO = "gpt-6-pro";
  var SOL_PRO = "gpt-5-6-pro";
  var WEEK_SECONDS = 7 * 86400;
  var DAY_SECONDS = 86400;
  var GPT6_PRO_NAME = "GPT-6 Astra Pro";
  var SOL_PRO_NAME = "GPT-5.6 Sol Pro";
  var PRO_MODELS_NAME = "Pro Models";
  function allowances(plan) {
    switch (plan?.trim().toLowerCase()) {
      case "pro":
        return [
          { id: "gpt6_pro_weekly", group: GPT6_PRO_NAME, title: "Weekly", models: /* @__PURE__ */ new Set([GPT6_PRO]), limit: 200, windowSeconds: WEEK_SECONDS },
          { id: "sol_pro_daily", group: SOL_PRO_NAME, title: "Daily", models: /* @__PURE__ */ new Set([SOL_PRO]), limit: 170, windowSeconds: DAY_SECONDS },
          { id: "pro_daily", group: PRO_MODELS_NAME, title: "Daily", models: /* @__PURE__ */ new Set([GPT6_PRO, SOL_PRO]), limit: 200, windowSeconds: DAY_SECONDS }
        ];
      case "prolite":
        return [
          { id: "pro_weekly", group: PRO_MODELS_NAME, title: "Weekly", models: /* @__PURE__ */ new Set([GPT6_PRO, SOL_PRO]), limit: 50, windowSeconds: WEEK_SECONDS }
        ];
      default:
        return [];
    }
  }

  // src/quota/vibebar/conversationParser.ts
  function proBuckets(allowanceList, turns, limits, complete, now) {
    const unique = new Map(turns.map((turn) => [turn.id, turn])).values();
    const uniqueTurns = [...unique];
    const limited = new Map(limits.map((limit) => [limit.model, limit]));
    return allowanceList.map((allowance) => {
      const start = now - allowance.windowSeconds * 1e3;
      const used = uniqueTurns.filter((turn) => allowance.models.has(turn.model) && turn.createdAt > start && turn.createdAt <= now).length;
      const exhausted = [...allowance.models].every((model) => limited.has(model));
      let quantity;
      let resetAt;
      let rolling = false;
      if (exhausted) {
        quantity = { used: allowance.limit, remaining: 0, limit: allowance.limit, isEstimated: true, coverageComplete: true };
        resetAt = Math.max(0, ...[...allowance.models].map((model) => limited.get(model)?.resetsAt ?? 0)) || null;
      } else {
        quantity = {
          used,
          remaining: complete ? Math.max(0, allowance.limit - used) : null,
          limit: allowance.limit,
          isEstimated: true,
          coverageComplete: complete
        };
        const oldest = uniqueTurns.filter((turn) => allowance.models.has(turn.model) && turn.createdAt > start && turn.createdAt <= now).map((turn) => turn.createdAt).sort((a, b) => a - b)[0];
        resetAt = (oldest ?? now) + allowance.windowSeconds * 1e3;
        rolling = true;
      }
      const usedPercent = quantity.coverageComplete && quantity.limit ? Math.min(100, 100 * (quantity.used ?? 0) / quantity.limit) : 0;
      return {
        id: allowance.id,
        title: allowance.title,
        shortLabel: allowance.title,
        usedPercent,
        resetAt,
        rawWindowSeconds: allowance.windowSeconds,
        groupTitle: allowance.group,
        quantity,
        hasRollingReset: rolling
      };
    });
  }

  // src/quota/calculator.ts
  function calculateQuotaSnapshot(input) {
    const now = input.now ?? Date.now();
    const countable = input.events.filter(
      (event) => event.accountKey === input.accountKey && (event.classification === "personal" || event.classification === "temporary")
    );
    const turns = countable.map((event) => ({
      id: event.id,
      createdAt: event.createdAt,
      model: event.model
    }));
    const allowanceList = allowances(input.plan);
    const buckets = proBuckets(allowanceList, turns, input.limits ?? [], input.historyComplete && !input.writeError, now).map((bucket) => toMetric(bucket, input.limits ?? []));
    const gpt6ProWeekly = buckets.find((bucket) => bucket.id === "gpt6_pro_weekly") ?? null;
    const solProDaily = buckets.find((bucket) => bucket.id === "sol_pro_daily") ?? null;
    const combinedDaily = buckets.find((bucket) => bucket.id === "pro_daily") ?? buckets.find((bucket) => bucket.id === "pro_weekly") ?? null;
    const coverages = buckets.map((bucket) => bucket.coverage);
    const coverageLabel = input.plan == null || coverages.includes("degraded") ? "数据不完整" : coverages.includes("partial") || !input.historyComplete ? "历史估算" : "完整";
    const ratios = buckets.map((bucket) => bucket.remainingRatio).filter((value) => value != null);
    const fallbackModel = (input.limits ?? []).map((limit) => limit.fallbackModel).find((value) => !!value) ?? null;
    return {
      accountKey: input.accountKey,
      plan: input.plan,
      workspaceKind: input.workspaceKind,
      updatedAt: now,
      gpt6ProWeekly: gpt6ProWeekly ?? (input.plan === "prolite" ? combinedDaily : null),
      solProDaily: solProDaily ?? (input.plan === "prolite" ? combinedDaily : null),
      combinedDaily,
      buckets,
      unclassifiedTurns: input.unclassifiedTurns,
      recordedCount: countable.length,
      historyComplete: input.historyComplete,
      coverageLabel,
      tightestRemainingPercent: ratios.length ? Math.round(Math.min(...ratios) * 100) : null,
      personalProEligible: input.workspaceKind !== "work" && input.plan != null,
      serverLimits: [...input.limits ?? []],
      fallbackModel,
      updatedLabel: "刚刚更新"
    };
  }
  function toMetric(bucket, limits) {
    const remaining = bucket.quantity.remaining;
    const limit = bucket.quantity.limit ?? 0;
    const used = bucket.quantity.used ?? 0;
    const exhausted = remaining === 0 && bucket.quantity.used === limit && !bucket.hasRollingReset;
    const coverage = exhausted ? "complete-local" : bucket.quantity.coverageComplete ? "complete-local" : "partial";
    const serverResetAt = exhausted ? bucket.resetAt : null;
    const fallbackModel = exhausted ? limits.find((limitItem) => bucket.id.includes("gpt6") ? limitItem.model === "gpt-6-pro" : limitItem.model === "gpt-5-6-pro")?.fallbackModel ?? limits[0]?.fallbackModel ?? null : null;
    return {
      id: bucket.id,
      title: bucket.title,
      group: bucket.groupTitle,
      limit,
      used,
      estimatedRemaining: remaining,
      remainingRatio: remaining == null || limit <= 0 ? null : remaining / limit,
      nextReleaseAt: bucket.hasRollingReset ? bucket.resetAt : null,
      serverResetAt,
      coverage,
      exhausted,
      fallbackModel
    };
  }

  // src/quota/types.ts
  var LEDGER_KEY = "chatgpt-yada:quota-ledger:v2";
  var STATE_KEY = "chatgpt-yada:quota-state:v2";
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
    ingest(events, extras = {}) {
      return this.serialize(async () => {
        const { ledger: ledger2, state } = await this.read();
        const byId = new Map(ledger2.events.map((event) => [`${event.accountKey}:${event.id}`, event]));
        for (const event of events) {
          byId.set(`${event.accountKey}:${event.id}`, event);
        }
        ledger2.events = prune([...byId.values()], extras.now ?? Date.now());
        const accountKey = extras.accountKey ?? events[0]?.accountKey ?? state.accountKey;
        if (extras.plan !== void 0) state.plan = extras.plan;
        if (extras.historyComplete !== void 0) state.historyComplete = extras.historyComplete;
        if (extras.unclassifiedTurns !== void 0) state.unclassifiedTurns = extras.unclassifiedTurns;
        if (accountKey) state.accountKey = accountKey;
        const snapshot = accountKey ? calculateQuotaSnapshot({
          accountKey,
          plan: state.plan,
          workspaceKind: extras.workspaceKind ?? "personal",
          events: ledger2.events,
          limits: extras.limits,
          historyComplete: state.historyComplete,
          unclassifiedTurns: state.unclassifiedTurns,
          now: extras.now,
          writeError: state.writeError
        }) : null;
        if (snapshot) state.lastSnapshot = snapshot;
        await this.write(ledger2, state);
        return snapshot;
      });
    }
    async getSnapshot(accountKey, plan, extras = {}) {
      const { ledger: ledger2, state } = await this.read();
      return calculateQuotaSnapshot({
        accountKey,
        plan: plan ?? state.plan,
        workspaceKind: extras.workspaceKind ?? "personal",
        events: ledger2.events,
        limits: extras.limits,
        historyComplete: extras.historyComplete ?? state.historyComplete,
        unclassifiedTurns: extras.unclassifiedTurns ?? state.unclassifiedTurns,
        now: extras.now,
        writeError: state.writeError
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
    const kept = events.filter((event) => now - event.createdAt <= EVENT_TTL_MS).sort((a, b) => a.createdAt - b.createdAt);
    return kept.length > MAX_EVENTS ? kept.slice(kept.length - MAX_EVENTS) : kept;
  }
  function parseLedger(value) {
    if (!value || typeof value !== "object") return { version: 2, events: [] };
    const record = value;
    if (record.version !== 2 || !Array.isArray(record.events)) return { version: 2, events: [] };
    return {
      version: 2,
      events: record.events.filter((event) => event && typeof event.id === "string" && typeof event.accountKey === "string" && typeof event.model === "string")
    };
  }
  function parseState(value) {
    if (!value || typeof value !== "object") return { version: 2, plan: null, historyComplete: false, unclassifiedTurns: 0 };
    const record = value;
    return {
      version: 2,
      accountKey: record.accountKey,
      plan: record.plan === "pro" || record.plan === "prolite" ? record.plan : null,
      historyComplete: record.historyComplete === true,
      unclassifiedTurns: record.unclassifiedTurns ?? 0,
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
    const incomplete = snapshot.coverageLabel !== "完整" || snapshot.tightestRemainingPercent == null;
    return {
      outer: remainingToRatio(snapshot.gpt6ProWeekly?.estimatedRemaining ?? 0, snapshot.gpt6ProWeekly?.limit ?? 1),
      middle: remainingToRatio(snapshot.solProDaily?.estimatedRemaining ?? 0, snapshot.solProDaily?.limit ?? 1),
      inner: remainingToRatio(snapshot.combinedDaily?.estimatedRemaining ?? 0, snapshot.combinedDaily?.limit ?? 1),
      center: incomplete ? "?" : String(snapshot.tightestRemainingPercent ?? 0)
    };
  }
  function snapshotTitle(snapshot) {
    const workspace = snapshot.personalProEligible ? "" : "\n当前工作区不计入个人 Pro Chat 额度";
    return [
      "ChatGPT Yada Pro 额度",
      "",
      metricLine("GPT-6 Pro", snapshot.gpt6ProWeekly),
      metricLine("GPT-5.6 Sol Pro", snapshot.solProDaily),
      metricLine("两个 Pro", snapshot.combinedDaily),
      "",
      `历史同步：${snapshot.historyComplete ? "完整" : "不完整"}`,
      `未分类轮次：${snapshot.unclassifiedTurns}`,
      snapshot.updatedLabel,
      workspace
    ].join("\n").trim();
  }
  function nextAlarmAt(snapshot, now = Date.now()) {
    const times = [
      snapshot.gpt6ProWeekly?.nextReleaseAt,
      snapshot.solProDaily?.nextReleaseAt,
      snapshot.combinedDaily?.nextReleaseAt,
      snapshot.gpt6ProWeekly?.serverResetAt,
      snapshot.solProDaily?.serverResetAt,
      snapshot.combinedDaily?.serverResetAt
    ].filter((value) => typeof value === "number" && value > now);
    return times.length ? Math.min(...times) : now + 60 * 60 * 1e3;
  }
  async function applyQuotaIcon(snapshot) {
    if (typeof chrome === "undefined" || !chrome.action?.setIcon) return;
    const imageData = renderQuotaIcons(snapshotToRings(snapshot));
    await chrome.action.setIcon({ imageData });
    await chrome.action.setTitle({ title: snapshotTitle(snapshot) });
  }
  function metricLine(label, metric) {
    if (!metric) return `${label}：当前套餐无此桶`;
    if (metric.estimatedRemaining == null) return `${label}：已记录 ${metric.used}，历史同步不完整`;
    return `${label}：预计剩余 ${metric.estimatedRemaining} / ${metric.limit}`;
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
  var REFRESH_TIMEOUT_MS = 45e3;

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
    if (changes["chatgpt-yada:quota-ledger:v2"] || changes[STATE_KEY]) void restore();
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
      if (tabId == null) throw new Error("没有可刷新的 ChatGPT 标签页");
      const result = await withTimeout(
        Promise.resolve(chrome.tabs.sendMessage(tabId, message)),
        REFRESH_TIMEOUT_MS,
        "刷新超时，后台未响应"
      );
      if (result?.error) throw new Error(result.error);
      return getState({ type: "quota/get-state" });
    }
    return { error: "unknown-message" };
  }
  async function ingest(message) {
    const snapshot = await ledger.ingest(message.events, {
      plan: message.plan,
      historyComplete: message.historyComplete,
      unclassifiedTurns: message.unclassifiedTurns,
      limits: message.limits,
      workspaceKind: message.workspaceKind,
      accountKey: message.accountKey
    });
    if (snapshot) await publish(snapshot);
    return { snapshot };
  }
  async function getState(message) {
    const restored = await ledger.restore();
    const accountKey = message.accountKey ?? restored.state.accountKey ?? restored.state.lastSnapshot?.accountKey ?? "chat-unknown";
    const snapshot = calculateQuotaSnapshot({
      accountKey,
      plan: message.plan ?? restored.state.plan,
      workspaceKind: restored.state.lastSnapshot?.workspaceKind ?? "personal",
      events: restored.ledger.events,
      historyComplete: restored.state.historyComplete,
      unclassifiedTurns: restored.state.unclassifiedTurns,
      writeError: restored.state.writeError
    });
    await publish(snapshot);
    return { snapshot };
  }
  async function restore() {
    const restored = await ledger.restore();
    const last = restored.state.lastSnapshot;
    const snapshot = calculateQuotaSnapshot({
      accountKey: last?.accountKey ?? restored.state.accountKey ?? "chat-unknown",
      plan: restored.state.plan,
      workspaceKind: last?.workspaceKind ?? "personal",
      events: restored.ledger.events,
      historyComplete: restored.state.historyComplete,
      unclassifiedTurns: restored.state.unclassifiedTurns,
      writeError: restored.state.writeError
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
})();
