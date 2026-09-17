export type PendingJump = {
  conversationId: string;
  userMessageId: string;
  index: number;
  attempted: true;
  createdAt: number;
};

const PENDING_KEY = "chatgpt-yada:pending-jump:v1";
const FALLBACK_PREFIX = "chatgpt-yada:message-fallback:";
export const PENDING_TTL_MS = 60_000;
export const PENDING_RESTORE_MS = 45_000;

function storage(): Storage | null {
  try { return sessionStorage; } catch { return null; }
}

export function readPendingJump(): PendingJump | null {
  const raw = storage()?.getItem(PENDING_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingJump;
    if (!parsed?.conversationId || !parsed.userMessageId || parsed.attempted !== true) return null;
    const createdAt = Number(parsed.createdAt) || 0;
    if (!createdAt || Date.now() - createdAt > PENDING_TTL_MS) {
      storage()?.removeItem(PENDING_KEY);
      return null;
    }
    return { ...parsed, createdAt };
  } catch {
    return null;
  }
}

export function writePendingJump(pending: Omit<PendingJump, "createdAt"> & { createdAt?: number }): void {
  storage()?.setItem(PENDING_KEY, JSON.stringify({ ...pending, createdAt: pending.createdAt ?? Date.now() }));
}

export function clearPendingJump(): void {
  storage()?.removeItem(PENDING_KEY);
}

export function messageFallbackUsed(conversationId: string): boolean {
  return storage()?.getItem(`${FALLBACK_PREFIX}${conversationId}`) === "1";
}

export function markMessageFallbackUsed(conversationId: string): void {
  storage()?.setItem(`${FALLBACK_PREFIX}${conversationId}`, "1");
}

export function messageQueryHref(href = location.href): string | null {
  const url = new URL(href);
  if (url.searchParams.has("message")) return null;
  url.searchParams.set("message", "");
  return url.toString();
}

export function replaceWithMessageQuery(): boolean {
  const next = messageQueryHref();
  if (!next) return false;
  location.replace(next);
  return true;
}

export function canUseMessageFallback(conversationId: string): boolean {
  return !messageFallbackUsed(conversationId) && !new URL(location.href).searchParams.has("message");
}
