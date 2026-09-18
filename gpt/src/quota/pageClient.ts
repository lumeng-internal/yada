import { chatgptApi, getChatGptAccountId } from "../conversation/fetchConversation";
import { parsePlanType } from "./vibebar/allowances";
import { identity } from "./vibebar/conversationParser";
import { modelLimits } from "./vibebar/modelLimits";
import type { ChatGPTChatModelLimit, ChatPlan } from "./vibebar/types";

export type ChatAccount = {
  userId: string | null;
  accountId: string | null;
  plan: ChatPlan;
  identity: string;
};

export async function readChatAccount(signal?: AbortSignal): Promise<ChatAccount> {
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
  const accountId = getChatGptAccountId();
  const identityKey = await identity(`${userId ?? "unknown"}:${accountId ?? "personal"}`);
  return { userId, accountId, plan, identity: identityKey };
}

export async function readModelLimits(now = Date.now(), signal?: AbortSignal): Promise<ChatGPTChatModelLimit[]> {
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
    return modelLimits(await response.json(), now);
  } catch {
    return [];
  }
}
