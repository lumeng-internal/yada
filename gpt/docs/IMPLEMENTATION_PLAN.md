# Implementation Plan: v1.0.1 Rebuild

This plan replaces the failed v1.0 route. The project remains lightweight, but the UI will be rebuilt around mature ChatGPT content UI patterns rather than patched as isolated floating widgets.

## Phase 0: Postmortem And Reference Deep Dive

Completed deliverables:

- `docs/UI_FAILURE_POSTMORTEM.md`
- `docs/V1_0_1_REBUILD_PLAN.md`
- `docs/V1_0_1_REFERENCE_DEEP_DIVE.md`

Rules:

- `reference/` remains read-only.
- Document any close reference intake before implementation.
- Do not copy large modules from references.

Self-check:

- Failure reason is documented as architecture, not a CSS bug.
- Keep/rewrite boundaries are documented.

## Phase 1: Rebuild Rules In Project Docs

Deliverables:

- Update `AGENTS.md`.
- Update `docs/PRODUCT_SPEC.md`.
- Update `docs/IMPLEMENTATION_PLAN.md`.
- Update `docs/TEST_CHECKLIST.md`.

Rules:

- State that AI-MarkDone is the UI base reference.
- State that chatgpt-exporter is the copy-data reference.
- State that ophel is the DOM/scroll/active/theme reference.
- State that Claude Yada is the product acceptance standard.
- State that the v1.0 UI layer may be discarded.

Build:

- Documentation-only phase; no build required unless source is touched.

## Phase 2: Data Layer Audit And Fix

Target files:

- `src/conversation/fetchConversation.ts`
- `src/conversation/normalizeConversation.ts`
- `src/conversation/domCollector.ts`
- `src/conversation/attachmentSummary.ts`
- `src/export/markdownFormatter.ts`
- `src/export/clipboard.ts`
- `src/platform/chatgptAdapter.ts`
- `src/utils/*`

Required behavior:

- API-first current conversation copy.
- Conversation id from current ChatGPT route only.
- `/backend-api/conversation/{id}` fetch with page credentials.
- Restore current branch from `mapping` and `current_node`.
- Filter system, hidden, tool-only, reasoning/thought, and empty non-content messages.
- DOM fallback only for new/unsaved/API-failed conversations and anchors.
- Markdown headings are exactly `# User` and `# ChatGPT`.
- Attachments are placeholders only.
- No token, quota, Counter, Claude user-facing text, API key, remote script, or server behavior.

Build:

- Run `npm run build`.

## Phase 3: UI Shell Rebuild

Target files:

- `src/content.ts`
- `src/styles.ts`
- `src/ui/theme.ts`
- `src/rail/rail.ts`
- `src/rail/active.ts`
- `src/rail/preview.ts`
- `src/rail/selection.ts`
- `src/ui/toolbar.ts`
- `src/ui/menu.ts` if created.

Required behavior:

- One idempotent Shadow DOM host owns toolbar, rail, preview, menu, route refresh, scan scheduling, active state, and cleanup.
- UI only shows on current ChatGPT conversation pages.
- Route changes do not duplicate UI.
- MutationObserver refresh is debounced.
- Cleanup prevents stacked rails after SPA navigation.
- UI never changes ChatGPT layout.

Build:

- Run `npm run build`.

## Phase 4: Toolbar

Required controls:

- `复制全部`
- `选择复制 ▾`
- Small-dot preview mode toggle.

Required behavior:

- Small restrained control cluster near the rail.
- No large panel, large background, glass sheet, or large shadow.
- Inline temporary feedback for copy and toggle actions.
- Toggle persists User-only vs User + ChatGPT preview mode.

Build:

- Run `npm run build`.

## Phase 5: Transparent Rail

Required behavior:

- Right-side transparent short marks only.
- One mark per User turn.
- Normal click jumps to the User anchor.
- Active, hover, and selected states use restrained ChatGPT green.
- Selected state does not resize the mark.
- Density adapts to conversation length.
- Hit zone remains near the rail and does not interfere with body text selection.

Build:

- Run `npm run build`.

## Phase 6: Hover Preview

Required behavior:

- Fixed-position preview to the left of the hovered mark.
- Viewport clamped.
- Stable hover that does not flicker when moving around the rail interaction area.
- User-only by default.
- User + ChatGPT mode after small-dot toggle.
- One-second expanded preview.
- Light/dark theme support.

Build:

- Run `npm run build`.

## Phase 7: Rail-Based Selective Copy

Required behavior:

- Enter selection mode from `选择复制 ▾`.
- Menu stays open until `退出选择`.
- Click rail mark toggles selection in selection mode.
- Box selection starts only near rail and after movement over 5px.
- Drag previews selection; pointer up applies final toggles based on original state.
- Copy selected outputs selected turns in original order.
- Selected state uses stable turn ids where available.

Build:

- Run `npm run build`.

## Phase 8: Lightweight And Scope Audit

Checks:

- `npm run build`.
- `dist_chrome/manifest.json` and `dist_chrome/content.js` exist.
- Inspect content bundle size.
- `git diff -- reference` is empty.
- `src`, `package.json`, and `manifest.json` contain no React, createRoot, tokenizer, Claude Counter, quota, remote script, API key, backend server, Reader, PDF/PNG, bookmarks, or batch export logic.

## Phase 9: Final Report And Manual QA Plan

Deliverables:

- Update `README.md`.
- Update `docs/FINAL_REPORT.md`.
- Update `docs/TEST_CHECKLIST.md`.

Required report contents:

- v1.0 failure reason.
- v1.0.1 mature-base route.
- References used.
- v1 files kept.
- UI files rewritten.
- Completed features.
- Unfinished or unverified work.
- Known risks.
- Edge load path and manual testing steps.
- Build result and bundle files.
- Confirmation that `reference/` was not modified and forbidden features were not introduced.
