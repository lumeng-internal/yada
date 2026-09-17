# Third-party notices — ChatGPT Yada 2.2.2

## Intake and scope

Loongphy/chatgpt-usage — https://github.com/Loongphy/chatgpt-usage
Fixed commit: f1811fb5788e040fd6b35a1d25dd7b76238d8d65.
Only chatgpt-always-toc.user.js is used; its own header declares @author loongphy and @license MIT. No other files from this repository are copied.

- src/rail/nativeSkeleton.ts: direct-child skeleton scan, phantom filtering, observed user parity, scroll-root lookup, container identity and active-turn tracking. Entry count now comes from the complete API; this file only collects and binds currently materialized skeletons.
- src/rail/jump.ts: target position, long-distance direct scroll, 280ms cubic easing, 200/600/1200/2000ms fresh-node corrections and user-input cancellation.
- src/rail/controller.ts, view.ts and officialNavigation.ts: debounced scanning, userMessageId structural fingerprint, route reset and native TOC yielding. Yada retains its own UI and host lifecycle; native visibility uses whole-document buttons and immediate observation.
- src/utils/route.ts: SPA route lifecycle; rAF URL observation also handles extension isolated-world history changes without a page bridge.

The persistent official skeleton still solves targets whose message bodies are unmounted. Omit upstream text caching, list UI, CSS and host replacement.

canxin121/chatgpt-web-performance-fix — https://github.com/canxin121/chatgpt-web-performance-fix
Fixed commit: c4b12ddd87220ab8d2a14001da46aba5e773f5c7 (MIT).

- src/chatgpt-performance-fix.user.ts → src/history/historyPage.ts. Transplanted only conversation-pagination-sentinel recognition, document_start IntersectionObserver wrapping, native callback/generation recording, synthetic intersecting entries, sentinel replacement, and bounded page driving. Not transplanted: performance CSS, CodeMirror management, message metadata, cache, settings menu, sidebar, or other unrelated code.

Leo7805/luna-toc — https://github.com/Leo7805/luna-toc
Fixed commit: 1339969ec25d7c9b63068abd3776ce41780023ed (MIT).

- src/pageHook/conversationBackfill.ts, src/platforms/chatgpt/pageHook.ts and src/pageHook/conversationCapture.ts → src/history/historyClient.ts, historyState.ts, historyHydrator.ts and historyPage.ts URL/page_info handling. Used for has_previous_page / start_cursor, `/backend-api/conversations/{id}/messages?before=&include_has_versions=true&num_turns=100`, loading/ended state, same-conversation backfill guard, and page/content event protocol. Yada's completeConversation.ts remains the copy API and is not rewritten.

GPT Conversation Toolkit — https://github.com/bujue3709/GPT-Conversation-Toolkit
Fixed commit: b637ccef982703cd20486db9e9211eda9b25a1aa (MIT).

- features/prompt-library.js and styles.css modal sections → src/prompts/panel.ts and panel.css. Retain independent body Shadow DOM modal, backdrop, list, editor and theme. Simplify to compact SVG copy/edit/delete controls and local v1 storage; remove search, footer and composer insertion.
- features/conversation-api.js → src/conversation/completeConversation.ts: complete mapping validation and before/num_turns/include_has_versions pagination, merge and reconstruction. Preserve Yada normalization, active branch, copy and timestamps.

The previous Toolkit virtualized-jump/index/bridge and AI-MarkDone alignment/navigation implementations are removed from the production source and current build.

## Loongphy file license

MIT License

Copyright (c) loongphy

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

## chatgpt-web-performance-fix license

MIT License

Copyright (c) canxin121

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

## luna-toc license

MIT License

Copyright (c) Leo7805

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
