# Reference Analysis

This is an initial read-only scan of the six reference projects. It records likely useful files and explicit boundaries before formal development.

No files under `reference/` should be modified.

## 1. `reference/AI-MarkDone-main`

Directory structure summary:

- `src/drivers/content/`: platform adapters, ChatGPT DOM discovery, navigation, clipboard/export drivers.
- `src/ui/content/`: content-page UI, rail, overlay, export dialog, reader, bookmarks.
- `src/services/`: copy, export, reader, renderer, settings, markdown parser.
- `public/page-bridges/`: page-context bridge scripts.
- `tests/`: broad unit/integration coverage around ChatGPT adapter, copy, rail, reader, export.
- `docs/`: architecture, runbooks, testing, refactor notes.

Potential ChatGPT DOM files:

- `src/drivers/content/chatgpt/domConversationDiscovery.ts`
- `src/drivers/content/chatgpt/ChatGPTConversationEngine.ts`
- `src/drivers/content/chatgpt/chatgptConversationSource.ts`
- `src/drivers/content/chatgpt/types.ts`
- `src/drivers/content/conversation/collectConversationTurnRefs.ts`
- `src/drivers/content/conversation/collectConversationMessageRefs.ts`
- `src/drivers/content/adapters/sites/chatgpt.ts`
- `src/drivers/content/injection/routeWatcher.ts`
- `src/drivers/content/injection/scanScheduler.ts`

Potential conversation export files:

- `src/services/export/saveMessagesMarkdown.ts`
- `src/services/export/saveMessagesFacade.ts`
- `src/services/export/saveMessagesTypes.ts`
- `src/services/copy/copy-markdown.ts`
- `src/services/copy/html-to-markdown.ts`
- `src/services/reader/readerContentSource.ts`

Potential rail / preview files:

- `src/ui/content/chatgptDirectory/ChatGPTDirectoryRail.ts`
- `src/ui/content/controllers/ChatGPTDirectoryController.ts`
- `src/ui/content/chatgptDirectory/navigation.ts`
- `src/style/tokens.ts`
- `src/style/shadow.ts`

Potential selection-copy files:

- `src/ui/content/export/SaveMessagesDialog.ts`
- `src/services/export/saveMessagesMarkdown.ts`
- `src/services/reader/atomicSelection.ts`
- `src/services/reader/atomicExport.ts`
- `src/ui/content/reader/ReaderPanel.ts`

Do not migrate:

- Reader mode.
- PDF/PNG export.
- Bookmark system.
- Large reading panel.
- Multi-platform adapters for Claude/Gemini/DeepSeek.
- Formula renderer unless a later Markdown issue proves it necessary.

Notes:

- Strong reference for rail mechanics, Shadow DOM isolation, hover preview positioning, active highlight, route refresh, and DOM fallback.
- Its export UI is larger than ChatGPT Yada needs; use only the data/selection lessons.

## 2. `reference/chatgpt-exporter-master`

Directory structure summary:

- `src/api.ts`: ChatGPT API types, current conversation fetching, mapping/current-node processing, skip rules.
- `src/exporter/`: Markdown, HTML, text, JSON, image exporters.
- `src/utils/`: Markdown, clipboard, download, DOM, storage helpers.
- `src/ui/`: export and settings dialogs.
- `dist/`: built userscript.

Potential ChatGPT DOM files:

- `src/page.ts`
- `src/main.tsx`
- `src/utils/dom.ts`

Potential conversation export files:

- `src/api.ts`
- `src/exporter/markdown.ts`
- `src/exporter/text.ts`
- `src/utils/markdown.ts`
- `src/utils/text.ts`
- `src/constants.ts`

Key findings:

- `src/constants.ts` maps `https://chatgpt.com` to `/backend-api`.
- `src/page.ts` extracts current conversation id from `/c/<id>` and related share paths.
- `src/api.ts` fetches `/backend-api/conversation/:id`.
- `processConversation()` uses `current_node` and `mapping` to walk the current branch backward.
- `shouldSkipMessageInExport()` filters hidden/system/tool-only and non-display messages.
- `src/exporter/markdown.ts` formats role-labeled Markdown and handles citations/references.

Do not migrate:

- Batch historical export.
- ZIP export.
- Multi-format export family.
- Userscript shell.
- Image download/base64 replacement path.
- Large settings dialog.

Notes:

- This is the primary reference for copy-all data correctness.
- ChatGPT Yada should keep only current-conversation Markdown copy, not historical export.

## 3. `reference/claude-counter-0.4.2`

Directory structure summary:

- `manifest.json`: packaged extension manifest.
- `src/content/`: Claude page content logic, token counting UI, usage display.
- `src/injected/`: Claude API bridge.
- `src/vendor/`: tokenizer bundle.
- `icons/`, `META-INF/`: packaged extension assets/signatures.

Potential ChatGPT DOM files:

- None. This project targets Claude, not ChatGPT.

Potential conversation export files:

- None for this project scope.

Potential rail / preview files:

- None for this project scope.

Potential selection-copy files:

- None for this project scope.

Do not migrate:

- Token counting.
- Usage/quota rings or usage rows.
- Claude API bridge.
- `o200k_base` tokenizer.
- Any Claude-specific conversation tree logic.
- Attachment extracted-content reading.

Notes:

- Read-only negative reference.
- Confirms what this project must avoid: quota, token, tokenizer, and Claude-specific logic.

## 4. `reference/claude-nexus-main`

Directory structure summary:

- `src/pages/content/`: content UI, hooks, FloatBall, PromptButton, ExportButton, FolderManager, Timeline.
- `src/services/`: storage and i18n.
- `src/constants/`: selectors and constants.
- `src/types/`: conversation, folder, prompt, settings types.
- `src/pages/options/`, `src/pages/popup/`: broader extension UI.
- `docs/`: feature and development docs.

Potential ChatGPT DOM files:

- None directly; this project targets Claude.
- `src/constants/selectors.ts` and content hooks show selector organization patterns only.

Potential conversation export files:

- `src/pages/content/services/exportExtractors.ts`
- `src/pages/content/services/exportFormatters.ts`
- `src/pages/content/services/exportTypes.ts`
- `src/pages/content/hooks/useExport.ts`
- `src/pages/content/components/ExportButton/index.tsx`

Potential rail / preview files:

- `src/pages/content/hooks/useTimeline.ts` only as a lightweight timeline idea reference.

Potential selection-copy files:

- None directly useful for ChatGPT Yada.

Do not migrate:

- FloatBall.
- WidthPanel.
- Prompt Library.
- FolderManager.
- Usage Rings.
- Options page system.
- Claude-specific selectors and export extractors.

Notes:

- Useful only for engineering layering ideas: services, hooks, types, and content-page composition.
- Product features are intentionally out of scope for ChatGPT Yada.

## 5. `reference/Claude-Yada-v1.0.0`

Directory structure summary:

- Built extension artifact with `manifest.json`, `assets/`, `contentStyle.css`, service worker loader, icons, popup/options HTML.
- `src/pages/content/counter/styles.css` remains as source-like style reference.
- Most application logic is bundled/minified under `assets/`.

Potential ChatGPT DOM files:

- None. This is Claude-oriented.

Potential conversation export files:

- Bundled/minified assets may include copy behavior, but not suitable for direct migration.

Potential rail / preview files:

- Bundled CSS contains `claude-yada-rail` related styles.
- Use this project as product interaction and acceptance reference rather than source-code reference.

Potential selection-copy files:

- Built assets likely contain selection and copy behavior, but should not be directly migrated.

Do not migrate:

- Claude selectors.
- Claude Counter logic.
- Bundled tokenizer assets.
- Minified built code.

Notes:

- Primary use: compare intended UX for top copy-all, selective copy, right rail, hover preview, small-dot mode switch, selection menu, box selection, dark mode, and attachment summary.
- Direct code reuse is not recommended because the project is packaged/minified and Claude-specific.

## 6. `reference/ophel-main`

Directory structure summary:

- `src/adapters/`: platform adapters, including ChatGPT.
- `src/core/`: outline, copy, theme, conversation, queue, prompt, usage, layout managers.
- `src/contents/`: content-script entry points.
- `src/components/`: panel UI, outline, conversations, prompts, settings, icons.
- `src/styles/native-theme-adapters/`: per-site theme adapters.
- `src/utils/`: DOM toolkit, exporter, markdown, scroll, storage, themes.
- `src/platform/`: userscript and extension platform support.
- `src/tabs/options/`: options UI.

Potential ChatGPT DOM files:

- `src/adapters/chatgpt.ts`
- `src/styles/native-theme-adapters/chatgpt.ts`
- `src/utils/dom-toolkit.ts`
- `src/utils/scroll-helper.ts`
- `src/contents/ui-entry.tsx`
- `src/contents/main.ts`
- `src/core/theme-manager.ts`
- `src/core/outline-manager.ts`

Potential conversation export files:

- `src/utils/exporter.ts`
- `src/core/copy-manager.ts`
- `src/core/conversation/manager.ts`
- `src/core/conversation/types.ts`
- `src/adapters/chatgpt.ts` export config and extraction methods.

Potential rail / preview files:

- No direct right-rail match for this project.
- `src/core/outline-manager.ts` and `src/components/OutlineTab.tsx` are useful only as a negative example of a large outline panel that ChatGPT Yada should avoid.

Potential selection-copy files:

- `src/core/copy-manager.ts`
- `src/utils/exporter.ts`
- `src/components/OutlineTab.tsx` only as broad selection/navigation context.

Do not migrate:

- Multi-platform adapter architecture.
- Settings system.
- Bookmarks and folders.
- Prompt system.
- Large outline panel.
- Usage counter.
- Model locker.
- Scroll lock.
- Width/appearance controls.
- Userscript platform.

Notes:

- Strong reference for current ChatGPT selectors, scroll container heuristics, active conversation detection, route/dynamic mounting, and light/dark theme adaptation.
- Must be simplified heavily for ChatGPT-only, current-conversation-only v1.0.

## Cross-Project Candidate Files To Read Before Development

Read these first in Phase 1 and Phase 2:

1. `reference/chatgpt-exporter-master/src/api.ts`
2. `reference/chatgpt-exporter-master/src/exporter/markdown.ts`
3. `reference/chatgpt-exporter-master/src/page.ts`
4. `reference/AI-MarkDone-main/src/drivers/content/chatgpt/domConversationDiscovery.ts`
5. `reference/AI-MarkDone-main/src/drivers/content/chatgpt/ChatGPTConversationEngine.ts`
6. `reference/AI-MarkDone-main/public/page-bridges/chatgpt-conversation-bridge.js`
7. `reference/AI-MarkDone-main/src/ui/content/chatgptDirectory/ChatGPTDirectoryRail.ts`
8. `reference/AI-MarkDone-main/src/ui/content/controllers/ChatGPTDirectoryController.ts`
9. `reference/AI-MarkDone-main/src/ui/content/chatgptDirectory/navigation.ts`
10. `reference/ophel-main/src/adapters/chatgpt.ts`
11. `reference/ophel-main/src/styles/native-theme-adapters/chatgpt.ts`
12. `reference/ophel-main/src/utils/dom-toolkit.ts`

## Modules Explicitly Out Of Scope

- Claude Counter token and quota code.
- Any tokenizer bundle.
- Multi-platform adapter registries.
- Prompt Library.
- FolderManager.
- FloatBall.
- WidthPanel.
- Large outline/read mode panels.
- PDF/PNG export.
- ZIP/history export.
- OCR or attachment file-body extraction.

## Initial Technical Direction

1. Start with a ChatGPT DOM scout to verify current selectors.
2. Build a small conversation engine around current conversation id, `mapping`, and `current_node`.
3. Use DOM fallback only for currently rendered turns.
4. Implement Markdown copy before rail UI.
5. Implement rail as an isolated overlay, likely Shadow DOM.
6. Add hover preview and selective copy only after navigation is stable.
