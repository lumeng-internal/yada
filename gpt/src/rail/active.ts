export type ScrollRoot = HTMLElement;

export function viewport(root: ScrollRoot): { top: number; height: number } {
  if (root === document.scrollingElement || root === document.documentElement) {
    return { top: 0, height: innerHeight };
  }
  const rect = root.getBoundingClientRect();
  const top = Math.max(0, rect.top + root.clientTop);
  return { top, height: Math.max(0, Math.min(innerHeight, rect.bottom) - top) };
}

export function findScrollRoot(): ScrollRoot {
  const sample = document.querySelector<HTMLElement>('[data-message-author-role="user"], [data-message-author-role="assistant"]');
  let parent = sample?.parentElement ?? null;
  while (parent && parent !== document.body) {
    const overflowY = getComputedStyle(parent).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return parent;
    parent = parent.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

export function readVisibleUserMessageId(root: ScrollRoot): string | null {
  const area = viewport(root);
  const nodes = [...document.querySelectorAll<HTMLElement>('[data-message-author-role="user"][data-message-id], [data-message-author-role="user"]')];
  let best: { id: string; distance: number } | null = null;
  for (const node of nodes) {
    const id = node.dataset.messageId ?? node.closest<HTMLElement>("[data-message-id]")?.dataset.messageId;
    if (!id) continue;
    const rect = node.getBoundingClientRect();
    if (rect.bottom < area.top || rect.top > area.top + area.height) continue;
    const distance = Math.abs(rect.top - (area.top + 80));
    if (!best || distance < best.distance) best = { id, distance };
  }
  return best?.id ?? null;
}
