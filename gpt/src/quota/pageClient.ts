import { chatgptApi, getChatGptAccountId } from "../conversation/fetchConversation";
import { parsePlanType } from "./vibebar/allowances";
import { identity } from "./vibebar/conversationParser";
import { modelLimits } from "./vibebar/modelLimits";
import type { ChatGPTChatModelLimit, ChatPlan } from "./vibebar/types";

export const ACCOUNT_CACHE_TTL_MS = 30 * 60 * 1000;
export const MODEL_LIMITS_CACHE_TTL_MS = 10 * 60 * 1000;

export type ChatAccount = {
  userId: string | null;
  accountId: string | null;
  plan: ChatPlan;
  identity: string;
};

export type PageClientReadOptions = {
  force?: boolean;
  now?: number;
};

type AccountCache = {
  value: ChatAccount;
  fetchedAt: number;
};

type LimitsCache = {
  value: ChatGPTChatModelLimit[];
  fetchedAt: number;
};

let accountCache: AccountCache | null = null;
let limitsCache: LimitsCache | null = null;

export function resetPageClientCaches(): void {
  accountCache = null;
  limitsCache = null;
}

export async function readChatAccount(signal?: AbortSignal, options: PageClientReadOptions = {}): Promise<ChatAccount> {
  const now = options.now ?? Date.now();
  const cheapId = getChatGptAccountId();
  if (!options.force && accountCache && now - accountCache.fetchedAt < ACCOUNT_CACHE_TTL_MS) {
    if (cheapId && accountCache.value.accountId && cheapId !== accountCache.value.accountId) {
      accountCache = null;
    } else {
      return accountCache.value;
    }
  }
  let userId: string | null = null;
  let plan: ChatPlan = null;
  try {
    const session = await chatgptApi("/api/auth/session", { signal });
    if (session.ok) {
      const data = await session.json() as { user?: { id?: string } };
      userId = typeof data.user?.id === "string" ? data.user.id : null;
    }
  } catch {
    userId = null;
  }
  try {
    const usage = await chatgptApi("/backend-api/wham/usage", { signal });
    if (usage.ok) {
      const data = await usage.json() as { user_id?: string; account_id?: string; plan_type?: unknown };
      if (!userId) userId = typeof data.user_id === "string" ? data.user_id : typeof data.account_id === "string" ? data.account_id : null;
      plan = parsePlanType(data);
    }
  } catch {
    plan = null;
  }
  const accountId = cheapId ?? getChatGptAccountId();
  const identityKey = await identity(`${userId ?? "unknown"}:${accountId ?? "personal"}`);
  const value: ChatAccount = { userId, accountId, plan, identity: identityKey };
  accountCache = { value, fetchedAt: now };
  return value;
}

export async function readModelLimits(
  now = Date.now(),
  signal?: AbortSignal,
  options: PageClientReadOptions = {}
): Promise<ChatGPTChatModelLimit[]> {
  if (!options.force && limitsCache && now - limitsCache.fetchedAt < MODEL_LIMITS_CACHE_TTL_MS) {
    return limitsCache.value;
  }
  try {
    const offsetMin = -Math.round(new Date().getTimezoneOffset());
    const response = await chatgptApi("/backend-api/conversation/init", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_id: null,
        gizmo_id: null,
        requested_default_model: null,
        system_hints: [],
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timezone_offset_min: offsetMin
      })
    });
    if (!response.ok) return [];
    const value = modelLimits(await response.json(), now);
    limitsCache = { value, fetchedAt: now };
    return value;
  } catch {
    return [];
  }
}
