export function isChatGptPage(url = window.location.href): boolean {
  try {
    return new URL(url).hostname === "chatgpt.com";
  } catch {
    return false;
  }
}

export function getConversationIdFromUrl(url = window.location.href): string | null {
  try {
    const parsed = new URL(url);
    return parsed.pathname.match(/^\/c\/([a-z0-9-]+)/i)?.[1]
      ?? parsed.pathname.match(/^\/g\/[a-z0-9-]+\/c\/([a-z0-9-]+)/i)?.[1]
      ?? null;
  } catch {
    return url.match(/\/c\/([a-z0-9-]+)/i)?.[1] ?? null;
  }
}

export function isChatGptConversationPage(url = window.location.href): boolean {
  return isChatGptPage(url) && getConversationIdFromUrl(url) !== null;
}
