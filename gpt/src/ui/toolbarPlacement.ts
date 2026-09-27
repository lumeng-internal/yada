import { computePosition, flip, offset, shift } from "@floating-ui/dom";

export const TOOLBAR_GAP_PX = 8;
export const TOOLBAR_VIEWPORT_PADDING_PX = 8;

export type PlacementBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type PlacementObstacle = {
  rect: PlacementBox;
  kind: "native-action" | "title" | "content";
};

export function rectanglesOverlap(left: PlacementBox, right: PlacementBox): boolean {
  return left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
}

export function boxFromRect(rect: DOMRectReadOnly): PlacementBox {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height
  };
}

export function boxAt(x: number, y: number, width: number, height: number): PlacementBox {
  return { left: x, top: y, right: x + width, bottom: y + height, width, height };
}

export function placementAllowed(
  toolbar: PlacementBox,
  obstacles: readonly PlacementObstacle[],
  viewport: { width: number; height: number }
): boolean {
  if (toolbar.width <= 0 || toolbar.height <= 0) return false;
  if (toolbar.left < -0.5 || toolbar.top < -0.5) return false;
  if (toolbar.right > viewport.width + 0.5 || toolbar.bottom > viewport.height + 0.5) return false;
  return !obstacles.some((item) => rectanglesOverlap(toolbar, item.rect));
}

export async function computeToolbarPosition(
  reference: HTMLElement,
  floating: HTMLElement
): Promise<{ x: number; y: number; placement: string } | null> {
  const first = await computePosition(reference, floating, {
    placement: "left",
    strategy: "fixed",
    middleware: [
      offset(TOOLBAR_GAP_PX),
      flip({ fallbackPlacements: ["bottom-end"] }),
      shift({ padding: TOOLBAR_VIEWPORT_PADDING_PX })
    ]
  });
  return { x: first.x, y: first.y, placement: first.placement };
}

export async function computeFallbackToolbarPosition(
  reference: HTMLElement,
  floating: HTMLElement
): Promise<{ x: number; y: number; placement: string } | null> {
  const next = await computePosition(reference, floating, {
    placement: "bottom-end",
    strategy: "fixed",
    middleware: [offset(TOOLBAR_GAP_PX), shift({ padding: TOOLBAR_VIEWPORT_PADDING_PX })]
  });
  return { x: next.x, y: next.y, placement: next.placement };
}
