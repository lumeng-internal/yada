export type ScrollRoot = HTMLElement;
export function viewport(root: ScrollRoot): { top: number; height: number } {
  if (root === document.scrollingElement || root === document.documentElement) return { top: 0, height: innerHeight };
  const rect = root.getBoundingClientRect();
  const top = Math.max(0, rect.top + root.clientTop);
  return { top, height: Math.max(0, Math.min(innerHeight, rect.bottom) - top) };
}
