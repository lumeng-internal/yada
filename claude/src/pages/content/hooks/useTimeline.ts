/**
 * Tracks claude.ai message nodes and provides timeline navigation state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AUTOSCROLL_CONTAINER_SELECTOR,
  CONVERSATION_LINK_SELECTOR,
  SIDEBAR_FALLBACK_CONTAINER_SELECTOR,
  SIDEBAR_NAV_SELECTOR,
} from '@src/constants/selectors';
import { getConversationTurns, type ConversationTurn } from '../services/conversationTurns';
import { exitCopySelectionMode, setCopySelectionTurns } from '../services/copySelection';

type TimelineNode = {
  id: string;
  turnId: string;
  turn: ConversationTurn;
  element: HTMLElement;
  index: number;
  text: string;
  assistantText: string;
};

type TimelineApi = {
  nodes: TimelineNode[];
  activeIndex: number;
  scrollToNode: (index: number) => void;
};

const SCROLL_OFFSET_PX = 80;
const CHAT_POLL_INTERVAL_MS = 500;
const SIDEBAR_RESYNC_DEBOUNCE_MS = 800;
const ROUTE_SETTLE_DELAY_MS = 250;
const ROUTE_REFRESH_DELAYS_MS = [300, 800, 1500, 2500] as const;

const getChatId = (): string => window.location.pathname.split('/chat/')?.[1] ?? '';

const findSidebarContainer = (): HTMLElement | null => {
  const nav = document.querySelector(SIDEBAR_NAV_SELECTOR);
  if (nav instanceof HTMLElement) return nav;
  const fallback = document.querySelector(SIDEBAR_FALLBACK_CONTAINER_SELECTOR);
  return fallback instanceof HTMLElement ? fallback : null;
};

const mutationHasChatLink = (mutations: MutationRecord[]): boolean => {
  for (const m of mutations) {
    for (const node of Array.from(m.addedNodes)) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.matches(CONVERSATION_LINK_SELECTOR)) return true;
      if (node.querySelector(CONVERSATION_LINK_SELECTOR)) return true;
    }
    for (const node of Array.from(m.removedNodes)) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.matches(CONVERSATION_LINK_SELECTOR)) return true;
      if (node.querySelector(CONVERSATION_LINK_SELECTOR)) return true;
    }
  }
  return false;
};

const findScrollContainer = (): HTMLElement | null => {
  const el = document.querySelector(AUTOSCROLL_CONTAINER_SELECTOR);
  return el instanceof HTMLElement ? el : null;
};

const buildNodes = (scrollContainer: HTMLElement): TimelineNode[] => {
  const turns = getConversationTurns(scrollContainer);
  return turns.map((turn, index) => ({
    id: turn.id,
    turnId: turn.id,
    turn,
    element: turn.scrollTargetElement,
    index,
    text: turn.userPreviewText,
    assistantText: turn.assistantPreviewText,
  }));
};

const computeActiveIndex = (nodes: TimelineNode[]): number => {
  if (nodes.length === 0) return -1;
  let active = -1;
  for (let i = 0; i < nodes.length; i += 1) {
    const top = nodes[i].element.getBoundingClientRect().top;
    if (top < SCROLL_OFFSET_PX) active = i;
  }
  return Math.max(0, active);
};

export const useTimeline = (): TimelineApi => {
  const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(null);
  const [nodes, setNodes] = useState<TimelineNode[]>([]);
  const nodesRef = useRef(nodes);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const routeRefreshTimeoutsRef = useRef<number[]>([]);
  const sidebarResyncTimeoutRef = useRef<number | null>(null);
  const currentChatIdRef = useRef(getChatId());
  const routeChangeStartedAtRef = useRef(0);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const clearRouteRefreshTimeouts = useCallback(() => {
    routeRefreshTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    routeRefreshTimeoutsRef.current = [];
  }, []);

  const setTimelineNodes = useCallback((nextNodes: TimelineNode[]) => {
    nodesRef.current = nextNodes;
    setNodes(nextNodes);
    setCopySelectionTurns(nextNodes.map((node) => node.turn));
    setActiveIndex(computeActiveIndex(nextNodes));
  }, []);

  const clearTimelineState = useCallback(() => {
    nodesRef.current = [];
    setNodes([]);
    setCopySelectionTurns([]);
    setActiveIndex(-1);
  }, []);

  const refresh = useCallback((force = false): void => {
    if (!force && Date.now() - routeChangeStartedAtRef.current < ROUTE_SETTLE_DELAY_MS) return;

    const container = findScrollContainer();
    setScrollContainer(container);
    if (!container) {
      clearTimelineState();
      return;
    }

    const nextNodes = buildNodes(container);
    setTimelineNodes(nextNodes);
  }, [clearTimelineState, setTimelineNodes]);

  const scheduleRouteRefreshes = useCallback(() => {
    clearRouteRefreshTimeouts();
    const chatIdAtSchedule = currentChatIdRef.current;

    routeRefreshTimeoutsRef.current = ROUTE_REFRESH_DELAYS_MS.map((delay) =>
      window.setTimeout(() => {
        if (currentChatIdRef.current !== chatIdAtSchedule) return;
        refresh(true);
      }, delay),
    );
  }, [clearRouteRefreshTimeouts, refresh]);

  const handleConversationChange = useCallback(() => {
    currentChatIdRef.current = getChatId();
    routeChangeStartedAtRef.current = Date.now();
    clearTimelineState();
    exitCopySelectionMode();
    scheduleRouteRefreshes();
  }, [clearTimelineState, scheduleRouteRefreshes]);

  useEffect(() => {
    let currentChatId = currentChatIdRef.current;

    const timer = window.setInterval(() => {
      const newChatId = getChatId();
      if (newChatId === currentChatId) return;
      currentChatId = newChatId;
      handleConversationChange();
    }, CHAT_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
      clearRouteRefreshTimeouts();
    };
  }, [clearRouteRefreshTimeouts, handleConversationChange]);

  useEffect(() => {
    window.addEventListener('claude-nexus:locationchange', handleConversationChange);
    window.addEventListener('cc:urlchange', handleConversationChange);
    window.addEventListener('popstate', handleConversationChange);

    return () => {
      window.removeEventListener('claude-nexus:locationchange', handleConversationChange);
      window.removeEventListener('cc:urlchange', handleConversationChange);
      window.removeEventListener('popstate', handleConversationChange);
    };
  }, [handleConversationChange]);

  useEffect(() => {
    const sidebar = findSidebarContainer();
    if (!sidebar) return;

    const scheduleResync = () => {
      if (sidebarResyncTimeoutRef.current) window.clearTimeout(sidebarResyncTimeoutRef.current);
      sidebarResyncTimeoutRef.current = window.setTimeout(() => {
        sidebarResyncTimeoutRef.current = null;
        refresh();
      }, SIDEBAR_RESYNC_DEBOUNCE_MS);
    };

    const mo = new MutationObserver((mutations) => {
      if (!mutationHasChatLink(mutations)) return;
      scheduleResync();
    });

    mo.observe(sidebar, { childList: true, subtree: true });

    return () => {
      mo.disconnect();
      if (sidebarResyncTimeoutRef.current) window.clearTimeout(sidebarResyncTimeoutRef.current);
    };
  }, [refresh]);

  useEffect(() => {
    const initial = findScrollContainer();
    if (initial) setScrollContainer(initial);

    if (initial) return;

    const mo = new MutationObserver(() => {
      const next = findScrollContainer();
      if (!next) return;
      setScrollContainer(next);
      mo.disconnect();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    const el = scrollContainer;
    if (!el) return;

    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        if (Date.now() - routeChangeStartedAtRef.current < ROUTE_SETTLE_DELAY_MS) return;
        const nextNodes = buildNodes(el);
        setTimelineNodes(nextNodes);
      });
    };

    schedule();
    const mo = new MutationObserver(schedule);
    mo.observe(el, { childList: true, subtree: true });

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      mo.disconnect();
    };
  }, [scrollContainer, setTimelineNodes]);

  useEffect(() => {
    const el = scrollContainer;
    if (!el) return;

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        setActiveIndex(computeActiveIndex(nodesRef.current));
      });
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    return () => {
      el.removeEventListener('scroll', onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [scrollContainer]);

  const scrollToNode = useMemo(() => {
    return (index: number) => {
      const el = scrollContainer;
      const node = nodesRef.current[index];
      if (!el || !node) return;

      const containerRect = el.getBoundingClientRect();
      const nodeRect = node.element.getBoundingClientRect();
      const targetTop = nodeRect.top - containerRect.top + el.scrollTop - SCROLL_OFFSET_PX;
      el.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
    };
  }, [scrollContainer]);

  return { nodes, activeIndex, scrollToNode };
};
