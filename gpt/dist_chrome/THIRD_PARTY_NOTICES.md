# Third-party notices — ChatGPT Yada 2.1.1

## Intake and scope

GPT Conversation Toolkit — https://github.com/bujue3709/GPT-Conversation-Toolkit
Upstream commit: b637ccef982703cd20486db9e9211eda9b25a1aa (MIT).

- features/prompt-library.js and styles.css prompt modal sections → src/prompts/panel.ts and panel.css: retain modal, backdrop, filters, list cards, editor, empty state, footer and themes. Header clipping requires the actual independent modal, not another toolbar popover. Remove category/sort/import/export/clipboard actions; add local edit and native composer insertion adapters. Keep Yada storage format.
- features/virtualized-jump.js, conversation-index.js and utils/dom.js → src/rail/virtualizedJump.ts and conversationIndex.ts: retain message identity, mounted window, virtual index calibration, bridge-first materialization, directional stepping, stagnation and boundary probing. The previous proportional scan cannot handle virtualized variable-height messages. Remove unsafe weak-ID success, ratio guesses and alternating/reversed probes to meet the explicit target-identity/no-oscillation contract.
- features/virtualizer-bridge.js → src/rail/virtualizerBridge.ts; features/virtualizer-bridge-page.js → src/rail/virtualizerBridgePage.ts → dist_chrome/features/virtualizer-bridge-page.js. Preserve upstream protocol and React virtualizer discovery; add cancellation and route cache invalidation.
- features/conversation-api.js → src/conversation/completeConversation.ts: full mapping validation and actual before/num_turns/include_has_versions pagination, merge and reconstruction. Keep Yada normalization, active branch, Markdown copy and timestamps.
- features/timeline.js: jump lifecycle/user-cancel/progress/highlight behavior adapted to Yada controller; no unrelated timeline UI.

AI-MarkDone — https://github.com/zhaoliangbin42/AI-MarkDone
Upstream commit: d6cc562931607f378c48023420f814de1f7c9d60 (MIT).

- src/ui/content/chatgptDirectory/navigation.ts and src/drivers/content/chatgpt/ChatGPTConversationNavigation.ts → src/rail/alignment.ts: exact-identity re-resolution, node replacement, quiet measurements, bounded re-alignment and cancellation. Add measured header obstruction; remove unrelated surface/adapter/debug dependencies.
- src/drivers/content/chatgpt/ChatGPTOfficialNavigation.ts → src/rail/officialNavigation.ts: retain selectors/structure, add visibility and geometry fallback; hide only Yada's existing host.

Open Prompt Manager — https://github.com/jonathanbertholet/promptmanager
Reviewed commit: 1ec198c03efa2faa864956773a165789981d509a.
No explicit source-copy license found in this checkout. No source copied or adapted. The requested fallback uses the MIT Toolkit modal; editing/insertion/wait/deduplication are locally authored adapters.

## GPT Conversation Toolkit license

MIT License

Copyright (c) 2026 bujue3709

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## AI-MarkDone license

MIT License

Copyright (c) 2025 BenkoZhao

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
