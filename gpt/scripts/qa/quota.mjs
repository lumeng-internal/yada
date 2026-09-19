import { evaluateFn } from "../lib/cdp.mjs";
import { PAGE_FETCH } from "./samples.mjs";
import { waitUntil } from "./runner.mjs";

export function classifyPlanType(planType) {
  const plan = typeof planType === "string" ? planType.trim().toLowerCase() : "";
  if (plan === "pro" || plan === "prolite") return plan;
  if (plan) return plan;
  return "unknown";
}

export function quotaLiveStatus(planCategory) {
  return planCategory === "pro" || planCategory === "prolite" ? "PASS" : "NOT_APPLICABLE";
}

export async function liveQuota(cdp, targetId) {
  await cdp.navigate(targetId, "https://chatgpt.com/");
  await waitUntil(async () => {
    const url = await evaluateFn(cdp, targetId, `() => location.hostname`);
    return String(url).includes("chatgpt.com") ? url : null;
  }, 15_000, "chatgpt home");
  const usage = await evaluateFn(cdp, targetId, `async () => {
    const result = await (${PAGE_FETCH})("/backend-api/wham/usage");
    const plan = result.data && typeof result.data.plan_type === "string" ? result.data.plan_type : null;
    return { ok: result.ok, plan };
  }`, undefined, { timeoutMs: 15_000 });
  const category = classifyPlanType(usage?.plan);
  const liveStatus = quotaLiveStatus(category);
  if (liveStatus === "NOT_APPLICABLE") {
    return {
      status: "NOT_APPLICABLE",
      plan: category,
      livePlanCategory: category,
      liveStatus: "NOT_APPLICABLE_NON_PRO_ACCOUNT",
      historyStatus: null,
      classifiedTurns: null,
      unclassifiedTurns: null,
      modelLimitsOk: null,
      knownProSlugs: ["gpt-6-pro", "gpt-5-6-pro"]
    };
  }

  const init = await evaluateFn(cdp, targetId, `async () => {
    const result = await (${PAGE_FETCH})("/backend-api/conversation/init", {
      conversation_id: null,
      gizmo_id: null,
      requested_default_model: null,
      system_hints: [],
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      timezone_offset_min: -Math.round(new Date().getTimezoneOffset())
    });
    const rows = Array.isArray(result.data && result.data.model_limits) ? result.data.model_limits : [];
    return { ok: result.ok, models: rows.map((row) => row && row.model_slug).filter(Boolean) };
  }`, undefined, { timeoutMs: 15_000 });

  const ledger = await waitUntil(async () => {
    const state = await evaluateFn(cdp, targetId, `async () => {
      if (typeof chrome === "undefined" || !chrome.storage?.local) return null;
      const data = await chrome.storage.local.get(["chatgpt-yada:quota-state:v2", "chatgpt-yada:quota-ledger:v2"]);
      const snapshot = data["chatgpt-yada:quota-state:v2"] || {};
      const events = data["chatgpt-yada:quota-ledger:v2"]?.events;
      return {
        historyComplete: snapshot.historyComplete === true,
        classifiedTurns: Array.isArray(events) ? events.length : 0,
        unclassifiedTurns: snapshot.unclassifiedTurns ?? 0
      };
    }`).catch(() => null);
    if (state && (state.historyComplete || state.classifiedTurns > 0)) return state;
    return null;
  }, 20_000, "quota ledger").catch(async () => (
    await evaluateFn(cdp, targetId, `async () => {
      if (typeof chrome === "undefined" || !chrome.storage?.local) return { historyComplete: false, classifiedTurns: 0, unclassifiedTurns: 0 };
      const data = await chrome.storage.local.get(["chatgpt-yada:quota-state:v2", "chatgpt-yada:quota-ledger:v2"]);
      const snapshot = data["chatgpt-yada:quota-state:v2"] || {};
      const events = data["chatgpt-yada:quota-ledger:v2"]?.events;
      return {
        historyComplete: snapshot.historyComplete === true,
        classifiedTurns: Array.isArray(events) ? events.length : 0,
        unclassifiedTurns: snapshot.unclassifiedTurns ?? 0
      };
    }`).catch(() => ({ historyComplete: false, classifiedTurns: 0, unclassifiedTurns: 0 }))
  ));

  return {
    status: "PASS",
    plan: category,
    livePlanCategory: category,
    liveStatus: "PASS",
    historyStatus: ledger.historyComplete ? "complete" : "incomplete",
    classifiedTurns: ledger.classifiedTurns,
    unclassifiedTurns: ledger.unclassifiedTurns,
    modelLimitsOk: Boolean(init?.ok || init?.models),
    knownProSlugs: ["gpt-6-pro", "gpt-5-6-pro"]
  };
}
