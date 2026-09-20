# v1.0.5 Core Issues Review

## Scope

v1.0.5 is a core interaction and data trustworthiness repair. It is not a UI polish pass and does not expand product scope beyond the current ChatGPT conversation rail, Markdown copy, selective copy, hover preview, and placeholder-only attachment summaries.

`reference/` remains read-only. Reference projects are used only to understand accepted interaction and data patterns:

- `reference/Claude-Yada-v1.0.0`: compact rail index reveal, selected-dot affordance, persistent selection menu, and macOS-style selection behavior.
- `reference/AI-MarkDone-main`: ChatGPT rail/controller patterns, route/refresh discipline, active-position calculation, and debug-oriented lifecycle.
- `reference/chatgpt-exporter-master`: current conversation API mapping, `current_node` branch walk, message filtering, and multimodal content handling.
- `reference/ophel-main`: ChatGPT DOM/scroll container heuristics and active/scroll helpers.

## Categories

- UI: issues 1, 4, 9, 10, 11.
- Attachment recognition: issues 2, 3, 4.
- Selection mode: issues 5, 6, 7, 8, 11.
- Long-conversation virtualization and navigation: issue 12.
- Turns source and data stability: issue 13.
- Active turn stability: issue 14.
- Versioning: version rule and v1.0.5 bump.

## Current Code To Keep

- MV3 + Vite + TypeScript shell.
- API-first fetch path in `src/conversation/fetchConversation.ts`.
- Current-node branch normalization in `src/conversation/normalizeConversation.ts`, with refinements.
- Shadow DOM host split for toolbar, rail, preview, and selection menu.
- Existing selection store shape in `src/rail/selection.ts`, with interaction fixes.
- Existing preview-mode persistence helper in `src/utils/storage.ts`.

## Current Code To Change

- `src/conversation/attachmentSummary.ts`: attachment classification must be mutually exclusive and deduped before formatting.
- `src/conversation/domCollector.ts`: DOM fallback must not merge text and attachments on one line and must avoid broad file selectors.
- `src/export/markdownFormatter.ts`: Markdown must preserve attachment-first, text-second formatting.
- `src/rail/rail.ts`: rail hit testing, index reveal, click selection, lasso, debug, and jump flow need repair.
- `src/rail/active.ts`: active line and progressive virtualized jump need stronger primitives.
- `src/content.ts`: snapshot source priority, stable turn cache, anchor cache, and debug snapshot need repair.
- `src/ui/toolbar.ts` and `src/ui/menu.ts`: copy states, selection-button second click, dot tooltip, and selection copy feedback need repair.
- Docs and version files must be updated to v1.0.5 and semver rules.

## Issue Review

### 1. Rail needs visible turn numbers

Root cause: `src/rail/rail.ts` already creates `.mark-index`, but reveal rules are too dependent on current hover/active/selected rendering and do not account for selection-mode readability. The total/index data is recreated from whatever `turns` array is currently supplied, so if the array source drifts, the visible number also drifts.

Fix files:

- `src/rail/rail.ts`: keep number at `index + 1`, reveal on hover/active/selected and lightly in selection mode, widen the grid enough to avoid clipping.
- `src/content.ts`: stabilize `turns` before rail render so index values do not follow DOM virtualization drift.

### 2. Test message types are not fully covered

Root cause: current docs cover image/file/paste generally but do not enumerate pure text, pure image, pure file, pure paste, and mixed text+attachment cases. Current code uses `paste` internally while the requested category is `pasted`, and it does not expose a clear `text+image`, `text+file`, `text+pasted`, `empty` matrix.

Fix files:

- `src/conversation/types.ts`: use explicit attachment kind naming.
- `src/conversation/attachmentSummary.ts`: add clear formatting/classification helpers.
- `docs/TEST_CHECKLIST.md`: add the full eight-case attachment checklist.

### 3. Pure image is misclassified as image plus file

Root cause: `extractDomAttachments()` first collects `img`, then runs broad file selectors including `data-testid*="file"` and `aria-label*="attachment"` over the same card/container. `findFilename()` also includes image extensions, so image filenames can become file attachments. `dedupeAttachments()` does not dedupe image/file candidates by src, alt, filename, href, or test id, and images are always allowed through.

Fix files:

- `src/conversation/attachmentSummary.ts`: classify candidates first, image before file, exclude image extensions from file detection, and dedupe by node/url/filename/test id/href.
- `src/conversation/domCollector.ts`: pass the correct message/turn root and avoid attachment text leaking into message text.

### 4. Text plus attachment ordering and line breaks are wrong

Root cause: `combineTextAndAttachments()` currently returns `text · summary`, which forces mixed content onto one line and puts text before attachments. Preview uses the same flattened markdown, so hover preview inherits the wrong order.

Fix files:

- `src/conversation/attachmentSummary.ts`: return attachment summary first and user text on the next line.
- `src/conversation/domCollector.ts`: remove attachment cards/images from cloned text before extracting markdown.
- `src/export/markdownFormatter.ts`: keep line breaks and avoid collapsing attachment placeholders.
- `src/rail/preview.ts`: normalize preview without destroying intended attachment/text line breaks.

### 5. Selection-copy second click cannot exit selection mode

Root cause: `YadaToolbar` only enters selection mode on the selection-copy button; exiting is available only in the menu. The active button label still includes a dropdown marker and has no direct exit action.

Fix files:

- `src/ui/toolbar.ts`: when selection is active, second click calls `yadaSelectionStore.exit()` and clears selection.
- `src/ui/toolbar.ts`: label must be `选择中 · 已选 N 轮` while active.

### 6. Hover hit zone is too wide

Root cause: `YadaRail.findNearestMark()` uses the full `.mark` rect plus padding. `.mark` is intentionally wide to hold the number and bar, so pointer movement far left of the short bar can trigger preview. The `.zone` and `.marks` containers also accept pointer events across a broad rail width.

Fix files:

- `src/rail/rail.ts`: calculate distances from `.mark-bar` rect; use `hoverHitRadiusX <= 32`, `clickHitRadiusX <= 48`, and `selectionStartRadiusX <= 56`.
- `src/rail/preview.ts`: keep preview bridge small and do not expand hover search into body text.

### 7. Lasso selection cannot be drawn

Root cause: selection state is only updated in `handlePointerMove()` while a `dragState` exists, but `dragState` is blocked when started on a mark and the broad mark/list hit area makes many starts look like mark starts. Pointer capture is set on the zone, but lasso eligibility is not based on rail-bar proximity and does not give body text selection a clear suppression path.

Fix files:

- `src/rail/rail.ts`: allow lasso only from rail-near empty space, movement over 5px, fixed dashed rectangle, pointer capture release, and text-selection suppression.
- `src/styles.ts` or rail shadow CSS: add temporary global/user-select suppression if needed.
- `src/rail/selection.ts`: keep `applyBoxToggle()` semantics because they already support canceling selected nodes.

### 8. Single-click selection has no response

Root cause: single-click selection is implemented on each mark, but the lasso pointer handlers can suppress or reroute clicks, and the hit test is based on the full mark instead of the bar. The selected visual state exists but depends on the store update reaching `renderSelectionState()`.

Fix files:

- `src/rail/rail.ts`: click selection must use bar-centered hit testing, treat movement under 5px as click, avoid navigation while selection mode is active, and update selected state immediately through the store.
- `src/ui/menu.ts`: selected count rendering must update after each toggle.

### 9. Preview-mode dot tooltip and feedback are not human-readable enough

Root cause: tooltip strings currently say `当前预览：User only` / `当前预览：User + ChatGPT`, and click feedback says `只预览 User only`, which does not match the requested human-readable state-and-next-action language. Tooltip and feedback share the toolbar status area too closely.

Fix files:

- `src/ui/toolbar.ts`: update tooltip and feedback strings exactly to requested Chinese wording.
- `src/utils/storage.ts`: keep persistent mode storage; no new storage mechanism required.

### 10. Copy-all feedback is incomplete

Root cause: copy-all has a hidden status chip, but the button label itself does not enter pending/success/fail states, pending styling is weak, and the no-content string is not the requested `没有可复制内容`.

Fix files:

- `src/ui/toolbar.ts`: maintain copy-all button state machine: idle, pending, success, error, empty.
- `src/export/clipboard.ts`: keep clipboard fallback; only surface errors through toolbar state.
- `src/export/markdownFormatter.ts`: keep output deterministic.

### 11. Copy-selected feedback is incomplete

Root cause: selected-copy feedback is only toolbar status; menu top/status and selection button label do not clearly reflect pending/success/failure, and no-selection handling only disables the copy button without an explicit message.

Fix files:

- `src/ui/menu.ts`: add menu feedback/status row and disabled/no-selection state text.
- `src/ui/toolbar.ts`: pass selected-copy state to the menu and/or selection button.
- `src/rail/selection.ts`: no structural change expected.

### 12. 100+ turn history jump fails under virtualization

Root cause: `scrollToTurn()` only works when `anchorElement` exists and is connected. API turns can represent the full conversation while ChatGPT renders only a window of DOM nodes, so historical target anchors are missing. There is no anchor cache, no estimated scroll, no wait/recollect loop, and no failure feedback.

Fix files:

- `src/rail/active.ts`: add direct precise scroll plus `progressiveScrollToTurn()` with estimate, wait, anchor recollect, and bounded attempts.
- `src/conversation/domCollector.ts`: expose anchor collection/binding in a way that can refresh during jump without replacing full turns.
- `src/content.ts`: provide a rail callback to refresh anchors while preserving stable API turns.
- `src/rail/rail.ts`: make click navigation async, show failure feedback, and debug jump attempts.

### 13. Turns count drifts from 23 to 27

Root cause: `loadCurrentConversationSnapshot()` returns either API or DOM, and `applySnapshot()` blindly replaces `this.turns`. During API failure, loading, mutation refresh, or partial DOM collection, a DOM partial snapshot can overwrite a previously stable full API snapshot. `YadaConversationSource` only has `"api"`/`"dom"` and no cached full source state or priority.

Fix files:

- `src/conversation/types.ts`: expand snapshot source metadata to `api-full`, `cached-api-full`, and `dom-partial`.
- `src/conversation/normalizeConversation.ts`: expose API full and DOM partial lengths.
- `src/content.ts`: maintain stable per-conversation API cache and source priority `api-full > cached-api-full > dom-partial`; DOM partial may update anchors but must not replace full API turns.
- `src/rail/rail.ts`: render only stable turns.

### 14. Active turn detection switches too early

Root cause: `getActiveTurnIndex()` uses a line at 38% viewport height and simply stores the last connected anchor whose top is above that line. It does not use an explicit reading anchor line, does not expose debug reasons, and does not add hysteresis/debounce beyond scroll throttling. Active can only use currently connected anchors, but the result is not clearly tied back to stable turn indexes.

Fix files:

- `src/rail/active.ts`: use `viewportTop + min(viewportHeight * 0.28, 260px)`, choose closest `top <= activeLine`, else nearest visible, and return debug details.
- `src/content.ts` and `src/rail/rail.ts`: preserve active independently from total turns and include debug fields.

## Version Rule

The project currently reports `0.1.0` in both `package.json` and `manifest.json`, while published/manual testing history is already in the `1.0.x` line. For v1.0.5 this must be corrected to `1.0.5`, and `docs/FINAL_REPORT.md` must explicitly state that this is a historical version-number correction.

Semver rule to document:

- PATCH: each small change, bugfix, or interaction repair increments the rightmost number, for example `1.0.4 -> 1.0.5`.
- MINOR: a complete feature module increments the middle number and resets PATCH, for example `1.0.9 -> 1.1.0`.
- MAJOR: an architecture change, compatibility break, or core feature rewrite increments the left number and resets the other numbers, for example `1.9.9 -> 2.0.0`.

Fix files:

- `AGENTS.md`
- `README.md`
- `docs/FINAL_REPORT.md`
- `package.json`
- `manifest.json`

## Debug Snapshot Additions

The v1.0.5 debug snapshot must include:

- `conversationId`
- `turnsSource`
- `turnsLength`
- `apiTurnsLength`
- `domTurnsLength`
- `usingCachedApiTurns`
- `lastStableTurnsLength`
- `activeIndex`
- `activeReason`
- `activeLineY`
- `visibleTurnIndexes`
- `rail.markCount`
- `selectionMode`
- `selectedCount`
- `hoverIndex`
- `hitZoneDistance`
- `jumpTargetIndex`
- `jumpAnchorExists`
- `jumpAttempts`
- `attachmentSummary` for the current hover turn

## Stage Self-Check

- Change summary: documented the 14 v1.0.5 issues, categories, root causes, and planned file changes before source edits.
- Verification checklist: startup docs were read; current branch is `fix/v1.0.5-core-interactions`; source inspection covered data, rail, selection, toolbar, preview, and reference patterns.
- Known gaps or risks: subagent read-only audits are still running and may add detail to this document before final report.
- `reference/` modification status: no reference files were modified.
