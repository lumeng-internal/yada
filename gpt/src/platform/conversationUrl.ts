/** DOM-free ChatGPT conversation URL helpers shared by MAIN and isolated worlds. */

export function conversationIdFromUrl(input: string): string | null {
  try {
    const parts = new URL(input).pathname.split("/").filter(Boolean);
    const marker = parts.findIndex((part) => part.toLowerCase() === "c");
    return marker >= 0 && marker + 1 < parts.length && /^[A-Za-z0-9_-]{1,128}$/.test(parts[marker + 1]!)
      ? parts[marker + 1]!
      : null;
  } catch {
    return null;
  }
}

export function isChatGptHostname(hostname: string): boolean {
  return hostname.trim().toLowerCase().replace(/\.$/, "") === "chatgpt.com";
}

export function isChatGptPageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && isChatGptHostname(parsed.hostname);
  } catch {
    return false;
  }
}

export function isChatGptConversationUrl(url: string): boolean {
  return isChatGptPageUrl(url) && conversationIdFromUrl(url) !== null;
}
