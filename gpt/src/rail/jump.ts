import type { YadaTurn } from "../conversation/types";
import { trustedUserAnchor, viewport, type ScrollRoot } from "./active";

function settle(signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    let frame = 0, timer = 0;
    const done = (): void => { cancelAnimationFrame(frame); clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
    if (signal.aborted) { done(); return; }
    signal.addEventListener("abort", done, { once: true });
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => { timer = window.setTimeout(done, 100); }); });
  });
}
export function jumpDirection(target: number, rendered: readonly number[]): number {
  if (!rendered.length) return 0;
  if (target < Math.min(...rendered)) return -1;
  if (target > Math.max(...rendered)) return 1;
  return 0;
}
export async function jumpToTurn(
  id: string, scan: () => YadaTurn[], getRoot: () => ScrollRoot, signal: AbortSignal
): Promise<boolean> {
  let turns = scan();
  const index = turns.findIndex(turn => turn.id === id);
  if (index < 0 || signal.aborted) return false;
  let root = getRoot();
  const origin = root.scrollTop;
  const exact = (): boolean => {
    turns = scan(); root = getRoot();
    const turn = turns.find(item => item.id === id);
    const anchor = trustedUserAnchor(turn);
    if (!anchor) return false;
    root.scrollTo({ top: Math.max(0, root.scrollTop + anchor.getBoundingClientRect().top - viewport(root).top - 80), behavior: "instant" });
    return true;
  };
  if (!exact()) {
    root.scrollTo({ top: index / Math.max(1, turns.length - 1) * Math.max(0, root.scrollHeight - root.clientHeight), behavior: "instant" });
  }
  for (let attempt = 0; attempt < 28; attempt++) {
    await settle(signal);
    if (signal.aborted) return false;
    if (exact()) {
      await settle(signal);
      if (signal.aborted) return false;
      if (exact()) return true;
    }
    const rendered = turns.filter(turn => trustedUserAnchor(turn)).map(turn => turn.index);
    const direction = jumpDirection(index, rendered);
    // An ambiguous gap must never be treated as the target. Probe around the estimated region.
    const step = direction || (attempt % 2 === 0 ? -1 : 1);
    const previous = root.scrollTop;
    root.scrollTo({ top: previous + step * viewport(root).height * 0.7, behavior: "instant" });
    if (root.scrollTop === previous && direction) break;
  }
  // A failed search restores the original view; it never claims a nearby turn as a success.
  if (!signal.aborted && root.isConnected) root.scrollTo({ top: origin, behavior: "instant" });
  return false;
}
