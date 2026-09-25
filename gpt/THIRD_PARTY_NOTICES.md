# Third-party notices — ChatGPT Yada 4.1.4

## Vibe Bar

- Repository: https://github.com/AstroQore/vibe-bar
- Commit: `af26391c5bcc074108072af8f2807fc4c47edf21`
- License: AGPL-3.0

The ChatGPT Chat quota core is ported from Swift into `src/quota/vibebar/`. The file mapping and modifications are documented in `NOTICE.md`. The macOS shell and menu-bar UI are not copied.

## @uiw/react-heat-map

- Repository: https://github.com/uiwjs/react-heat-map
- Stable tag: `v2.3.4`
- Commit: `8eb45dff2ec5ce0d317a9094e42afbdb44c10f92`
- License: MIT
- Copyright (c) 2021 uiw

Adapted/ported files: `core/src/SVG.tsx`, `core/src/Day.tsx`, `core/src/Rect.tsx`, `core/src/utils.ts`, and `core/src/style/index.less` into `src/ui/quotaHeatmap.ts`. The port covers direct SVG groups/rects, cell/gap geometry, dynamic-maximum panel thresholds, panel color selection, rect metadata, and hover stroke. Yada fits the grid to its 312px popover, uses CSS theme variables, omits the legend, and implements no React elements.

Not bundled: `@uiw/react-heat-map`, React, ReactDOM, `@uiw/react-tooltip`, calendar navigation, legend components, or any uiw runtime dependency.

## Cal-Heatmap

- Repository: https://github.com/wa0x6e/cal-heatmap
- Latest stable tag: `4.2.4`
- Commit: `815d7440acb40e91f0907f82267d5b8b4dd8ac76`
- License: MIT
- Copyright (c) 2012 Tyler Kellen, contributors

Adapted/ported files: `src/templates/hour.ts`, `src/templates/day.ts`, `src/subDomain/SubDomainPainter.ts`, `src/plugins/Tooltip.ts`, and `src/cal-heatmap.scss` into `src/quota/heatmap.ts` and `src/ui/quotaHeatmap.ts`. The port covers continuous hour/day cell semantics, SVG row/rect positioning, delegated immediate tooltip show/hide, one tooltip root, cleanup, and light/dark presentation. Popper placement is replaced by a small viewport clamp; natural calendar domains are replaced by Yada's next-full-hour rolling rows.

Not bundled: Cal-Heatmap npm runtime, D3, Popper, dayjs, Observable Plot, navigation, animation, plugin system, locale framework, date paging, or legends.

## AI-MarkDone

- Repository: https://github.com/zhaoliangbin42/AI-MarkDone
- Commit: `d6cc562931607f378c48023420f814de1f7c9d60`
- License: MIT

Minimal ChatGPT official Navigator selectors/structure and stable message identity selection are adapted in `src/nativeNavigator/dom.ts`. Reader, bookmarks, annotations, export, Drive, cloud features, other platforms, a custom rail, and private virtualizer logic are not copied.

## GPT Conversation Toolkit

- Repository: https://github.com/bujue3709/GPT-Conversation-Toolkit
- Commit: `ca628eeaed87323c195aa7b6d2750d2804e6ac77`
- License: MIT

Existing full-conversation API and Prompt Library patterns remain. React Fiber graph scanning, private `scrollToIndex`, and its navigator are excluded.

## GPT Navigator Helper

- Repository: https://github.com/sssstf0rest/GPT-Navigator-Helper
- Version: 0.6.4
- Commit: `2ac38de536dacb0ed1ad25c31396fd62a1c49022`
- License status: no project license specified upstream

Reviewed as a behavioral and architectural reference only. No source was copied or bundled because the upstream project has no stated project license.

## MKRingProgressView

- Repository: https://github.com/maxkonovalov/MKRingProgressView
- Commit: `660888aab1d2ab0ed7eb9eb53caec12af4955fa7`
- License: MIT

Visual reference only for three concentric progress rings. No Swift runtime is copied.

## react-activity-rings

- Repository: https://github.com/JonasDoesThings/react-activity-rings
- Commit: `891656158768694a1f327ea5d414085b2819a55f`
- License: MIT

Ring radius, rounded cap, gap, and remaining-percentage ideas were rewritten as TypeScript and OffscreenCanvas. React is not a dependency.

## ai-usage-extension

- Repository: https://github.com/cupcakedev/ai-usage-extension
- Commit: `67e2fdb8d4a69d2dbe5de1a4b86a9f7daf9831e0`
- License: MIT

Reference only for MV3 service-worker icon updates and popup/background synchronization.

## Historical LunaTOC note

LunaTOC Commit `1339969ec25d7c9b63068abd3776ce41780023ed` (MIT) was used by an earlier implementation. Luna virtual search is no longer present in production or tests and is not bundled in 4.1.1.

## Heroicons

- Repository: https://github.com/tailwindlabs/heroicons
- Stable tag: `v2.2.0`
- Commit: `0435d4ca364a608cc75e2f8683d374e55abbae26`
- License: MIT
- Copyright (c) Tailwind Labs, Inc.

A single outline SVG path from `optimized/24/outline/arrow-path.svg` is inlined into `src/ui/quotaIndicator.ts` for the quota-details refresh button. No Heroicons npm package, React, Vue, or icon runtime is installed.

## SortableJS

- Repository: https://github.com/SortableJS/Sortable
- Fixed npm package: `sortablejs@1.15.6` (package-lock.json records the tarball and integrity)
- License: MIT
- Copyright (c) Tailwind Labs, Inc.
Copyright (c) 2019 All contributors to Sortable

Official default ESM entry (`modular/sortable.esm.js`) supplies handle-only prompt reordering and AutoScroll. No framework wrapper, MultiDrag or Swap is bundled. Type declarations: `@types/sortablejs@1.15.8`, development only.

## MIT license text

Copyright (c) 2019 All contributors to Sortable
Copyright (c) 2026 bujue3709
Copyright (c) 2026 zhaoliangbin42
Copyright (c) 2015 Max Konovalov
Copyright (c) JonasDoesThings
Copyright (c) cupcakedev
Copyright (c) 2021 uiw
Copyright (c) 2012 Tyler Kellen, contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
