# Third-party notices — ChatGPT Yada 3.0.0

## Intake and scope

GPT Conversation Toolkit — https://github.com/bujue3709/GPT-Conversation-Toolkit
Fixed commit: b637ccef982703cd20486db9e9211eda9b25a1aa (MIT).

- features/prompt-library.js and styles.css modal sections → src/prompts/panel.ts and panel.css. Retain independent body Shadow DOM modal, backdrop, list, editor and theme. Simplify to compact SVG copy/edit/delete controls and local v1 storage; remove search, footer and composer insertion.
- features/conversation-api.js → src/conversation/completeConversation.ts: complete mapping validation and before/num_turns/include_has_versions pagination, merge and reconstruction. Preserve Yada normalization, active branch, copy and timestamps.

src/utils/route.ts is original Yada SPA URL observation. Official navigation hover preview in src/nativePreview/ is original Yada code and only reads ChatGPT official TOC buttons.

Removed from production code and this notice:

- Loongphy/chatgpt-usage skeleton jumping
- canxin121/chatgpt-web-performance-fix history pagination / IntersectionObserver wrapping
- Leo7805/luna-toc history page protocol
- AI-MarkDone navigation
- Custom Yada rail, marks layer, and `?message=` refresh

GPT Navigator Helper — https://github.com/sssstf0rest/GPT-Navigator-Helper

Recommended as a separately installed companion so ChatGPT official navigation can appear after refresh. Yada does not copy, modify, bundle, or ship its source, fonts, or assets. No license is claimed or reproduced here because the upstream repository does not publish a clear source license.

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
