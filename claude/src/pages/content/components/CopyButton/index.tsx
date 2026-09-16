/**
 * index.tsx
 * Purpose: Injects copy actions into claude.ai toolbar.
 */

import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CheckSquare, ChevronDown, Copy, Loader2, RefreshCw, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { COPY_BUTTON_ROOT_ID, COPY_BUTTON_ROOT_SELECTOR, EXPORT_BUTTON_ROOT_SELECTOR } from '@src/constants/selectors';
import { EXPORT_SELECTORS, extractConversationMessagesFromCandidates } from '../../services/exportExtractors';
import { formatContent } from '../../services/exportFormatters';
import type { ExportMessage } from '../../services/exportTypes';
import { copyCanonicalConversation } from '../../conversation/copyCanonicalConversation';
import type { SerializationMetrics } from '../../conversation/serializeConversation';
import { conversationStore } from '../../conversation/runtime';
import {
  clearCopySelectionTurns,
  enterCopySelectionMode,
  exitCopySelectionMode,
  getCopySelectionSnapshot,
  getSelectedCopySelectionCandidates,
  getSelectedCopySelectionTurns,
  invertCopySelectionTurns,
  refreshCopySelectionTurns,
  selectAllCopySelectionTurns,
  subscribeCopySelection,
  type CopySelectionSnapshot,
} from '../../services/copySelection';
import {
  getRailPreviewMode,
  subscribeRailPreviewMode,
  toggleRailPreviewMode,
  type RailPreviewMode,
} from '../../services/railPreviewMode';

const INIT_FLAG = '__claudeYadaCopyButtonInit__';
const TOOLBAR_REMOUNT_DELAYS_MS = [0, 300, 800, 1500] as const;
const RAIL_PREVIEW_MODE_STORAGE_KEY = 'claude-yada:rail-preview-mode';

type CopyStatus = 'idle' | 'copying' | 'success' | 'empty' | 'incomplete' | 'error' | 'selecting';
type TFunction = ReturnType<typeof useTranslation>['t'];

const getRouteConversationId = (): string | null => (
  window.location.pathname.match(/\/chat\/([^/?]+)/)?.[1] ?? null
);

const getCopyAllText = (status: CopyStatus, metrics: SerializationMetrics | null, t: TFunction) => {
  if (status === 'copying') return t('copyAll.statusCopying');
  if (status === 'success') return t('copyAll.statusSuccess', {
    turns: metrics?.canonicalTurnCount ?? 0,
    messages: metrics?.serializedVisibleMessageCount ?? 0,
  });
  if (status === 'empty') return t('copyAll.statusEmpty');
  if (status === 'incomplete') return t('copyAll.statusIncomplete');
  if (status === 'error') return t('copyAll.statusFailed');
  return t('copyAll.buttonLabel');
};

const getCopySelectedText = (status: CopyStatus, count: number | null, t: TFunction) => {
  if (status === 'copying') return t('copySelected.statusCopying');
  if (status === 'success') return t('copySelected.statusSuccess', { count: count ?? 0 });
  if (status === 'empty') return t('copySelected.statusEmpty');
  if (status === 'error') return t('copySelected.statusFailed');
  return t('copySelected.copyButton');
};

const isRailPreviewMode = (value: string | null): value is RailPreviewMode => (
  value === 'user' || value === 'userAssistant'
);

const readPersistedRailPreviewMode = (): RailPreviewMode | null => {
  try {
    const value = window.localStorage.getItem(RAIL_PREVIEW_MODE_STORAGE_KEY);
    return isRailPreviewMode(value) ? value : null;
  } catch {
    return null;
  }
};

const persistRailPreviewMode = (mode: RailPreviewMode) => {
  try {
    window.localStorage.setItem(RAIL_PREVIEW_MODE_STORAGE_KEY, mode);
  } catch {
    // Ignore storage failures; the in-memory toggle still works for this tab.
  }
};

const formatSelectedMarkdown = (messages: ExportMessage[]): string => {
  return formatContent(messages, 'markdown').replace(/^# Assistant$/gm, '# Claude').trim();
};

const ToolbarButton = ({
  children,
  onClick,
  disabled,
  ariaLabel,
  ariaExpanded,
  ariaHasPopup,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
  ariaExpanded?: boolean;
  ariaHasPopup?: 'menu';
}) => (
  <button
    type="button"
    className="inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-lg border border-[#d9d2c6] bg-[#f6f2ea] px-3 text-[12px] font-medium text-[#374151] hover:bg-[#efe9de] active:scale-[0.98] disabled:cursor-wait disabled:opacity-70"
    aria-label={ariaLabel}
    aria-expanded={ariaExpanded}
    aria-haspopup={ariaHasPopup}
    onClick={onClick}
    disabled={disabled}
  >
    {children}
  </button>
);

const MenuButton = ({
  children,
  onClick,
  disabled,
  variant = 'default',
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'primary' | 'quiet';
}) => (
  <button
    type="button"
    role="menuitem"
    className={`claude-yada-copy-menu-item flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] font-medium text-[#374151] hover:bg-[#f7f1ea] disabled:cursor-not-allowed disabled:opacity-55 ${variant === 'primary' ? 'claude-yada-copy-menu-item-primary' : ''} ${variant === 'quiet' ? 'claude-yada-copy-menu-item-quiet' : ''}`}
    onClick={onClick}
    disabled={disabled}
  >
    {children}
  </button>
);

const CopyButton = () => {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [copyAllStatus, setCopyAllStatus] = useState<CopyStatus>('idle');
  const [copyAllMetrics, setCopyAllMetrics] = useState<SerializationMetrics | null>(null);
  const [copySelectedStatus, setCopySelectedStatus] = useState<CopyStatus>('idle');
  const [copySelectedCopiedCount, setCopySelectedCopiedCount] = useState<number | null>(null);
  const [previewMode, setPreviewMode] = useState<RailPreviewMode>(() => getRailPreviewMode());
  const [previewToggleHover, setPreviewToggleHover] = useState(false);
  const [previewFeedback, setPreviewFeedback] = useState<RailPreviewMode | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectionSnapshot, setSelectionSnapshot] = useState<CopySelectionSnapshot>(() => getCopySelectionSnapshot());
  const previewFeedbackTimerRef = useRef<number | null>(null);

  useEffect(() => subscribeCopySelection(setSelectionSnapshot), []);
  useEffect(() => subscribeRailPreviewMode(setPreviewMode), []);

  useEffect(() => {
    const storedMode = readPersistedRailPreviewMode();
    if (!storedMode || storedMode === getRailPreviewMode()) return;
    toggleRailPreviewMode();
  }, []);

  const selectionMode = selectionSnapshot.selectionMode;

  useEffect(() => () => {
    if (previewFeedbackTimerRef.current) window.clearTimeout(previewFeedbackTimerRef.current);
  }, []);

  useEffect(() => {
    if (copyAllStatus === 'idle' || copyAllStatus === 'copying' || copyAllStatus === 'selecting') return;
    const timer = window.setTimeout(() => {
      setCopyAllStatus('idle');
      setCopyAllMetrics(null);
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [copyAllStatus]);

  useEffect(() => {
    if (copySelectedStatus === 'idle' || copySelectedStatus === 'copying' || copySelectedStatus === 'selecting') return;
    const timer = window.setTimeout(() => {
      setCopySelectedStatus('idle');
      setCopySelectedCopiedCount(null);
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [copySelectedStatus]);

  useEffect(() => {
    if (selectionMode) setMenuOpen(true);
  }, [selectionMode]);

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      const menu = menuRef.current;
      if (!menu) return;
      if (event.target instanceof Node && menu.contains(event.target)) return;
      if (selectionMode) return;
      setMenuOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (selectionMode) return;
      setMenuOpen(false);
    };

    window.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen, selectionMode]);

  const resetSelection = useCallback(() => {
    exitCopySelectionMode();
    setCopySelectedStatus('idle');
    setCopySelectedCopiedCount(null);
    setMenuOpen(false);
  }, []);

  useEffect(() => {
    const onRouteChange = () => resetSelection();
    window.addEventListener('claude-nexus:locationchange', onRouteChange);
    window.addEventListener('cc:urlchange', onRouteChange);
    window.addEventListener('popstate', onRouteChange);
    return () => {
      window.removeEventListener('claude-nexus:locationchange', onRouteChange);
      window.removeEventListener('cc:urlchange', onRouteChange);
      window.removeEventListener('popstate', onRouteChange);
    };
  }, [resetSelection]);

  const copyAll = useCallback(async () => {
    if (copyAllStatus === 'copying' || copySelectedStatus === 'copying') return;

    setCopyAllStatus('copying');
    setCopyAllMetrics(null);

    const initialState = conversationStore.getState();
    const initialSnapshot = initialState.snapshot;
    const isCurrentSnapshot = () => {
      const currentState = conversationStore.getState();
      return (
        initialSnapshot !== null &&
        currentState.status === 'ready' &&
        currentState.snapshot === initialSnapshot &&
        initialSnapshot.conversationId === getRouteConversationId()
      );
    };
    const result = await copyCanonicalConversation(
      initialState,
      (markdown) => navigator.clipboard.writeText(markdown),
      { isCurrentSnapshot },
    );
    if (result.status === 'copied' && isCurrentSnapshot()) {
      setCopyAllMetrics(result.metrics ?? null);
      setCopyAllStatus('success');
      return;
    }
    if (result.status === 'unavailable' || result.status === 'invalid' || result.status === 'stale') {
      setCopyAllStatus('incomplete');
      return;
    }
    setCopyAllStatus('error');
  }, [copyAllStatus, copySelectedStatus]);

  const enterSelectionMode = useCallback(() => {
    refreshCopySelectionTurns();
    enterCopySelectionMode();
    setCopySelectedStatus('idle');
    setCopySelectedCopiedCount(null);
    setMenuOpen(true);
  }, []);

  const selectAll = useCallback(() => {
    selectAllCopySelectionTurns();
    setCopySelectedStatus('idle');
    setCopySelectedCopiedCount(null);
  }, []);

  const clearAll = useCallback(() => {
    clearCopySelectionTurns();
    setCopySelectedStatus('idle');
    setCopySelectedCopiedCount(null);
  }, []);

  const invertSelection = useCallback(() => {
    invertCopySelectionTurns();
    setCopySelectedStatus('idle');
    setCopySelectedCopiedCount(null);
  }, []);

  const togglePreviewMode = useCallback(() => {
    const nextMode: RailPreviewMode = previewMode === 'user' ? 'userAssistant' : 'user';
    toggleRailPreviewMode();
    persistRailPreviewMode(nextMode);
    setPreviewToggleHover(false);
    setPreviewFeedback(nextMode);
    if (previewFeedbackTimerRef.current) window.clearTimeout(previewFeedbackTimerRef.current);
    previewFeedbackTimerRef.current = window.setTimeout(() => {
      previewFeedbackTimerRef.current = null;
      setPreviewFeedback(null);
    }, 1800);
  }, [previewMode]);

  const copySelected = useCallback(async () => {
    if (copyAllStatus === 'copying' || copySelectedStatus === 'copying') return;

    refreshCopySelectionTurns();
    const selectedTurns = getSelectedCopySelectionTurns();
    const candidates = getSelectedCopySelectionCandidates();
    if (selectedTurns.length === 0 || candidates.length === 0) {
      setCopySelectedStatus('empty');
      setCopySelectedCopiedCount(null);
      return;
    }

    setCopySelectedStatus('copying');
    setCopySelectedCopiedCount(null);

    try {
      const extracted = await extractConversationMessagesFromCandidates(candidates);
      const markdown = formatSelectedMarkdown(extracted.messages);
      if (!markdown) {
        setCopySelectedStatus('empty');
        return;
      }

      await navigator.clipboard.writeText(markdown);
      setCopySelectedCopiedCount(selectedTurns.length);
      setCopySelectedStatus('success');
    } catch (error) {
      console.error('[Claude Yada] Failed to copy selected messages', error);
      setCopySelectedStatus('error');
    }
  }, [copyAllStatus, copySelectedStatus]);

  const isBusy = copyAllStatus === 'copying' || copySelectedStatus === 'copying';
  const isCopyAllSuccess = copyAllStatus === 'success';
  const isCopySelectedSuccess = copySelectedStatus === 'success';
  const selectedCount = selectionSnapshot.selectedTurnIds.size;
  const turnCount = selectionSnapshot.turns.length;
  const selectionButtonLabel = selectionMode
    ? t('copySelected.activeButtonLabel', { count: selectedCount, total: turnCount })
    : t('copySelected.buttonLabel');
  const showPreviewHoverTip = previewToggleHover && previewFeedback === null;
  const showPreviewFeedback = previewFeedback !== null;

  return (
    <div className="claude-yada-copy-controls inline-flex items-center gap-2">
      <div className="claude-yada-preview-toggle-wrap">
        <button
          type="button"
          className="claude-yada-preview-toggle"
          data-active={previewMode === 'userAssistant' ? 'true' : 'false'}
          aria-label={previewMode === 'userAssistant' ? t('railPreview.userOnlyAria') : t('railPreview.userAssistantAria')}
          onPointerEnter={() => setPreviewToggleHover(true)}
          onPointerLeave={() => setPreviewToggleHover(false)}
          onBlur={() => setPreviewToggleHover(false)}
          onClick={togglePreviewMode}
        />
        <div
          className="claude-yada-preview-toggle-tooltip"
          data-visible={showPreviewHoverTip ? 'true' : 'false'}
          data-feedback="false"
          role="tooltip"
          aria-live="off"
        >
          {previewMode === 'userAssistant' ? (
            <>
              <span>{t('railPreview.currentUserAssistant')}</span>
              <span>{t('railPreview.switchToUserOnly')}</span>
            </>
          ) : (
            <>
              <span>{t('railPreview.currentUserOnly')}</span>
              <span>{t('railPreview.switchToUserAssistant')}</span>
            </>
          )}
        </div>
        <div
          className="claude-yada-preview-toggle-tooltip claude-yada-preview-toggle-feedback"
          data-visible={showPreviewFeedback ? 'true' : 'false'}
          data-feedback="true"
          role="status"
          aria-live="polite"
        >
          {previewFeedback ? (
            <span>{previewFeedback === 'userAssistant' ? t('railPreview.feedbackUserAssistant') : t('railPreview.feedbackUserOnly')}</span>
          ) : null}
        </div>
      </div>

      <ToolbarButton ariaLabel={t('copyAll.buttonAria')} onClick={() => void copyAll()} disabled={isBusy}>
        {copyAllStatus === 'copying' ? (
          <Loader2 className="h-4 w-4 animate-spin text-[#6b7280]" aria-hidden="true" />
        ) : isCopyAllSuccess ? (
          <Check className="h-4 w-4 text-[#166534]" aria-hidden="true" />
        ) : (
          <Copy className="h-4 w-4 text-[#6b7280]" aria-hidden="true" />
        )}
        {getCopyAllText(copyAllStatus, copyAllMetrics, t)}
      </ToolbarButton>

      <div ref={menuRef} className="relative">
        <ToolbarButton
          ariaLabel={t('copySelected.buttonAria')}
          ariaExpanded={menuOpen}
          ariaHasPopup="menu"
          onClick={() => {
            if (selectionMode) {
              setMenuOpen(true);
              return;
            }
            setMenuOpen((open) => !open);
          }}
        >
          <CheckSquare className="h-4 w-4 text-[#6b7280]" aria-hidden="true" />
          {selectionButtonLabel}
          <ChevronDown className={`h-3.5 w-3.5 text-[#6b7280] transition-transform ${menuOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
        </ToolbarButton>

        {menuOpen ? (
          <div
            className="claude-yada-copy-menu absolute right-0 top-full z-50 mt-2 w-[13.5rem] rounded-xl border border-[#e5e0d8] bg-white p-1.5 text-[#374151] shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
            role="menu"
          >
            {!selectionMode ? (
              <MenuButton onClick={enterSelectionMode}>
                <CheckSquare className="h-4 w-4 text-[#6b7280]" aria-hidden="true" />
                {t('copySelected.enterMode')}
              </MenuButton>
            ) : (
              <>
                <div className="claude-yada-copy-menu-status mx-1 mb-1 rounded-lg border border-[#f0e4da] bg-[#fbf7f2] px-3 py-2 text-[12px] font-medium text-[#8a5a44]">
                  {t('copySelected.selectedCount', { count: selectedCount, total: turnCount })}
                </div>

                <MenuButton onClick={() => void copySelected()} disabled={isBusy || selectedCount === 0} variant="primary">
                  {copySelectedStatus === 'copying' ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : isCopySelectedSuccess ? (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  )}
                  {getCopySelectedText(copySelectedStatus, copySelectedCopiedCount, t)}
                </MenuButton>

                <MenuButton onClick={invertSelection} disabled={isBusy || turnCount === 0}>
                  <RefreshCw className="h-4 w-4 text-[#6b7280]" aria-hidden="true" />
                  {t('copySelected.invert')}
                </MenuButton>

                <MenuButton onClick={selectAll} disabled={isBusy || turnCount === 0}>
                  <CheckSquare className="h-4 w-4 text-[#6b7280]" aria-hidden="true" />
                  {t('copySelected.selectAll')}
                </MenuButton>

                <MenuButton onClick={clearAll} disabled={isBusy}>
                  <Square className="h-4 w-4 text-[#6b7280]" aria-hidden="true" />
                  {t('copySelected.clearAll')}
                </MenuButton>

                <MenuButton onClick={resetSelection} disabled={isBusy} variant="quiet">
                  <X className="h-4 w-4 text-[#6b7280]" aria-hidden="true" />
                  {t('copySelected.exit')}
                </MenuButton>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};

const mountIntoToolbar = (): boolean => {
  const container =
    document.querySelector(EXPORT_SELECTORS.toolbarActions) ||
    document.querySelector(EXPORT_BUTTON_ROOT_SELECTOR)?.parentElement;
  if (!(container instanceof HTMLElement)) return false;

  const existing = container.querySelector(COPY_BUTTON_ROOT_SELECTOR);
  if (existing instanceof HTMLElement) {
    existing.classList.add('claude-yada-copy-button-host');
    return true;
  }

  const host = document.createElement('div');
  host.id = COPY_BUTTON_ROOT_ID;
  host.className = 'claude-yada-copy-button-host';

  const exportHost = container.querySelector(EXPORT_BUTTON_ROOT_SELECTOR);
  if (exportHost instanceof HTMLElement) {
    exportHost.before(host);
  } else {
    container.appendChild(host);
  }

  createRoot(host).render(<CopyButton />);
  return true;
};

const scheduleToolbarMountAttempts = () => {
  for (const delay of TOOLBAR_REMOUNT_DELAYS_MS) {
    window.setTimeout(() => mountIntoToolbar(), delay);
  }
};

export const initCopyButtonInjection = (): void => {
  const w = window as unknown as Record<string, unknown>;
  if (w[INIT_FLAG]) return;
  w[INIT_FLAG] = true;

  scheduleToolbarMountAttempts();

  const observer = new MutationObserver(() => {
    mountIntoToolbar();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('claude-nexus:locationchange', scheduleToolbarMountAttempts);
  window.addEventListener('cc:urlchange', scheduleToolbarMountAttempts);
  window.addEventListener('popstate', scheduleToolbarMountAttempts);
};
