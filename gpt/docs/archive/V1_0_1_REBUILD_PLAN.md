# v1.0.1 Rebuild Plan

## Goal

Rebuild ChatGPT Yada as a manually testable v1.0.1 extension by replacing the failed v1.0 UI route with a mature ChatGPT UI-base approach while keeping the product lightweight and current-conversation-only.

## New Base Route

The v1.0.1 architecture keeps this repository's MV3 + Vite + TypeScript project, but changes the implementation strategy:

1. Preserve the local extension shell and build pipeline.
2. Re-audit and keep only the current data layer that already matches the product constraints.
3. Rebuild the UI layer around the proven ideas in AI-MarkDone: Shadow DOM isolation, stable content mounting, route watcher, scan scheduler, transparent right-side rail, fixed hover preview, and theme tokens.
4. Use chatgpt-exporter for complete current conversation copy correctness.
5. Use ophel for ChatGPT DOM, scroll, active, and theme heuristics.
6. Use Claude Yada as the acceptance standard for restrained UI, rail-based selection, hover preview, small-dot toggle, and attachment placeholders.

## Files Expected To Preserve After Audit

These files may remain, with fixes if needed:

- `manifest.json`
- `package.json`
- `tsconfig.json`
- `vite.config.ts`
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

Preservation is conditional. If audit finds API-first copy, filtering, attachment placeholders, or Markdown output defects, these files must be fixed.

## Files Expected To Discard Or Rewrite

These files are part of the failed v1.0 UI route and should be treated as replaceable:

- `src/content.ts`
- `src/styles.ts`
- `src/rail/rail.ts`
- `src/rail/preview.ts`
- `src/rail/selection.ts`
- `src/rail/active.ts`
- `src/ui/toolbar.ts`
- `src/ui/menu.ts` if present later
- `src/ui/theme.ts`

The rewrite must not be a CSS patch over the broken implementation. It must rebuild mounting, cleanup, rail layout, preview positioning, selection hit testing, and toolbar behavior as one isolated content UI.

## Reference Files To Deep Read

AI-MarkDone:

- `reference/AI-MarkDone-main/src/ui/content/chatgptDirectory/ChatGPTDirectoryRail.ts`
- `reference/AI-MarkDone-main/src/ui/content/controllers/ChatGPTDirectoryController.ts`
- `reference/AI-MarkDone-main/src/drivers/content/chatgpt/ChatGPTConversationEngine.ts`
- `reference/AI-MarkDone-main/src/drivers/content/chatgpt/chatgptConversationSource.ts`
- `reference/AI-MarkDone-main/src/drivers/content/chatgpt/domConversationDiscovery.ts`
- `reference/AI-MarkDone-main/src/drivers/content/conversation/navigation.ts`
- `reference/AI-MarkDone-main/src/drivers/content/injection/routeWatcher.ts`
- `reference/AI-MarkDone-main/src/drivers/content/injection/scanScheduler.ts`
- `reference/AI-MarkDone-main/src/drivers/content/theme/theme-manager.ts`
- `reference/AI-MarkDone-main/src/style/shadow.ts`
- `reference/AI-MarkDone-main/src/style/tokens.ts`
- `reference/AI-MarkDone-main/src/style/pageTokens.ts`

chatgpt-exporter:

- `reference/chatgpt-exporter-master/src/api.ts`
- `reference/chatgpt-exporter-master/src/exporter/markdown.ts`
- `reference/chatgpt-exporter-master/src/utils/markdown.ts`
- `reference/chatgpt-exporter-master/src/utils/clipboard.ts`
- `reference/chatgpt-exporter-master/src/type.ts`
- `reference/chatgpt-exporter-master/src/page.ts`

ophel:

- `reference/ophel-main/src/core/outline-manager.ts`
- `reference/ophel-main/src/core/conversation-manager.ts`
- `reference/ophel-main/src/core/conversation/manager.ts`
- `reference/ophel-main/src/core/conversation/types.ts`
- `reference/ophel-main/src/core/copy-manager.ts`
- `reference/ophel-main/src/core/theme-manager.ts`
- `reference/ophel-main/src/styles/native-theme-adapters/chatgpt.ts`
- `reference/ophel-main/src/styles/theme-variables.css`
- `reference/ophel-main/src/contents/main.ts`
- `reference/ophel-main/src/contents/ui-entry.tsx`

Claude Yada:

- Read as product standard and visual/interaction acceptance reference.

## Rebuild Steps

1. Document the failure and rebuild route.
2. Use subagents or manual tracks to deep-read the references and audit current v1.0 code.
3. Update project docs and agent rules so future work does not return to the failed route.
4. Fix data layer first: current conversation id, API fetch, mapping/current-node path, message filtering, turn grouping, attachment placeholders, Markdown output, and clipboard write.
5. Rebuild UI content mounting around one Shadow DOM root with route-change cleanup and scan scheduling.
6. Rebuild toolbar as a small fixed control cluster: copy all, selection copy menu, and persisted preview-mode dot.
7. Rebuild rail as transparent short marks only, with active, hover, and selected states that never resize unpredictably.
8. Rebuild hover preview as a fixed element positioned next to the hovered rail mark and bounded to the viewport.
9. Rebuild selection copy around rail hit testing, persistent menu, single-click toggle, and macOS-style box selection.
10. Build, audit bundle scope, inspect diffs, self-review, and document final manual testing.

## Acceptance Standards

- `npm run build` passes.
- `dist_chrome/` is generated.
- The extension matches only ChatGPT.
- The UI does not change ChatGPT layout.
- The rail is transparent and consists only of quiet short marks.
- The toolbar is small, stable, and does not cover the conversation.
- Hover preview appears to the left of the active rail mark and does not flicker.
- User-only preview is default; User + ChatGPT mode persists.
- Selective copy is rail-based, not body-checkbox-based.
- Markdown output uses `# User` and `# ChatGPT`.
- Attachments are placeholders only.
- Light and dark modes are readable without large white/gray/black panels.
- No React, tokenizer, Claude Counter, quota reminder, remote script, API key, server, Reader, PDF/PNG, bookmark, or batch export code is introduced.
- `reference/` remains unmodified.

## Forbidden Scope

Do not add GPT quota reminders, token estimation, Claude Counter, tokenizer bundles, multi-platform support, Prompt Library, FolderManager, FloatBall, WidthPanel, backend server, API keys, remote scripts, OCR, attachment downloads, file-body reading, historical batch export, PDF/PNG export, Reader mode, bookmarks, settings panels, or any visible UI that pollutes the ChatGPT page.

## Stage Self-Check

- Change summary: defined the v1.0.1 rebuild plan around a mature ChatGPT UI base and narrow copy-data references.
- Verification checklist: branch creation completed; workspace was clean before writing; reference directory exists.
- Known gaps or risks: exact implementation details will be refined after the reference deep dive and current-code audit.
- `reference/` modification status: no reference files were modified.
