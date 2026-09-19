import { evaluateFn } from "../lib/cdp.mjs";
import { targetUrl } from "./extension.mjs";
import { holdWhile, waitUntil } from "./runner.mjs";

const USER_SELECTOR = '[data-message-author-role="user"][data-message-id]';

async function conversationState(cdp, targetId) {
  return evaluateFn(cdp, targetId, `() => ({
    url: location.href,
    users: document.querySelectorAll('${USER_SELECTOR}').length,
    host: Boolean(document.getElementById("chatgpt-yada-rail-host")),
    marks: document.getElementById("chatgpt-yada-rail-host")?.shadowRoot?.querySelectorAll("button.mark").length ?? 0,
    status: document.getElementById("chatgpt-yada-rail-host")?.shadowRoot?.querySelector('[role="status"]')?.textContent || ""
  })`);
}

export async function validateNavigationTarget(cdp, conversationId, createdTargetIds) {
  const targetId = await cdp.createTarget(`https://chatgpt.com/c/${conversationId}`);
  createdTargetIds.add(targetId);
  try {
    await cdp.attach(targetId, true);
    const ready = await waitUntil(async () => {
      const url = await targetUrl(cdp, targetId);
      if (!url.includes(`/c/${conversationId}`)) return null;
      const state = await conversationState(cdp, targetId).catch(() => null);
      if (!state) return null;
      if (state.users > 0 && state.host && state.marks > 0) return { targetId, ...state };
      return null;
    }, 20_000, "gizmo navigation target");
    return ready;
  } catch {
    await cdp.closeTarget(targetId).catch(() => undefined);
    createdTargetIds.delete(targetId);
    return null;
  }
}

export async function openConversation(cdp, conversationId, createdTargetIds) {
  const targetId = await cdp.createTarget(`https://chatgpt.com/c/${conversationId}`);
  createdTargetIds.add(targetId);
  await cdp.attach(targetId, true);
  await waitUntil(async () => {
    const url = await targetUrl(cdp, targetId);
    if (!url.includes(`/c/${conversationId}`)) {
      throw new Error(`ChatGPT conversation page did not stay open: ${url}`);
    }
    const state = await conversationState(cdp, targetId).catch(() => null);
    return state && state.users > 0 && state.host && state.marks > 0 ? state : null;
  }, 45_000, "Yada conversation did not become ready");
  return targetId;
}

async function clickMark(cdp, targetId, index) {
  await evaluateFn(cdp, targetId, `(index) => {
    const button = document.getElementById("chatgpt-yada-rail-host").shadowRoot.querySelectorAll("button.mark")[index];
    if (!button) throw new Error("missing rail mark " + index);
    button.click();
  }`, index);
}

async function jumpCheck(cdp, targetId, userId, index) {
  return evaluateFn(cdp, targetId, `(input) => {
    const node = document.querySelector('[data-message-id="' + input.userId + '"]');
    const status = document.getElementById("chatgpt-yada-rail-host")?.shadowRoot?.querySelector('[role="status"]')?.textContent || "";
    const active = document.getElementById("chatgpt-yada-rail-host")?.shadowRoot?.querySelector('[data-active="true"]');
    const activeIndex = active ? Number(active.dataset.index) : -1;
    if (!node) return { ok: false, reason: "not-rendered", status, activeIndex };
    const rect = node.getBoundingClientRect();
    const inView = rect.bottom > 80 && rect.top < innerHeight - 40;
    return {
      ok: inView && status !== "定位失败" && status !== "定位中" && activeIndex === input.index,
      inView,
      status,
      activeIndex,
      id: node.dataset.messageId
    };
  }`, { userId, index });
}

async function waitForJump(cdp, targetId, userId, index, kind) {
  const landed = await waitUntil(async () => {
    const check = await jumpCheck(cdp, targetId, userId, index);
    return check?.ok ? check : null;
  }, 15_000, `${kind} jump ${index}`);
  await holdWhile(async () => {
    const again = await jumpCheck(cdp, targetId, userId, index);
    return Boolean(again?.ok && again.id === userId);
  }, 400, `${kind} jump pulled back at ${index}`);
  return landed;
}

export async function liveNav(cdp, sample, kind, createdTargetIds) {
  const targetId = await openConversation(cdp, sample.conversationId, createdTargetIds);
  const railCount = await evaluateFn(cdp, targetId, `() => document.getElementById("chatgpt-yada-rail-host")?.shadowRoot?.querySelectorAll("button.mark").length ?? 0`);
  if (railCount !== sample.turnCount) throw new Error(`${kind}: API turns ${sample.turnCount} != rail ${railCount}`);
  const result = { ok: true, railCount, clicks: [] };
  if (kind !== "long") return result;
  const indexes = [0, Math.floor((sample.userIds.length - 1) / 2), sample.userIds.length - 1];
  for (const index of indexes) {
    const userId = sample.userIds[index];
    await clickMark(cdp, targetId, index);
    const check = await waitForJump(cdp, targetId, userId, index, kind);
    result.clicks.push({ index, userId, activeIndex: check.activeIndex });
  }
  return result;
}

export async function liveDuplicate(cdp, sample, createdTargetIds) {
  const targetId = await openConversation(cdp, sample.conversationId, createdTargetIds);
  const ids = [sample.duplicate.a, sample.duplicate.b];
  const landed = [];
  for (const id of ids) {
    const index = sample.userIds.indexOf(id);
    if (index < 0) throw new Error("duplicate sample missing user id");
    await clickMark(cdp, targetId, index);
    const visible = await waitUntil(async () => {
      const found = await evaluateFn(cdp, targetId, `(id) => {
        const node = document.querySelector('[data-message-id="' + id + '"]');
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        const status = document.getElementById("chatgpt-yada-rail-host")?.shadowRoot?.querySelector('[role="status"]')?.textContent || "";
        if (status === "定位中" || status === "定位失败") return null;
        return rect.bottom > 80 && rect.top < innerHeight - 40 ? id : null;
      }`, id);
      return found === id ? found : null;
    }, 15_000, `duplicate click ${id}`);
    landed.push(visible);
  }
  if (landed[0] === landed[1]) throw new Error("duplicate clicks landed on the same message");
  return { ok: true, landed };
}

function scrollTopExpr() {
  return `() => {
    const nodes = [...document.querySelectorAll("div, main, section")];
    const scroll = nodes.find((node) => node.scrollHeight > node.clientHeight + 200 && getComputedStyle(node).overflowY !== "visible");
    return scroll ? Math.round(scroll.scrollTop) : Math.round(window.scrollY);
  }`;
}

export async function liveCancel(cdp, sample, createdTargetIds) {
  const targetId = await openConversation(cdp, sample.conversationId, createdTargetIds);
  await clickMark(cdp, targetId, 0);
  await waitUntil(async () => {
    const state = await conversationState(cdp, targetId);
    return state.status === "定位中" ? state : null;
  }, 800, "navigation start").catch(() => null);
  await evaluateFn(cdp, targetId, `() => window.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 }))`);
  await waitUntil(async () => {
    const state = await conversationState(cdp, targetId);
    return state.status !== "定位中" ? state : null;
  }, 8_000, "navigation did not cancel");
  const status = (await conversationState(cdp, targetId)).status;
  if (status === "定位失败") throw new Error("cancel showed 定位失败");
  const first = await evaluateFn(cdp, targetId, scrollTopExpr());
  await holdWhile(async () => {
    const second = await evaluateFn(cdp, targetId, scrollTopExpr());
    return Math.abs((second ?? 0) - (first ?? 0)) <= 24;
  }, 400, `scroll continued after cancel: ${first}`);
  const second = await evaluateFn(cdp, targetId, scrollTopExpr());
  return { ok: true, cancelled: true, status, scrollTop: second };
}
