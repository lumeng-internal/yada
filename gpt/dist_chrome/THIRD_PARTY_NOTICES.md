# Third-party notices — ChatGPT Yada 3.1.0

## Intake and scope

GPT Conversation Toolkit — https://github.com/bujue3709/GPT-Conversation-Toolkit
Fixed commit: b637ccef982703cd20486db9e9211eda9b25a1aa (MIT).

- features/prompt-library.js and styles.css modal sections → src/prompts/panel.ts and panel.css. Retain independent body Shadow DOM modal, backdrop, list, editor and theme. Simplify to compact SVG copy/edit/delete controls and local v1 storage; remove search, footer and composer insertion.
- features/conversation-api.js → src/conversation/completeConversation.ts: complete mapping validation and before/num_turns/include_has_versions pagination, merge and reconstruction. Preserve Yada normalization, active branch, copy and timestamps.

canxin121/chatgpt-web-performance-fix — https://github.com/canxin121/chatgpt-web-performance-fix
Fixed commit: c4b12ddd87220ab8d2a14001da46aba5e773f5c7 (MIT).

Transplanted or adapted into `src/nativeBootstrap/history.ts` and `src/nativeBootstrap/page.ts`:

- `matchConversationApiUrl` conversation API URL classification, limited to current-session `/backend-api/conversations/{id}` and `/messages`
- `rewriteGetRequest` GET Request/init preservation (`headers`, `credentials`, `cache`, `signal`, `mode`, `redirect`, `referrer`, `integrity`, caller `init` overlay)
- `num_turns` handling that never lowers an already large page
- double `requestAnimationFrame` + `setTimeout(0)` page-commit wait
- capture timeout watchdog
- pagination sentinel delayed appearance / late `data-testid` / detached-then-connected / replacement boundaries used by `src/nativeBootstrap/dom.ts`

Not transplanted: IntersectionObserver wrapping, response body rewriting, local micro-pages, Worker JSON parse, or the userscript UI.

Leo7805/luna-toc — https://github.com/Leo7805/luna-toc
Fixed commit: 1339969ec25d7c9b63068abd3776ce41780023ed (MIT).

Transplanted or adapted into `src/nativeBootstrap/history.ts` and `src/nativeBootstrap/page.ts`:

- `/backend-api/conversations/{id}` and `/backend-api/conversations/{id}/messages?before=...`
- `include_has_versions=true`
- `num_turns=100`
- `page_info.has_previous_page` / `page_info.start_cursor`
- consecutive pagination, duplicate-cursor stop, and end detection
- `getFetchUrl` Request/string/URL normalization

Not transplanted: luna-toc navigator UI, backfill-owned fetches, or posting conversation bodies to the content script.

src/utils/route.ts is original Yada SPA URL observation. Official navigation hover preview in src/nativePreview/ is original Yada code and only reads ChatGPT official TOC buttons.

Removed from production code and this notice as runtime dependencies:

- Loongphy/chatgpt-usage skeleton jumping
- AI-MarkDone navigation
- Custom Yada rail, marks layer, and `?message=` refresh

GPT Navigator Helper — https://github.com/sssstf0rest/GPT-Navigator-Helper
Fixed commit: 2ac38de536dacb0ed1ad25c31396fd62a1c49022

Used only as design-research for the 3.1.0 product flow: enlarge the first history request, temporarily bring ChatGPT's native pagination trigger into view, do not scroll the page, watch reading position, yield on user input, resume at most three times after idle, and stop at 60 seconds / 20 extra pages / official navigation. Yada does not copy, modify, bundle, or ship its source, fonts, or assets. No license is claimed or reproduced here because the upstream repository does not publish a clear source license. It is not a runtime dependency.

## GPT Conversation Toolkit license

MIT License

Copyright (c) 2026 bujue3709

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is furnished
to do so, subject to the following conditions:

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

Copyright (c) 2026 canxin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is furnished
to do so, subject to the following conditions:

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

Copyright (c) 2026 ChatTOC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is furnished
to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
