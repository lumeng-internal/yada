# Product Spec: ChatGPT Yada v1.0.1

## Product Positioning

ChatGPT Yada is a super lightweight browser extension for navigating and copying the current ChatGPT conversation.

It serves one page, one conversation, and one job: make long ChatGPT threads easier to scan, jump through, and copy as clean Markdown.

v1.0.1 is a correction after the v1.0 UI failed manual testing. The product remains lightweight, but the UI foundation must follow a mature ChatGPT content UI base instead of hand-built floating widgets.

## Architecture Sources

- UI rail, Shadow DOM, route watcher, scan scheduler, and content mounting: `reference/AI-MarkDone-main`.
- Current-conversation copy data: `reference/chatgpt-exporter-master`.
- ChatGPT DOM, scroll container, active state, and theme heuristics: `reference/ophel-main`.
- Product interaction and acceptance standard: `reference/Claude-Yada-v1.0.0`.

The current v1.0 data layer can be preserved after audit. The current v1.0 UI layer is failed implementation and may be discarded or rewritten.

## Core User Scenarios

1. In a long ChatGPT conversation, the user wants to jump back to a previous question without using browser search or manual scrolling.
2. The user wants to copy the entire current conversation into Markdown for notes, docs, or external editing.
3. The user wants to copy only selected turns from the current conversation.
4. The user wants quick hover context from the rail without opening a large outline panel.
5. The user wants the extension to feel native in both ChatGPT light and dark themes.

## Core Features

1. Current ChatGPT conversation right-side transparent rail.
2. One-click copy current conversation as Markdown.
3. Selective copy based on rail selection.
4. Rail hover preview.
5. User-only hover preview by default.
6. Small-dot toggle to switch hover preview to User + ChatGPT.
7. Light/dark mode natural adaptation.
8. Placeholder summaries for images, files, pasted content, and no-text messages.

## Explicit Non-Goals

The following are forbidden for v1.0.1:

1. GPT quota reminders.
2. Token estimation.
3. Claude Counter.
4. Multi-platform support.
5. Claude, Gemini, Grok, DeepSeek, or other platform support.
6. Prompt Library.
7. FolderManager.
8. FloatBall.
9. WidthPanel.
10. Server-side components.
11. API keys.
12. Remote scripts.
13. OCR.
14. Reading file bodies.
15. Downloading attachment contents.
16. Batch historical conversation export.
17. PDF or PNG large export.
18. Reader mode.
19. Bookmark system.
20. Complex settings pages.
21. A large all-in-one enhancement suite.

## Rail Interaction Rules

- The rail appears on the right side of the current ChatGPT conversation.
- The rail is transparent and visually quiet when idle.
- The rail must not have a visible panel, glass sheet, large shadow, or obvious border.
- The rail must not resize, push, or otherwise alter ChatGPT's layout.
- Each rail mark represents one user/assistant turn pair.
- The active turn is highlighted based on the current viewport position.
- Clicking a rail mark scrolls to the corresponding user prompt anchor.
- In selection mode, clicking a rail mark selects or unselects the turn instead of jumping.
- The rail must not cover ChatGPT's primary input controls.
- The rail must react to route changes and dynamic message rendering.
- The rail should degrade gracefully if ChatGPT DOM selectors drift.
- Selected marks must keep stable dimensions and use color plus a small marker, not sudden growth.

## Toolbar Rules

- Required controls: `复制全部`, `选择复制 ▾`, and the small-dot preview mode toggle.
- The toolbar must be a small, restrained control cluster, not a large floating panel.
- It must not sit in the middle of the page.
- It must not use a large green background.
- It must not cover ChatGPT content or native controls.
- Copy feedback should be inline and temporary, not modal.

## Copy-All Rules

- Copy-all operates only on the current ChatGPT conversation.
- Output format is Markdown.
- Message order must follow the visible conversation path, not unrelated branch or history data.
- Preferred engine should use ChatGPT conversation mapping and `current_node` chain restoration when available.
- DOM fallback is allowed only for the current rendered conversation.
- Markdown should preserve ordinary paragraphs, lists, code blocks, tables when available, and readable role labels.
- The feature must not batch export historical conversations.
- The feature must not download image/file assets.

## Selective Copy Rules

- Selective copy uses rail-selected turns.
- Selection supports individual turn selection and rail-area box selection.
- Selected output keeps original conversation order.
- Selected output uses the same Markdown formatter as copy-all.
- The selection menu stays open until `退出选择`.
- Copy selected, invert, select all, and clear must not close the menu.
- Selection UI must be rail-native and lightweight.
- If no turn is selected, selective copy should not copy stale content.

## Hover Preview Rules

- Hovering a rail mark shows a small preview near the rail.
- The preview appears to the left of the hovered mark and is fixed-positioned.
- Default preview mode: User only.
- Small-dot toggle preview mode: User + ChatGPT.
- The preview expands after about one second of hover.
- The preview must be short, readable, and clipped safely.
- User-only preview uses the user prompt text for that turn.
- User + ChatGPT preview includes the user prompt and a short assistant summary or beginning of assistant text.
- Preview must not shift page layout.
- Preview must not require a large outline panel.

## Attachment Summary Rules

Images, files, pasted content, and no-text messages are represented as placeholders only.

Required examples:

- `[图片]`
- `[图片] [图片]`
- `[PDF 文件] file.pdf`
- `[Markdown 文件] file.md`
- `[CSV 文件] file.csv`
- `[文本文件] file.txt`
- `[Excel 文件] file.xlsx`
- `[Word 文件] file.docx`
- `[文件] file`
- `[粘贴内容]`
- `[无文字消息]`

Rules:

- Use only metadata already visible or available in the current conversation payload.
- Do not OCR images.
- Do not read file body text.
- Do not download attachment contents.
- Do not embed base64 images.
- Do not attempt to recover hidden content.

## Dark Mode Rules

- The extension must adapt to ChatGPT's native light/dark mode.
- Theme detection should prefer ChatGPT page state such as `html.dark`, `html.light`, `data-theme`, or computed color scheme.
- UI surfaces should use transparent or semi-transparent colors and avoid harsh contrast.
- Hover preview, rail marks, active states, and selection states must remain readable in both modes.
- The extension must not force ChatGPT to change theme.

## ChatGPT Green Theme Rules

- ChatGPT green is the primary accent for selected and active states.
- Preferred accent family: `#10A37F` / `#1A7F64` or a close ChatGPT-native equivalent.
- Use the accent sparingly: active rail mark, selected state, copy success, and toggle-on state.
- Do not turn the whole UI into a solid green theme.
- In dark mode, green accents must be softened enough to avoid glowing or visual noise.

## v1.0.1 Acceptance Shape

The v1.0.1 product is accepted only if it feels smaller than the reference projects:

- No large panel.
- No multi-platform abstraction visible to users.
- No quota/token surface.
- No historical export UI.
- No complex settings.
- No visible page pollution.
- Rail is transparent short marks.
- Hover preview and selection copy feel reliable on long conversations.
