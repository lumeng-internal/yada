import { viewport, type ScrollRoot } from "./active";

export function placeRail(host: HTMLElement, root: ScrollRoot, count: number): void {
  const main = document.querySelector<HTMLElement>("main");
  const bounds = [main, root === document.scrollingElement ? null : root]
    .filter((element): element is HTMLElement => !!element)
    .map((element) => element.getBoundingClientRect())
    .filter((rect) => rect.width > 100 && rect.height > 100);

  let right = 60;
  if (bounds.length) {
    right = Math.max(44, innerWidth - Math.min(...bounds.map((rect) => rect.right)) + 24);
  } else {
    for (const panel of document.querySelectorAll<HTMLElement>('aside, [role="complementary"], [data-testid*="panel"]')) {
      const rect = panel.getBoundingClientRect();
      if (["fixed", "sticky"].includes(getComputedStyle(panel).position) && rect.width > 100 && rect.height > 150 && rect.left > innerWidth / 2 && rect.right > innerWidth - 80) {
        right = Math.max(right, innerWidth - rect.left + 24);
      }
    }
  }

  const composer = document.querySelector<HTMLElement>("#prompt-textarea, form textarea, [data-testid*='composer' i]");
  const composerTop = composer?.getBoundingClientRect().top ?? innerHeight - 80;
  const area = viewport(root);
  const top = Math.max(90, area.top + 50);
  const bottomLimit = Math.min(area.top + area.height - 24, composerTop - 24, innerHeight - 24);
  const available = Math.max(30, bottomLimit - top);
  const height = Math.min(available, Math.max(count * 4, Math.min(count * 17, available)));
  host.style.right = `${Math.min(Math.max(8, innerWidth - 70), right)}px`;
  host.style.top = `${top + Math.max(0, (available - height) / 2)}px`;
  host.style.height = `${height}px`;
}
