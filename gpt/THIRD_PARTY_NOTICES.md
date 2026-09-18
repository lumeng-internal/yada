# Third-party notices — ChatGPT Yada 4.0.0

## GPT Conversation Toolkit

https://github.com/bujue3709/GPT-Conversation-Toolkit
Commit: ca628eeaed87323c195aa7b6d2750d2804e6ac77
License: MIT

Introduced:

- Full-conversation / paginated API contracts into `src/conversation/completeConversation.ts` (already present from 3.0.1; pagination now keeps the original `messages` view).
- Prompt modal interaction patterns already in `src/prompts/`.

Not introduced: Reader, bookmarks, PDF/PNG export, cloud backup, a second navigation state machine.

## LunaTOC

https://github.com/Leo7805/luna-toc
Commit: 1339969ec25d7c9b63068abd3776ce41780023ed
License: MIT

Introduced as a read-only module in `vendor/luna-navigation/`:

- Navigation data, fingerprinting, snapshot/anchor stores, virtual search planner/machine/controller, ChatGPT virtual-search/rendered-text adapters, fetch bumper helpers (not installed as a page hook), and their upstream tests.
- Copilot stubs exist only because the unmodified platform registry imports them.

Not introduced: sidebar UI, settings page, prompt library UI, application shell, outline UI, MAIN-world page-hook IIFE. Yada does not install Luna's fetch interceptor.

## AI-MarkDone

https://github.com/zhaoliangbin42/AI-MarkDone
Commit: d6cc562931607f378c48023420f814de1f7c9d60
License: MIT

Reference only: stable message identity, pending-navigation lifecycle, route cancel, long-thread test standards.

Not copied: Reader, bookmarks, annotations, PDF/PNG, cloud backup.

## MKRingProgressView

https://github.com/maxkonovalov/MKRingProgressView
Commit: 660888aab1d2ab0ed7eb9eb53caec12af4955fa7
License: MIT

Visual reference only for Apple Watch-style three rings. No Swift runtime copied.

## react-activity-rings

https://github.com/JonasDoesThings/react-activity-rings
Commit: 891656158768694a1f327ea5d414085b2819a55f
License: MIT

Ported ideas only: multi-ring radius, remaining-percentage arcs, rounded caps, ring gaps. Rewritten as TypeScript + OffscreenCanvas. React is not a dependency.

## ai-usage-extension

https://github.com/cupcakedev/ai-usage-extension
Commit: 67e2fdb8d4a69d2dbe5de1a4b86a9f7daf9831e0
License: MIT

Reference only: MV3 service worker, `chrome.action.setIcon`, multi-size ImageData, storage-driven icon updates, popup/background sync.

## Vibe Bar

https://github.com/AstroQore/vibe-bar
Commit: af26391c5bcc074108072af8f2807fc4c47edf21
License: AGPL-3.0

Behavior/data ideas only (seven-day backfill, local ledger, coverage, estimated remaining). **No source, assets, or UI copied.**

## GPT Navigator Helper

Design-research only. Not bundled. Users do not install it.

## Historical note

3.1.1 native bootstrap and “install GPT Navigator Helper so official navigation appears” are obsolete product instructions.

## License texts

### MIT (Toolkit / LunaTOC / AI-MarkDone / MKRingProgressView / react-activity-rings / ai-usage-extension)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Copyright (c) 2026 bujue3709
Copyright (c) 2026 ChatTOC
Copyright (c) 2026 zhaoliangbin42
Copyright (c) 2015 Max Konovalov
Copyright (c) JonasDoesThings
Copyright (c) cupcakedev
