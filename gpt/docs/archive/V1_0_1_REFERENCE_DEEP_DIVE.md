# v1.0.1 Reference Deep Dive

## Method

Five read-only research tracks were used:

- AI-MarkDone UI base.
- Claude Yada product standard.
- chatgpt-exporter copy-data base.
- ophel ChatGPT DOM, scroll, active, and theme reference.
- Current failed v1.0 code audit.

All research was read-only. `reference/` remains a read-only directory and was not modified.

## A. AI-MarkDone UI Base

### Useful UI Mounting Ideas

- Use one fixed host id and one Shadow DOM root for the extension UI.
- Make mounting idempotent: if the host already exists, reconnect or reuse it; if not, create it.
- Centralize route visibility, theme, data refresh, and cleanup in one content controller instead of independent floating widgets.
- Use route polling plus `popstate` / `hashchange` style checks for ChatGPT SPA navigation.
- Use MutationObserver with debounced scan scheduling. Avoid refreshing on every streamed DOM mutation.
- Keep rail visible only when a current ChatGPT conversation has turns.

### Useful Rail Ideas

- Fixed right-side rail with one lightweight button per conversation round.
- Draw the visible mark as a short line, ideally via CSS pseudo-element or a tiny inner element.
- Drive visual states with data attributes: idle, hover, active, selected, box preview.
- Keep rail structure small and allow density rules to shrink marks for long conversations.
- Use DOM discovery fallbacks: turn wrapper, role container, and role scan.

### Useful Hover Preview Ideas

- Position preview with the hovered mark rect and clamp it to the viewport.
- Show the preview to the left of the rail mark, not in a generic fixed corner.
- Use hover proximity and pointer/focus events carefully so the preview does not flicker.
- Keep preview content small and derived from turn summary, not from a large reader panel.
- Adapt this logic to Yada's required preview modes: User only by default, User + ChatGPT after small-dot toggle.

### Useful Shadow DOM And Theme Ideas

- Keep all UI CSS inside Shadow DOM when possible.
- Inject a small token stylesheet into the shadow root instead of touching ChatGPT global CSS.
- Detect theme from `html.dark`, `html.light`, `data-theme`, computed color scheme, and `prefers-color-scheme` fallback.
- Keep preview inside the same Shadow DOM host unless a top-level portal is truly required.

### Do Not Migrate

- Reader mode.
- PDF / PNG export.
- Bookmarks.
- Complex export dialogs.
- Generic multi-platform navigation.
- Runtime bridge / React fiber snapshot engine.
- Step controls or other extra rail commands outside v1.0.1.

## B. Claude Yada Product Standard

### Interaction Rules To Keep

- The rail must be transparent, quiet, and made of short marks, not a visible panel.
- Each mark represents one User turn plus the following ChatGPT reply.
- Normal click jumps to the turn; selection-mode click toggles selection.
- Hover preview must appear next to the mark on the left, be clamped to the viewport, and not shift page layout.
- Preview defaults to User only.
- A small dot toggles User + ChatGPT preview mode and persists the setting.
- Hover preview expands after roughly one second.
- Selection copy is rail-based; no checkboxes should be added to ChatGPT body content.
- Selection menu stays open until the user chooses Exit Selection.
- Box selection behaves like macOS desktop selection: drag from the rail area, preview during drag, apply on pointer up, and flip state based on the original selection.
- Hit zone can be wider than the visible mark but must stay near the rail and must not interfere with normal text selection.
- Attachment handling is placeholder-only.
- Dark mode must avoid large white, gray, or black panels.

### ChatGPT Green Migration

- Replace Claude orange with ChatGPT green: `#10A37F`.
- Strong state may use `#0E8F70` or `#1A7F64`.
- Soft state should use restrained transparent green such as `rgba(16, 163, 127, 0.12)`.
- Green is for active, selected, toggle-on, success, and small labels only.
- Do not make large green UI surfaces.
- User-facing labels must say `User:` and `ChatGPT:`, never Claude or generic AI labels.

### Do Not Migrate

- Claude Counter.
- Token estimation and tokenizer bundles.
- Quota reminders or usage bars.
- Claude API bridge and Claude selectors.
- Prompt Library, FolderManager, FloatBall, WidthPanel, Reader, options UI, batch export, ZIP, PDF, PNG, OCR, attachment downloads, file-body reading, remote scripts, API keys, or server behavior.

## C. chatgpt-exporter Copy-Data Base

### Conversation Id

The useful route is current conversation only:

- `/c/{conversationId}`
- `/g/{gizmo}/c/{conversationId}`

Do not use historical-list fallback for v1.0.1, because this product only copies the current conversation.

### API Fetch

Use `/backend-api/conversation/{conversationId}` with page credentials. Access token can be obtained from `/api/auth/session` and then used as `Authorization` and `X-Authorization` headers when available.

No API key, server, or remote service should be introduced.

### Mapping And Current Node

Use:

- `mapping`
- `current_node`

Start from `current_node`, walk `parent` links backward through `mapping`, then reverse/unshift into page order. This restores the current active branch only and avoids exporting unrelated branch history.

### Filtering

Skip:

- No message/content.
- `system`.
- `tool`.
- `recipient` values other than `all`.
- non-final channels.
- visually hidden messages.
- `thoughts`, `reasoning_recap`, `model_editable_context`, `user_editable_context`.
- empty content after conversion unless attachment placeholders exist.

### Markdown

Yada should keep a smaller formatter than chatgpt-exporter:

```md
# User

...

# ChatGPT

...
```

Preserve useful text, code fences, lists, and common Markdown where available. Images, files, pasted content, and no-text messages become placeholders only.

### Do Not Migrate

- Batch historical export.
- ZIP export.
- HTML / JSON / text multi-export family.
- Userscript shell.
- Asset downloads or data URI replacement.
- Thinking/reasoning export.
- Archive/delete/probe/rate-limit UI.

## D. ophel ChatGPT DOM, Scroll, Active, And Theme Reference

### DOM Identification

Useful selectors and heuristics:

- Current page is `chatgpt.com`.
- Conversation id is parsed from `/c/:id`.
- Conversation roots: `#thread`, `main#main`, or `main`.
- Role containers: `[data-message-author-role="user"]` and `[data-message-author-role="assistant"]`.
- Turn wrappers: `[data-testid^="conversation-turn"]`, `[data-turn-id]`, `[data-turn-id-container]`.
- Message ids: `[data-message-id]`.
- User text often lives near `.whitespace-pre-wrap`.
- Assistant content often lives near `.markdown`, `.prose`, or `[class*="prose"]`.

### Scroll Container

Prefer ChatGPT's main scroll container if discoverable:

- `[class*="scrollbar-gutter"]`
- `[class*="@container/main"] > div`
- Otherwise scan scrollable `div` elements, excluding `nav`, and pick the largest useful vertical scroller.

Fall back to `document.scrollingElement` / window behavior when no container is found.

### Active Turn

Use anchor rects relative to viewport or scroll container. The active turn should usually be the last turn whose anchor is above a stable viewport line, with a fallback to the closest visible anchor.

Avoid React re-rendering for active state; set data attributes on marks.

### Theme

Use lightweight detection:

- `html.dark`
- `html.light`
- `html[data-theme]`
- `body[data-theme]`
- `localStorage.theme`
- computed `color-scheme`
- `prefers-color-scheme`

Do not rewrite ChatGPT native CSS variables. Yada should theme only its own Shadow DOM.

### Do Not Migrate

- Multi-platform adapter registry.
- Settings store and panels.
- Prompt Library.
- Folders, bookmarks, global search, WebDAV, model lock, wide/zen modes, formula/table copy buttons, and large outline panel.

## E. Current v1.0 Code Audit

### Keep With Fixes

- `src/conversation/types.ts`
- `src/conversation/fetchConversation.ts`
- `src/conversation/normalizeConversation.ts`
- `src/conversation/domCollector.ts`
- `src/conversation/attachmentSummary.ts`
- `src/export/markdownFormatter.ts`
- `src/export/clipboard.ts`
- `src/platform/chatgptAdapter.ts`
- `src/scout/chatgptDomScout.ts`
- `src/utils/*`

### Required Data-Layer Fixes

- Keep API-first conversation loading.
- Bind DOM anchors by message id when possible before falling back to index.
- Keep DOM fallback for new/unsaved/API-failed conversations only.
- Tighten DOM attachment detection so generic page UI is not mistaken for files.
- Ensure empty text with real attachments produces placeholders.
- Ensure no Claude, token, quota, or counter user-facing behavior exists.

### Rewrite

- `src/content.ts`
- `src/styles.ts`
- `src/rail/rail.ts`
- `src/rail/preview.ts`
- `src/rail/selection.ts` if stable turn-id selection is needed.
- `src/rail/active.ts`
- `src/ui/toolbar.ts`
- `src/ui/menu.ts` if created.
- `src/ui/theme.ts` styles and theme application, though the detection helper can be reused.

### Technical Reasons v1.0 UI Failed

- UI mounted on every `chatgpt.com/*` page without conversation-route gating.
- Toolbar was a high-z-index floating panel with visible background, border, blur, and shadow.
- Rail used fixed viewport distribution, not enough mature mounting, cleanup, and hover hit-zone control.
- Body-wide MutationObserver could refresh on streaming mutations and cause flicker or state churn.
- Selection state used indexes while copy selected reloaded a fresh snapshot, risking mismatched selected turns.
- Preview depended on per-node mouseenter/mouseleave and estimated heights.
- Empty rail area pointer handling was inconsistent with box selection.

## Rebuild Direction

1. Keep the MV3 + Vite + TypeScript shell.
2. Fix data layer first and preserve small modules where valid.
3. Rebuild a single Shadow DOM content UI controller that owns toolbar, rail, preview, menu, route refresh, mutation scheduling, active state, and cleanup.
4. Keep toolbar as a small transparent control cluster near the rail, not as a large floating panel.
5. Keep the rail transparent with short marks only.
6. Use fixed preview positioning left of the active mark with viewport clamp.
7. Use rail-local hit testing and stable turn ids for selection copy.
8. Keep all forbidden features out.

## Stage Self-Check

- Change summary: recorded findings from all five reference/current-code research tracks.
- Verification checklist: all tracks were read-only; findings identify keep/rewrite boundaries and forbidden migrations.
- Known gaps or risks: live ChatGPT UI still needs manual verification after implementation; DOM selectors can drift.
- `reference/` modification status: no reference files were modified.
