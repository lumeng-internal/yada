/**
 * Renders a fixed-position timeline navigator for claude.ai messages.
 */

import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useTimeline } from '../../hooks/useTimeline';
import {
  getCopySelectionSnapshot,
  subscribeCopySelection,
  toggleCopySelectionTurn,
  toggleCopySelectionTurnIds,
  type CopySelectionSnapshot,
} from '../../services/copySelection';
import {
  getRailPreviewMode,
  subscribeRailPreviewMode,
  type RailPreviewMode,
} from '../../services/railPreviewMode';

type DragBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type RailInteractionMode = 'idle' | 'pendingClick' | 'draggingMarquee';

type HoverPreview = {
  turnId: string;
  index: number;
  userText: string;
  assistantText: string;
  showAssistant: boolean;
  userLines: number;
  assistantLines: number;
  top: number;
  left: number;
  expanded: boolean;
};

type RailNodeRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type RailHoverTarget = {
  index: number;
  turnId: string;
  rect: RailNodeRect;
};

type RailNodeLayout = {
  index: number;
  turnId: string;
  rect: RailNodeRect;
  visualRect: RailNodeRect;
  hitRect: RailNodeRect;
};

type RailPointerState = {
  mode: Exclude<RailInteractionMode, 'idle'>;
  pointerId: number;
  captureElement: HTMLDivElement | null;
  startX: number;
  startY: number;
  initialSelectedIds: Set<string>;
  nodeLayouts: RailNodeLayout[];
  touchedTurnIds: Set<string>;
};

const DRAG_SELECTION_THRESHOLD_PX = 5;
const CLICK_SELECTION_TOLERANCE_PX = 0;
const HOVER_PREVIEW_SHORT_LIMIT = 240;
const HOVER_PREVIEW_LONG_LIMIT = 720;
const HOVER_PREVIEW_WIDTH_PX = 296;
const HOVER_PREVIEW_USER_SHORT_HEIGHT_PX = 76;
const HOVER_PREVIEW_ASSISTANT_SHORT_HEIGHT_PX = 94;
const HOVER_PREVIEW_USER_LONG_HEIGHT_PX = 156;
const HOVER_PREVIEW_ASSISTANT_LONG_HEIGHT_PX = 260;
const HOVER_PREVIEW_GAP_PX = 14;
const HOVER_PREVIEW_EXPAND_DELAY_MS = 1000;
const HOVER_RAIL_LEFT_EXPAND_PX = 64;
const HOVER_RAIL_RIGHT_EXPAND_PX = 32;
const HOVER_RAIL_Y_EXPAND_PX = 18;
const HOVER_NODE_MAX_DX_PX = 64;
const HOVER_NODE_MAX_DY_PX = 18;
const NODE_HIT_X_EXPAND_PX = 56;
const NODE_HIT_Y_EXPAND_PX = 10;
const MARQUEE_START_LEFT_EXPAND_PX = 80;
const MARQUEE_START_RIGHT_EXPAND_PX = 40;
const MARQUEE_START_Y_EXPAND_PX = 24;
const TEMPORARY_FOCUS_DURATION_MS = 1400;
const FOLLOWUP_CLICK_SUPPRESS_MS = 120;
const GLOBAL_SELECT_LOCK_CLASS = 'claude-yada-rail-marquee-active';
const EMPTY_PREVIEW_TEXT = '[无文字消息]';
const EMPTY_CLAUDE_PREVIEW_TEXT = '未提取到 Claude 摘要';
const NO_CLAUDE_PREVIEW_TEXT = '本轮暂无 Claude 回复';

const buildDragBox = (startX: number, startY: number, currentX: number, currentY: number): DragBox => {
  const left = Math.min(startX, currentX);
  const top = Math.min(startY, currentY);
  return {
    left,
    top,
    width: Math.abs(currentX - startX),
    height: Math.abs(currentY - startY),
  };
};

const rectsIntersect = (box: DragBox, rect: RailNodeRect): boolean => {
  const boxRight = box.left + box.width;
  const boxBottom = box.top + box.height;
  return box.left <= rect.right && boxRight >= rect.left && box.top <= rect.bottom && boxBottom >= rect.top;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const toRailNodeRect = (rect: DOMRect): RailNodeRect => ({
  left: rect.left,
  top: rect.top,
  right: rect.right,
  bottom: rect.bottom,
  width: rect.width,
  height: rect.height,
});

const expandRailNodeRect = (rect: RailNodeRect, expandX: number, expandY: number): RailNodeRect => ({
  left: rect.left - expandX,
  top: rect.top - expandY,
  right: rect.right + expandX,
  bottom: rect.bottom + expandY,
  width: rect.width + expandX * 2,
  height: rect.height + expandY * 2,
});

const expandRailBounds = (
  rect: RailNodeRect,
  expandLeft: number,
  expandRight: number,
  expandY: number,
): RailNodeRect => ({
  left: rect.left - expandLeft,
  top: rect.top - expandY,
  right: rect.right + expandRight,
  bottom: rect.bottom + expandY,
  width: rect.width + expandLeft + expandRight,
  height: rect.height + expandY * 2,
});

const pointInRect = (clientX: number, clientY: number, rect: RailNodeRect): boolean => (
  clientX >= rect.left &&
  clientX <= rect.right &&
  clientY >= rect.top &&
  clientY <= rect.bottom
);

const getPointAxisDistanceToRect = (clientX: number, clientY: number, rect: RailNodeRect): { dx: number; dy: number } => ({
  dx: clientX < rect.left ? rect.left - clientX : clientX > rect.right ? clientX - rect.right : 0,
  dy: clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0,
});

const pointToRectDistance = (clientX: number, clientY: number, rect: RailNodeRect): number => {
  const { dx, dy } = getPointAxisDistanceToRect(clientX, clientY, rect);
  return Math.hypot(dx, dy);
};

const getRectCenterDistance = (clientX: number, clientY: number, rect: RailNodeRect): number => {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  return Math.hypot(clientX - centerX, clientY - centerY);
};

const getRailVisualBounds = (layouts: RailNodeLayout[]): RailNodeRect | null => {
  if (layouts.length === 0) return null;

  const left = Math.min(...layouts.map((layout) => layout.visualRect.left));
  const top = Math.min(...layouts.map((layout) => layout.visualRect.top));
  const right = Math.max(...layouts.map((layout) => layout.visualRect.right));
  const bottom = Math.max(...layouts.map((layout) => layout.visualRect.bottom));

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
};

const getRailInteractionBounds = (
  layouts: RailNodeLayout[],
  expandLeft: number,
  expandRight: number,
  expandY: number,
): RailNodeRect | null => {
  const bounds = getRailVisualBounds(layouts);
  return bounds ? expandRailBounds(bounds, expandLeft, expandRight, expandY) : null;
};

const setGlobalSelectLock = (enabled: boolean) => {
  document.documentElement.classList.toggle(GLOBAL_SELECT_LOCK_CLASS, enabled);
  if (enabled) document.getSelection()?.removeAllRanges();
};

const releasePointerCapture = (state: RailPointerState | null) => {
  if (!state?.captureElement) return;
  try {
    if (state.captureElement.hasPointerCapture(state.pointerId)) {
      state.captureElement.releasePointerCapture(state.pointerId);
    }
  } catch {
    // The browser can drop pointer capture during blur/cancel before React sees it.
  }
};

const formatPreviewText = (text: string, limit: number): string => {
  const normalized = text
    .split(/\n+/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  const chars = Array.from(normalized);
  if (chars.length <= limit) return normalized;
  return `${chars.slice(0, limit).join('')}…`;
};

const readElementText = (limit: number, ...elements: Array<Element | undefined>): string => {
  for (const element of elements) {
    const text = formatPreviewText(element?.textContent ?? '', limit);
    if (text) return text;
  }
  return '';
};

const getHoverPreviewHeight = (showAssistant: boolean, expanded: boolean): number => {
  if (expanded) {
    return showAssistant ? HOVER_PREVIEW_ASSISTANT_LONG_HEIGHT_PX : HOVER_PREVIEW_USER_LONG_HEIGHT_PX;
  }
  return showAssistant ? HOVER_PREVIEW_ASSISTANT_SHORT_HEIGHT_PX : HOVER_PREVIEW_USER_SHORT_HEIGHT_PX;
};

const getRailDensity = (count: number): 'relaxed' | 'compact' | 'dense' => {
  if (count > 80) return 'dense';
  if (count > 30) return 'compact';
  return 'relaxed';
};

export default function Timeline() {
  const { nodes, activeIndex, scrollToNode } = useTimeline();
  const [selectionSnapshot, setSelectionSnapshot] = useState<CopySelectionSnapshot>(() => getCopySelectionSnapshot());
  const [previewMode, setPreviewMode] = useState<RailPreviewMode>(() => getRailPreviewMode());
  const [hoveredTurnId, setHoveredTurnId] = useState<string | null>(null);
  const [hoveredRect, setHoveredRect] = useState<RailNodeRect | null>(null);
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const [interactionMode, setInteractionMode] = useState<RailInteractionMode>('idle');
  const [temporaryFocusIndex, setTemporaryFocusIndex] = useState<number | null>(null);
  const [dragFocusIndex, setDragFocusIndex] = useState<number | null>(null);
  const [marqueeTouchedTurnIds, setMarqueeTouchedTurnIds] = useState<Set<string>>(() => new Set());
  const activeButtonRef = useRef<HTMLButtonElement | null>(null);
  const railHitZoneRef = useRef<HTMLDivElement | null>(null);
  const nodeButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const pointerStateRef = useRef<RailPointerState | null>(null);
  const hoveredTurnIdRef = useRef<string | null>(null);
  const lastPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const suppressNextClickRef = useRef(false);
  const temporaryFocusTimeoutRef = useRef<number | null>(null);
  const hoverExpandTimeoutRef = useRef<number | null>(null);
  const suppressClickTimeoutRef = useRef<number | null>(null);
  const [dragBox, setDragBox] = useState<DragBox | null>(null);
  const nodeIdsKey = useMemo(() => nodes.map((node) => node.turnId).join('\u001f'), [nodes]);

  useEffect(() => subscribeCopySelection(setSelectionSnapshot), []);
  useEffect(() => subscribeRailPreviewMode(setPreviewMode), []);

  useEffect(() => {
    activeButtonRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, nodes.length]);

  const clearPointerState = useCallback(() => {
    releasePointerCapture(pointerStateRef.current);
    pointerStateRef.current = null;
    setInteractionMode('idle');
    setDragBox(null);
    setDragFocusIndex(null);
    setMarqueeTouchedTurnIds(new Set());
    setGlobalSelectLock(false);
  }, []);

  const suppressFollowupClick = useCallback(() => {
    suppressNextClickRef.current = true;
    if (suppressClickTimeoutRef.current) window.clearTimeout(suppressClickTimeoutRef.current);
    suppressClickTimeoutRef.current = window.setTimeout(() => {
      suppressClickTimeoutRef.current = null;
      suppressNextClickRef.current = false;
    }, FOLLOWUP_CLICK_SUPPRESS_MS);
  }, []);

  const clearTemporaryFocus = useCallback(() => {
    if (temporaryFocusTimeoutRef.current) {
      window.clearTimeout(temporaryFocusTimeoutRef.current);
      temporaryFocusTimeoutRef.current = null;
    }
    setTemporaryFocusIndex(null);
  }, []);

  const setTemporaryFocus = useCallback((index: number) => {
    if (temporaryFocusTimeoutRef.current) window.clearTimeout(temporaryFocusTimeoutRef.current);
    setTemporaryFocusIndex(index);
    temporaryFocusTimeoutRef.current = window.setTimeout(() => {
      temporaryFocusTimeoutRef.current = null;
      setTemporaryFocusIndex(null);
    }, TEMPORARY_FOCUS_DURATION_MS);
  }, []);

  const clearHoverTarget = useCallback(() => {
    hoveredTurnIdRef.current = null;
    if (hoverExpandTimeoutRef.current) {
      window.clearTimeout(hoverExpandTimeoutRef.current);
      hoverExpandTimeoutRef.current = null;
    }
    setHoveredTurnId(null);
    setHoveredRect(null);
    setHoverExpanded(false);
  }, []);

  useEffect(() => () => {
    if (temporaryFocusTimeoutRef.current) window.clearTimeout(temporaryFocusTimeoutRef.current);
    if (hoverExpandTimeoutRef.current) window.clearTimeout(hoverExpandTimeoutRef.current);
    if (suppressClickTimeoutRef.current) window.clearTimeout(suppressClickTimeoutRef.current);
    setGlobalSelectLock(false);
  }, []);

  useEffect(() => {
    if (selectionSnapshot.selectionMode) return;
    clearPointerState();
  }, [clearPointerState, selectionSnapshot.selectionMode]);

  useEffect(() => {
    clearPointerState();
    clearHoverTarget();
    clearTemporaryFocus();
  }, [clearHoverTarget, clearPointerState, clearTemporaryFocus, nodeIdsKey]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      clearPointerState();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clearPointerState]);

  const getCurrentNodeLayouts = useCallback((): RailNodeLayout[] => {
    const layouts: RailNodeLayout[] = [];

    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      const button = nodeButtonRefs.current.get(node.turnId);
      if (!button) continue;

      const rect = toRailNodeRect(button.getBoundingClientRect());
      const visualElement = button.querySelector<HTMLElement>('.claude-yada-rail__bar');
      const visualRect = toRailNodeRect((visualElement ?? button).getBoundingClientRect());
      layouts.push({
        index,
        turnId: node.turnId,
        rect,
        visualRect,
        hitRect: expandRailNodeRect(visualRect, NODE_HIT_X_EXPAND_PX, NODE_HIT_Y_EXPAND_PX),
      });
    }

    return layouts;
  }, [nodes]);

  const findRailNodeAtPoint = useCallback((clientX: number, clientY: number, layouts = getCurrentNodeLayouts()): RailHoverTarget | null => {
    const interactionBounds = getRailInteractionBounds(
      layouts,
      HOVER_RAIL_LEFT_EXPAND_PX,
      HOVER_RAIL_RIGHT_EXPAND_PX,
      HOVER_RAIL_Y_EXPAND_PX,
    );
    if (!interactionBounds || !pointInRect(clientX, clientY, interactionBounds)) return null;

    let bestTarget: RailHoverTarget | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const layout of layouts) {
      const { dx, dy } = getPointAxisDistanceToRect(clientX, clientY, layout.visualRect);
      if (dx > HOVER_NODE_MAX_DX_PX || dy > HOVER_NODE_MAX_DY_PX) continue;

      const distance = dx * 4 + dy * 2 + getRectCenterDistance(clientX, clientY, layout.visualRect);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestTarget = { index: layout.index, turnId: layout.turnId, rect: layout.visualRect };
      }
    }

    return bestTarget;
  }, [getCurrentNodeLayouts]);

  const findClosestNodeForClick = useCallback((clientX: number, clientY: number, layouts: RailNodeLayout[]): RailHoverTarget | null => {
    let bestTarget: RailHoverTarget | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const layout of layouts) {
      const distance = pointToRectDistance(clientX, clientY, layout.hitRect);
      if (distance > CLICK_SELECTION_TOLERANCE_PX) continue;

      const centerDistance = getRectCenterDistance(clientX, clientY, layout.visualRect);
      const score = distance * 10 + centerDistance;
      if (score < bestDistance) {
        bestDistance = score;
        bestTarget = { index: layout.index, turnId: layout.turnId, rect: layout.visualRect };
      }
    }

    return bestTarget;
  }, []);

  const isPointInsideMarqueeStartZone = useCallback((clientX: number, clientY: number, layouts: RailNodeLayout[]): boolean => {
    const startBounds = getRailInteractionBounds(
      layouts,
      MARQUEE_START_LEFT_EXPAND_PX,
      MARQUEE_START_RIGHT_EXPAND_PX,
      MARQUEE_START_Y_EXPAND_PX,
    );
    return startBounds ? pointInRect(clientX, clientY, startBounds) : false;
  }, []);

  const getTurnIdsInsideBox = useCallback((box: DragBox, layouts: RailNodeLayout[]): Set<string> => {
    const touchedTurnIds = new Set<string>();

    for (const layout of layouts) {
      if (rectsIntersect(box, layout.hitRect)) touchedTurnIds.add(layout.turnId);
    }

    return touchedTurnIds;
  }, []);

  const updateHoverTargetFromPoint = useCallback((clientX: number, clientY: number) => {
    lastPointerRef.current = { clientX, clientY };
    const target = findRailNodeAtPoint(clientX, clientY);
    if (!target) {
      clearHoverTarget();
      return;
    }

    if (hoveredTurnIdRef.current !== target.turnId) {
      hoveredTurnIdRef.current = target.turnId;
      if (hoverExpandTimeoutRef.current) window.clearTimeout(hoverExpandTimeoutRef.current);
      setHoverExpanded(false);
      hoverExpandTimeoutRef.current = window.setTimeout(() => {
        hoverExpandTimeoutRef.current = null;
        if (hoveredTurnIdRef.current === target.turnId) setHoverExpanded(true);
      }, HOVER_PREVIEW_EXPAND_DELAY_MS);
    }

    setHoveredTurnId(target.turnId);
    setHoveredRect(target.rect);
  }, [clearHoverTarget, findRailNodeAtPoint]);

  useEffect(() => {
    const pointer = lastPointerRef.current;
    if (!pointer || pointerStateRef.current) return undefined;

    const raf = window.requestAnimationFrame(() => {
      updateHoverTargetFromPoint(pointer.clientX, pointer.clientY);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [activeIndex, nodeIdsKey, updateHoverTargetFromPoint]);

  const updateDragBoxFromPoint = useCallback((state: RailPointerState, clientX: number, clientY: number) => {
    const nextBox = buildDragBox(state.startX, state.startY, clientX, clientY);
    const touchedTurnIds = getTurnIdsInsideBox(nextBox, state.nodeLayouts);
    state.touchedTurnIds = touchedTurnIds;

    const dragTarget = findClosestNodeForClick(clientX, clientY, state.nodeLayouts);
    setDragFocusIndex(dragTarget?.index ?? null);
    setMarqueeTouchedTurnIds(new Set(touchedTurnIds));
    setDragBox(nextBox);
  }, [findClosestNodeForClick, getTurnIdsInsideBox]);

  const applyMarqueeToggle = useCallback((state: RailPointerState) => {
    if (state.touchedTurnIds.size === 0) return;
    toggleCopySelectionTurnIds(state.touchedTurnIds, state.initialSelectedIds);
  }, []);

  const applyPendingClickToggle = useCallback((state: RailPointerState, clientX: number, clientY: number) => {
    const target = findClosestNodeForClick(clientX, clientY, state.nodeLayouts);
    if (!target) return;

    toggleCopySelectionTurn(target.turnId);
    setTemporaryFocus(target.index);
  }, [findClosestNodeForClick, setTemporaryFocus]);

  const handleRailPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!selectionSnapshot.selectionMode || event.button !== 0) return;

    const nodeLayouts = getCurrentNodeLayouts();
    if (!isPointInsideMarqueeStartZone(event.clientX, event.clientY, nodeLayouts)) return;

    event.preventDefault();
    event.stopPropagation();

    const target = findClosestNodeForClick(event.clientX, event.clientY, nodeLayouts);
    setDragFocusIndex(target?.index ?? null);
    setDragBox(null);
    setMarqueeTouchedTurnIds(new Set());
    setGlobalSelectLock(true);

    pointerStateRef.current = {
      mode: 'pendingClick',
      pointerId: event.pointerId,
      captureElement: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      initialSelectedIds: new Set(selectionSnapshot.selectedTurnIds),
      nodeLayouts,
      touchedTurnIds: new Set(),
    };
    setInteractionMode('pendingClick');
    updateHoverTargetFromPoint(event.clientX, event.clientY);

    event.currentTarget.setPointerCapture(event.pointerId);
  }, [
    findClosestNodeForClick,
    getCurrentNodeLayouts,
    isPointInsideMarqueeStartZone,
    selectionSnapshot.selectedTurnIds,
    selectionSnapshot.selectionMode,
    updateHoverTargetFromPoint,
  ]);

  const handleTrackedPointerMove = useCallback((
    pointerId: number,
    clientX: number,
    clientY: number,
    cancelBrowserEvent: () => void,
    updateInactiveHover = true,
  ): boolean => {
    const state = pointerStateRef.current;
    if (!state || state.pointerId !== pointerId) {
      if (updateInactiveHover) updateHoverTargetFromPoint(clientX, clientY);
      return false;
    }

    cancelBrowserEvent();
    document.getSelection()?.removeAllRanges();

    const deltaX = clientX - state.startX;
    const deltaY = clientY - state.startY;
    const distance = Math.hypot(deltaX, deltaY);

    if (state.mode === 'pendingClick' && distance < DRAG_SELECTION_THRESHOLD_PX) {
      const target = findClosestNodeForClick(clientX, clientY, state.nodeLayouts);
      setDragFocusIndex(target?.index ?? null);
      updateHoverTargetFromPoint(clientX, clientY);
      return true;
    }

    if (state.mode === 'pendingClick') {
      state.mode = 'draggingMarquee';
      setInteractionMode('draggingMarquee');
      clearHoverTarget();
      suppressFollowupClick();
    }

    updateDragBoxFromPoint(state, clientX, clientY);
    return true;
  }, [
    clearHoverTarget,
    findClosestNodeForClick,
    suppressFollowupClick,
    updateDragBoxFromPoint,
    updateHoverTargetFromPoint,
  ]);

  const handleTrackedPointerUp = useCallback((
    pointerId: number,
    clientX: number,
    clientY: number,
    cancelBrowserEvent: () => void,
    updateInactiveHover = true,
  ): boolean => {
    const state = pointerStateRef.current;
    if (!state || state.pointerId !== pointerId) {
      if (updateInactiveHover) updateHoverTargetFromPoint(clientX, clientY);
      return false;
    }

    cancelBrowserEvent();
    suppressFollowupClick();

    if (state.mode === 'draggingMarquee') {
      updateDragBoxFromPoint(state, clientX, clientY);
      applyMarqueeToggle(state);
    } else {
      applyPendingClickToggle(state, clientX, clientY);
      updateHoverTargetFromPoint(clientX, clientY);
    }

    clearPointerState();
    return true;
  }, [
    applyMarqueeToggle,
    applyPendingClickToggle,
    clearPointerState,
    suppressFollowupClick,
    updateHoverTargetFromPoint,
  ]);

  const handleTrackedPointerCancel = useCallback((pointerId: number, cancelBrowserEvent: () => void): boolean => {
    const state = pointerStateRef.current;
    if (!state || state.pointerId !== pointerId) return false;

    cancelBrowserEvent();
    clearPointerState();
    lastPointerRef.current = null;
    clearHoverTarget();
    return true;
  }, [clearHoverTarget, clearPointerState]);

  const handleRailPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    handleTrackedPointerMove(event.pointerId, event.clientX, event.clientY, () => {
      event.preventDefault();
      event.stopPropagation();
    });
  }, [handleTrackedPointerMove]);

  const handleRailPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    handleTrackedPointerUp(event.pointerId, event.clientX, event.clientY, () => {
      event.preventDefault();
      event.stopPropagation();
    });
  }, [handleTrackedPointerUp]);

  const handleRailPointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    handleTrackedPointerCancel(event.pointerId, () => {
      event.preventDefault();
      event.stopPropagation();
    });
  }, [handleTrackedPointerCancel]);

  useEffect(() => {
    if (interactionMode === 'idle') return undefined;

    const cancelNativePointerEvent = (event: PointerEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const onPointerMove = (event: PointerEvent) => {
      handleTrackedPointerMove(
        event.pointerId,
        event.clientX,
        event.clientY,
        () => cancelNativePointerEvent(event),
        false,
      );
    };

    const onPointerUp = (event: PointerEvent) => {
      handleTrackedPointerUp(
        event.pointerId,
        event.clientX,
        event.clientY,
        () => cancelNativePointerEvent(event),
        false,
      );
    };

    const onPointerCancel = (event: PointerEvent) => {
      handleTrackedPointerCancel(event.pointerId, () => cancelNativePointerEvent(event));
    };

    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerCancel, true);
    return () => {
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerCancel, true);
    };
  }, [
    handleTrackedPointerCancel,
    handleTrackedPointerMove,
    handleTrackedPointerUp,
    interactionMode,
  ]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (pointerStateRef.current) return;
      updateHoverTargetFromPoint(event.clientX, event.clientY);
    };
    const onWindowBlur = () => {
      clearPointerState();
      lastPointerRef.current = null;
      clearHoverTarget();
    };

    document.addEventListener('pointermove', onPointerMove);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      document.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [clearHoverTarget, clearPointerState, updateHoverTargetFromPoint]);

  const hoveredIndex = hoveredTurnId ? nodes.findIndex((node) => node.turnId === hoveredTurnId) : -1;
  const hoverPreview = useMemo<HoverPreview | null>(() => {
    if (!hoveredTurnId || !hoveredRect) return null;

    const index = nodes.findIndex((node) => node.turnId === hoveredTurnId);
    if (index < 0) return null;

    const node = nodes[index];
    const previewLimit = hoverExpanded ? HOVER_PREVIEW_LONG_LIMIT : HOVER_PREVIEW_SHORT_LIMIT;
    const userText =
      formatPreviewText(node.text, previewLimit) ||
      readElementText(previewLimit, node.turn.userCandidate.element, node.turn.userCandidate.wrapper) ||
      EMPTY_PREVIEW_TEXT;
    const showAssistant = previewMode === 'userAssistant';
    const assistantText = showAssistant
      ? (node.turn.assistantCandidate
        ? ((hoverExpanded
            ? readElementText(previewLimit, node.turn.assistantCandidate.element, node.turn.assistantCandidate.wrapper) ||
              formatPreviewText(node.assistantText, previewLimit)
            : formatPreviewText(node.assistantText, previewLimit) ||
              readElementText(previewLimit, node.turn.assistantCandidate.element, node.turn.assistantCandidate.wrapper)) ||
          EMPTY_CLAUDE_PREVIEW_TEXT)
        : NO_CLAUDE_PREVIEW_TEXT)
      : '';
    const userLines = hoverExpanded ? 5 : showAssistant ? 1 : 2;
    const assistantLines = hoverExpanded ? 5 : 1;
    const previewHeight = getHoverPreviewHeight(showAssistant, hoverExpanded);
    const top = clamp(
      hoveredRect.top + hoveredRect.height / 2 - previewHeight / 2,
      12,
      Math.max(12, window.innerHeight - previewHeight - 12),
    );
    const left = Math.max(12, hoveredRect.left - HOVER_PREVIEW_WIDTH_PX - HOVER_PREVIEW_GAP_PX);

    return {
      turnId: hoveredTurnId,
      index,
      userText,
      assistantText,
      showAssistant,
      userLines,
      assistantLines,
      top,
      left,
      expanded: hoverExpanded,
    };
  }, [hoverExpanded, hoveredRect, hoveredTurnId, nodes, previewMode]);

  if (nodes.length === 0) return null;

  const isSelectionMode = selectionSnapshot.selectionMode;
  const density = getRailDensity(nodes.length);
  const interactionFocusIndex = interactionMode === 'draggingMarquee'
    ? dragFocusIndex
    : hoveredIndex >= 0
      ? hoveredIndex
      : temporaryFocusIndex;

  return (
    <>
      <nav
        className="claude-yada-rail"
        aria-label="Claude Yada 对话导航"
        data-selection-mode={isSelectionMode ? 'true' : 'false'}
        data-density={density}
        data-interaction={interactionMode}
      >
        <div
          ref={railHitZoneRef}
          className="claude-yada-rail__hit-zone"
          onPointerDown={handleRailPointerDown}
          onPointerMove={handleRailPointerMove}
          onPointerUp={handleRailPointerUp}
          onPointerCancel={handleRailPointerCancel}
          onPointerLeave={(event) => {
            if (!pointerStateRef.current) {
              updateHoverTargetFromPoint(event.clientX, event.clientY);
            }
          }}
        >
          <div className="claude-yada-rail__list">
            {nodes.map((n, i) => {
              const isActive = i === activeIndex;
              const isSelected = selectionSnapshot.selectedTurnIds.has(n.turnId);
              const proximity = interactionFocusIndex != null ? Math.abs(i - interactionFocusIndex) : null;
              const isMarqueeTouched = marqueeTouchedTurnIds.has(n.turnId);
              const onNodeClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
                if (suppressNextClickRef.current) {
                  event.preventDefault();
                  event.stopPropagation();
                  suppressNextClickRef.current = false;
                  return;
                }

                if (isSelectionMode) {
                  event.preventDefault();
                  event.stopPropagation();
                  return;
                }
                setTemporaryFocus(i);
                scrollToNode(i);
              };

              return (
                <div key={n.id} className="claude-yada-rail__node-wrap">
                  <button
                    ref={(element) => {
                      if (element) nodeButtonRefs.current.set(n.turnId, element);
                      else nodeButtonRefs.current.delete(n.turnId);
                      if (isActive) activeButtonRef.current = element;
                    }}
                    type="button"
                    className="claude-yada-timeline-node claude-yada-rail__item"
                    data-active={isActive ? 'true' : 'false'}
                    data-selected={isSelected ? 'true' : 'false'}
                    data-hovered={hoveredIndex === i ? 'true' : 'false'}
                    data-marquee-touched={isMarqueeTouched ? 'true' : 'false'}
                    data-proximity={proximity != null && proximity <= 2 ? String(proximity) : undefined}
                    aria-label={
                      isSelectionMode
                        ? `${isSelected ? '取消选择' : '选择'}第 ${i + 1} 轮对话`
                        : `跳转到第 ${i + 1} 轮对话`
                    }
                    aria-pressed={isSelectionMode ? isSelected : undefined}
                    onClick={onNodeClick}
                  >
                    <span className="claude-yada-rail__index">{i + 1}</span>
                    <span className="claude-yada-rail__bar" aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </nav>
      {hoverPreview ? createPortal(
        <div
          className="claude-yada-rail__hover-preview"
          role="tooltip"
          data-turn-id={hoverPreview.turnId}
          data-expanded={hoverPreview.expanded ? 'true' : 'false'}
          data-mode={hoverPreview.showAssistant ? 'user-assistant' : 'user'}
          style={{
            top: `${hoverPreview.top}px`,
            left: `${hoverPreview.left}px`,
          }}
        >
          <div className="claude-yada-rail__hover-preview-title">第 {hoverPreview.index + 1} 轮</div>
          <div className="claude-yada-rail__hover-preview-body">
            <div className="claude-yada-rail__hover-preview-row" data-lines={hoverPreview.userLines}>
              <span className="claude-yada-rail__hover-preview-label">User：</span>
              <span className="claude-yada-rail__hover-preview-text">{hoverPreview.userText}</span>
            </div>
            {hoverPreview.showAssistant ? (
              <div className="claude-yada-rail__hover-preview-row claude-yada-rail__hover-preview-claude" data-lines={hoverPreview.assistantLines}>
                <span className="claude-yada-rail__hover-preview-label">Claude：</span>
                <span className="claude-yada-rail__hover-preview-text">{hoverPreview.assistantText}</span>
              </div>
            ) : null}
          </div>
        </div>,
        document.body,
      ) : null}
      {dragBox ? createPortal(
        <div
          className="claude-yada-rail__selection-box"
          style={{
            left: `${dragBox.left}px`,
            top: `${dragBox.top}px`,
            width: `${dragBox.width}px`,
            height: `${dragBox.height}px`,
          }}
        />,
        document.body,
      ) : null}
    </>
  );
}
