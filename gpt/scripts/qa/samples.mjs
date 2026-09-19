import { evaluateFn } from "../lib/cdp.mjs";
import { waitUntil } from "./runner.mjs";

export const PAGE_FETCH = `async (path, jsonBody) => {
  try {
    const session = await fetch("/api/auth/session", { credentials: "include" }).then((r) => r.ok ? r.json() : null).catch(() => null);
    const headers = { Accept: "application/json" };
    if (session && typeof session.accessToken === "string") headers.Authorization = "Bearer " + session.accessToken;
    const account = (function accountId() {
      try {
        const raw = localStorage.getItem("_account");
        if (!raw) return null;
        if (/^account-[a-z0-9_-]+$/i.test(raw)) return raw;
        const walk = (value) => {
          if (!value || typeof value !== "object") return null;
          for (const key of ["accountId", "account_id", "currentAccountId", "current_account_id", "id"]) {
            const candidate = value[key];
            if (typeof candidate === "string" && /^account-[a-z0-9_-]+$/i.test(candidate)) return candidate;
          }
          for (const nested of Object.values(value)) {
            const found = walk(nested);
            if (found) return found;
          }
          return null;
        };
        return walk(JSON.parse(raw));
      } catch {
        return null;
      }
    })();
    if (account) headers["Chatgpt-Account-Id"] = account;
    const init = { credentials: "include", cache: "no-store", headers };
    if (jsonBody !== undefined) {
      headers["Content-Type"] = "application/json";
      init.method = "POST";
      init.body = JSON.stringify(jsonBody);
    }
    let response = await fetch(path, init);
    if (response.status === 429) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
      response = await fetch(path, init);
    }
    const data = await response.json().catch(() => null);
    return { status: response.status, ok: response.ok, data };
  } catch {
    return { status: 0, ok: false, data: null };
  }
}`;

export const LIST_ITEMS = `async (input) => {
  const result = await (${PAGE_FETCH})("/backend-api/conversations?offset=" + input.offset + "&limit=50&order=updated&is_archived=" + input.archived);
  const items = Array.isArray(result.data && result.data.items) ? result.data.items : [];
  return items.map((item) => ({
    id: typeof item.id === "string" ? item.id : null,
    updateTime: item.update_time ?? null,
    origin: typeof item.conversation_origin === "string" ? item.conversation_origin : null,
    temporary: item.is_temporary_chat === true,
    gizmo: typeof item.gizmo_id === "string" && item.gizmo_id.length > 0
  }));
}`;

const WORK_ORIGINS = new Set(["tpp", "flora", "codex"]);

export function isWorkOrigin(origin) {
  return WORK_ORIGINS.has(String(origin || "").toLowerCase());
}

export function navigationEligible(item) {
  return Boolean(item && typeof item.id === "string" && item.temporary !== true && !isWorkOrigin(item.origin));
}

export function quotaEligible(item) {
  if (!navigationEligible(item)) return false;
  const origin = String(item.origin || "").toLowerCase();
  if (origin && origin !== "chat" && origin !== "chatgpt") return false;
  return true;
}

export function sampleKindFromProbe(probe) {
  if (!probe || probe.temporary || probe.isWork) return null;
  if (probe.hasPreviousPage === true || probe.userCount >= 100) return "long";
  if (probe.userCount >= 30 && probe.userCount <= 50) return "medium";
  if (probe.userCount >= 12 && probe.userCount <= 24) return "short";
  return null;
}

export function compactSample(sample) {
  if (!sample) return null;
  return {
    conversationId: sample.conversationId,
    update_time: sample.updateTime ?? null,
    turnCount: sample.turnCount ?? sample.userCount ?? null,
    sampleType: sample.sampleType ?? null,
    gizmo: sample.gizmo === true,
    hash: sample.duplicate?.hash ?? null
  };
}

export function selectSampleBuckets(probes) {
  const buckets = { short: [], medium: [], long: [], duplicate: [] };
  for (const probe of probes) {
    if (!probe || probe.temporary || probe.isWork) continue;
    const kind = sampleKindFromProbe(probe);
    if (kind) buckets[kind].push(probe);
    if (probe.duplicate?.a && probe.duplicate?.b && probe.duplicate.a !== probe.duplicate.b) {
      buckets.duplicate.push(probe);
    }
  }
  return buckets;
}

export function missingRequiredSamples(samples) {
  const missing = [];
  if (!samples.long) missing.push("long");
  if (!samples.duplicate) missing.push("duplicate");
  if (!samples.short) missing.push("short");
  if (!samples.medium) missing.push("medium");
  return missing;
}

export async function discoverFromList(items, options) {
  const {
    probe,
    hydrate,
    validate,
    now = Date.now,
    maxProbes = 200,
    deadline = now() + 160_000
  } = options;
  const listed = items.filter((item) => item && typeof item.id === "string");
  const eligible = listed.filter(navigationEligible);
  const navItems = [
    ...eligible.filter((item) => item.gizmo !== true),
    ...eligible.filter((item) => item.gizmo === true)
  ];
  const quotaItems = listed.filter(quotaEligible);
  const probes = [];
  let probeCount = 0;
  let hydrateCount = 0;
  let fullFetchCount = 0;

  for (const item of navItems) {
    if (probeCount >= maxProbes || now() >= deadline) break;
    probeCount += 1;
    const result = await probe(item);
    if (!result) continue;
    probes.push({
      ...result,
      conversationId: result.conversationId || item.id,
      gizmo: result.gizmo === true || item.gizmo === true,
      origin: result.origin ?? item.origin,
      temporary: result.temporary === true || item.temporary === true,
      updateTime: result.updateTime ?? item.updateTime
    });
  }

  const buckets = selectSampleBuckets(probes);
  const chosen = { short: null, medium: null, long: null, duplicate: null };
  for (const kind of ["short", "medium", "long", "duplicate"]) {
    let attempts = 0;
    for (const candidate of buckets[kind]) {
      if (now() >= deadline || attempts >= 5) break;
      attempts += 1;
      let accepted = candidate;
      if (candidate.gizmo && validate) {
        const ok = await validate(candidate);
        if (!ok) continue;
      }
      hydrateCount += 1;
      fullFetchCount += 1;
      const hydrated = hydrate ? await hydrate(accepted) : accepted;
      if (!hydrated) continue;
      const merged = {
        ...accepted,
        ...hydrated,
        conversationId: hydrated.conversationId || accepted.conversationId,
        sampleType: kind,
        userIds: hydrated.userIds || accepted.userIds || [],
        turnCount: hydrated.turnCount ?? accepted.userCount,
        duplicate: hydrated.duplicate || accepted.duplicate
      };
      if (kind === "long" && (merged.turnCount || 0) < 100) continue;
      if (kind === "short" && (merged.turnCount < 12 || merged.turnCount > 24)) continue;
      if (kind === "medium" && (merged.turnCount < 30 || merged.turnCount > 50)) continue;
      if (kind === "duplicate" && !(merged.duplicate?.a && merged.duplicate?.b && merged.duplicate.a !== merged.duplicate.b)) continue;
      chosen[kind] = merged;
      break;
    }
  }

  return {
    samples: chosen,
    discovery: {
      listed: listed.length,
      navigationEligible: navItems.length,
      quotaEligible: quotaItems.length,
      normalChats: listed.filter((item) => !item.gizmo).length,
      gizmoChats: listed.filter((item) => item.gizmo).length,
      probed: probeCount,
      probeHits: probes.length,
      probeNulls: probeCount - probes.length,
      hydrated: hydrateCount,
      fullFetched: fullFetchCount,
      maxUserCount: probes.reduce((max, item) => Math.max(max, item.userCount || 0), 0),
      hasPreviousPageHits: probes.filter((item) => item.hasPreviousPage === true).length,
      userCountHistogram: Object.fromEntries(Object.entries(probes.reduce((map, item) => {
        const key = String(item.userCount ?? "null");
        map[key] = (map[key] || 0) + 1;
        return map;
      }, {})).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 12))
    },
    probes
  };
}

export const PROBE_ONE = `async (id) => {
  const fetchJson = ${PAGE_FETCH};
  const unwrap = (data) => data && data.conversation ? data.conversation : data;
  const hashText = async (message) => {
    const parts = message && message.content && Array.isArray(message.content.parts) ? message.content.parts : [];
    const text = parts.map((part) => typeof part === "string" ? part : "").join("\\n").replace(/\\s+/g, " ").trim().toLowerCase();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  const collectUsers = async (messages) => {
    const users = [];
    for (const message of messages) {
      const role = message && message.author && message.author.role;
      if (role !== "user" || !message.id) continue;
      users.push({ id: message.id, hash: await hashText(message) });
    }
    const hashes = new Map();
    let duplicate = null;
    for (const user of users) {
      const prev = hashes.get(user.hash);
      if (prev && prev !== user.id) { duplicate = { a: prev, b: user.id, hash: user.hash }; break; }
      hashes.set(user.hash, user.id);
    }
    return { users, duplicate };
  };
  const mappingMessages = (conversation) => {
    const mapping = conversation.mapping || {};
    const messages = [];
    let cursor = conversation.current_node || conversation.current_node_id;
    const seen = new Set();
    while (cursor && mapping[cursor] && !seen.has(cursor)) {
      seen.add(cursor);
      if (mapping[cursor].message) messages.push(mapping[cursor].message);
      cursor = mapping[cursor].parent;
    }
    messages.reverse();
    return messages;
  };
  const raw = await fetchJson("/backend-api/conversations/" + encodeURIComponent(id) + "?include_has_versions=true&num_turns=100");
  if (!raw.ok || !raw.data) return null;
  const first = unwrap(raw.data);
  const origin = typeof first.conversation_origin === "string" ? first.conversation_origin : null;
  const model = typeof first.default_model_slug === "string" ? first.default_model_slug : "";
  const originKey = (origin || "").toLowerCase();
  const modelKey = model.toLowerCase();
  const page = first.page_info || first.pageInfo || {};
  const hasPreviousPage = page.has_previous_page === true || page.hasPreviousPage === true;
  const messages = Array.isArray(first.messages) ? first.messages : mappingMessages(first);
  const collected = await collectUsers(messages);
  return {
    conversationId: first.id || first.conversation_id || id,
    updateTime: first.update_time || null,
    origin,
    temporary: first.is_temporary_chat === true,
    gizmo: typeof first.gizmo_id === "string" && first.gizmo_id.length > 0,
    isWork: ["tpp", "flora", "codex"].includes(originKey) || modelKey.endsWith("-wm") || modelKey.includes("codex"),
    userCount: collected.users.length,
    userIds: collected.users.map((item) => item.id),
    duplicate: collected.duplicate,
    hasPreviousPage
  };
}`;

export const HYDRATE_ONE = `async (id) => {
  const fetchJson = ${PAGE_FETCH};
  const unwrap = (data) => data && data.conversation ? data.conversation : data;
  const hashText = async (message) => {
    const parts = message && message.content && Array.isArray(message.content.parts) ? message.content.parts : [];
    const text = parts.map((part) => typeof part === "string" ? part : "").join("\\n").replace(/\\s+/g, " ").trim().toLowerCase();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  const summarizeMessages = async (conversation, messages) => {
    const origin = typeof conversation.conversation_origin === "string" ? conversation.conversation_origin : null;
    const model = typeof conversation.default_model_slug === "string" ? conversation.default_model_slug : "";
    const originKey = (origin || "").toLowerCase();
    const modelKey = model.toLowerCase();
    const users = [];
    for (const message of messages) {
      const role = message && message.author && message.author.role;
      if (role !== "user" || !message.id) continue;
      users.push({ id: message.id, hash: await hashText(message) });
    }
    const hashes = new Map();
    let duplicate = null;
    for (const user of users) {
      const prev = hashes.get(user.hash);
      if (prev && prev !== user.id) { duplicate = { a: prev, b: user.id, hash: user.hash }; break; }
      hashes.set(user.hash, user.id);
    }
    return {
      conversationId: conversation.id || conversation.conversation_id || id,
      updateTime: conversation.update_time || null,
      turnCount: users.length,
      userIds: users.map((item) => item.id),
      duplicate,
      origin,
      isWork: ["tpp", "flora", "codex"].includes(originKey) || modelKey.endsWith("-wm") || modelKey.includes("codex"),
      temporary: conversation.is_temporary_chat === true,
      gizmo: typeof conversation.gizmo_id === "string" && conversation.gizmo_id.length > 0
    };
  };
  const pageUrl = (before) => {
    const path = before ? "/backend-api/conversations/" + encodeURIComponent(id) + "/messages" : "/backend-api/conversations/" + encodeURIComponent(id);
    return path + "?include_has_versions=true&num_turns=100" + (before ? "&before=" + encodeURIComponent(before) : "");
  };
  const firstRaw = await fetchJson(pageUrl(""));
  if (!firstRaw.ok || !firstRaw.data) return null;
  const first = unwrap(firstRaw.data);
  if (!Array.isArray(first.messages)) {
    const mapping = first.mapping || {};
    const messages = [];
    let cursor = first.current_node || first.current_node_id;
    const seen = new Set();
    while (cursor && mapping[cursor] && !seen.has(cursor)) {
      seen.add(cursor);
      if (mapping[cursor].message) messages.push(mapping[cursor].message);
      cursor = mapping[cursor].parent;
    }
    messages.reverse();
    return summarizeMessages(first, messages);
  }
  let messages = first.messages.slice();
  let page = first.page_info || first.pageInfo || {};
  let cursor = (page.has_previous_page === true || page.hasPreviousPage === true) ? (page.start_cursor || page.startCursor || "") : "";
  const seen = new Set();
  let count = 1;
  while (cursor && count < 20) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const nextRaw = await fetchJson(pageUrl(cursor));
    if (!nextRaw.ok) break;
    const next = unwrap(nextRaw.data || {});
    if (!Array.isArray(next.messages)) break;
    messages = next.messages.concat(messages);
    page = next.page_info || next.pageInfo || {};
    cursor = (page.has_previous_page === true || page.hasPreviousPage === true) ? (page.start_cursor || page.startCursor || "") : "";
    count += 1;
  }
  const unique = [];
  const ids = new Set();
  for (const message of messages) {
    if (!message || !message.id || ids.has(message.id)) continue;
    ids.add(message.id);
    unique.push(message);
  }
  return summarizeMessages(first, unique);
}`;

export async function listConversationItems(cdp, targetId) {
  const queued = [];
  for (const archived of [false, true]) {
    for (let page = 0; page < 4; page++) {
      const items = await evaluateFn(cdp, targetId, LIST_ITEMS, { archived, offset: page * 50 }, { timeoutMs: 20_000 });
      if (!Array.isArray(items) || !items.length) break;
      queued.push(...items);
    }
  }
  return queued;
}

export async function discoverLiveSamples(cdp, targetId, options = {}) {
  await waitUntil(async () => {
    const items = await evaluateFn(cdp, targetId, LIST_ITEMS, { archived: false, offset: 0 }, { timeoutMs: 20_000 }).catch(() => null);
    return Array.isArray(items) && items.length ? items : null;
  }, 30_000, "ChatGPT conversation list was empty");
  const items = await listConversationItems(cdp, targetId);
  const { validate, now = Date.now, deadline = now() + 160_000, maxProbes = 200 } = options;
  return discoverFromList(items, {
    now,
    deadline,
    maxProbes,
    validate,
    async probe(item) {
      return evaluateFn(cdp, targetId, PROBE_ONE, item.id, { timeoutMs: 20_000 });
    },
    async hydrate(sample) {
      return evaluateFn(cdp, targetId, HYDRATE_ONE, sample.conversationId, { timeoutMs: 45_000 });
    }
  });
}
