# v1.1.1 Rail Reliability Review

## Current Failure Evidence

Real Chrome debug evidence:

- `turnsLength=86`
- `apiTurnsLength=86`
- `source="api-full"` / `turnsSource="api-full"`
- `lastStableTurnsLength=86`
- `domTurnsLength=0`
- `activeIndex=-1`
- `activeReason="none"`
- `visibleTurnIndexes=[]`
- `candidateDistances=[]`
- `geometry.scrollRootType="window"`
- `firstMarkRects width=100 height=7`
- `railRuntime.jumpTargetIndex=null`
- `railRuntime.jumpAnchorExists=null`
- `railRuntime.jumpAttempts=null`
- `TypeError: Cannot read properties of undefined (reading 'getAttribute')` from the content script

These facts mean the API data path is healthy, but the rendered ChatGPT DOM anchor path is not. The rail can show 86 marks from API data, yet active detection and jump cannot map those marks to connected DOM anchors.

`domTurnsLength=0`, `activeIndex=-1`, and empty visible candidates indicate current ChatGPT message DOM is not being recognized by the runtime collector. With no anchors, clicking a rail mark can only do estimated scrolling, active state cannot follow the viewport, and debug cannot explain the click path.

`scrollRootType=window` is suspicious for long ChatGPT conversations because the page commonly uses an internal scroll container. Scrolling `window` can leave the real conversation viewport unchanged.

`firstMarkRects width=100 height=7` shows the outer mark button is much wider than the visible bar. Hover/click must be calculated from `.mark-bar`, not from the whole 100px row, or the user sees mouse/highlight drift.

`jumpTargetIndex=null` and related null fields show that the debug snapshot only reports the last stored jump result, not whether a click was received or routed to jump/select/ignore. v1.1.1 needs click-specific debug.

The `getAttribute` crash is P0 because one unguarded DOM read can interrupt initialization, collection, or event binding.

## Priority

P0:

- Fix the `getAttribute` crash and add content-script error boundaries.
- Rework ChatGPT rendered DOM anchor collection so visible user turns are detected.
- Rework scrollRoot selection so `window` is a verified fallback, not the default.
- Make rail click jump observable and reliable with anchor resolve, progressive probing, and realignment.

P1:

- Rework hover/click hit testing around `.mark-bar`.
- Rework lasso into a macOS-style pending click / marquee drag model.
- Make turn numbers obvious on hover/active/selected and add `第 N 轮` to preview.

## Current Code To Keep

- API full turns remain the trusted data source for copy and full conversation count.
- `cached-api-full` / `dom-partial` source priority remains correct.
- `scripts/release.mjs` and `npm run release:*` are retained.
- Toolbar placement and copy button state are retained.
- Copy-all, copy-selected, Markdown formatting, attachment placeholders, and conversation API normalization are retained.
- Rail host, transparent marks, preview host, and selection store are retained.

## Current Code To Rework

- `src/conversation/domCollector.ts`: layered ChatGPT anchor scan, safe DOM reads, anchor metadata, and API/DOM binding.
- `src/conversation/types.ts`: add optional DOM anchor metadata and group elements.
- `src/rail/active.ts`: stronger scrollRoot resolver, root-relative active state, precise scroll, progressive jump, and jump debug.
- `src/rail/rail.ts`: click-specific debug, bar-centered hit testing, lasso state machine, and stronger index display.
- `src/rail/preview.ts`: explicit `第 N 轮` preview title.
- `src/content.ts`: local error boundaries, anchor-only rebinding for stable API turns, richer debug snapshot.
- `src/scout/chatgptDomScout.ts`: safe DOM reads and selector alignment with runtime collector.

## Reference Intake

AI-MarkDone:

- Source paths read: `reference/AI-MarkDone-main/src/ui/content/chatgptDirectory/navigation.ts`, `reference/AI-MarkDone-main/src/drivers/content/conversation/collectConversationTurnRefs.ts`, `reference/AI-MarkDone-main/src/drivers/content/conversation/navigation.ts`, `reference/AI-MarkDone-main/src/drivers/content/chatgpt/domConversationDiscovery.ts`, and controller/adapter files.
- Needed behavior: layered ChatGPT round position discovery, user-root jump anchors, grouped user/assistant elements, scroll then wait for layout stability and realign.
- Smaller local implementation is enough because GPT Yada does not need AI-MarkDone settings, bookmarks, directory panel, exports, adapters, or React-like architecture.
- Simplified: implement only anchor collection, binding hints, jump realign, and debug events.
- License/attribution: reference remains read-only; no module is copied wholesale.

ophel:

- Source paths read: `reference/ophel-main/src/adapters/chatgpt.ts`, `reference/ophel-main/src/adapters/base.ts`, `reference/ophel-main/src/core/outline-manager.ts`, `reference/ophel-main/src/components/OutlineTab.tsx`, and `reference/ophel-main/src/utils/scroll-helper.ts`.
- Needed behavior: ChatGPT scroll container selection and stale-anchor re-resolve before scroll.
- Smaller local implementation is enough because GPT Yada needs only a scored scrollRoot resolver, not ophel's outline system or multi-platform helpers.
- Simplified: prefer conversation-nearest scrollable ancestors and only fall back to `window` when verified.
- License/attribution: reference remains read-only; no module is copied wholesale.

Claude Yada:

- Source paths read: bundled Claude Yada content assets and CSS under `reference/Claude-Yada-v1.0.0/assets/`.
- Needed behavior: macOS-style pending click / marquee selection, node layouts with visual rects, global pointer capture cleanup, and preview turn number.
- Smaller local implementation is enough because GPT Yada already has a selection store and rail; only the interaction model is needed.
- Simplified: keep rail-based selection only, no Claude DOM selectors, Counter, token, quota, or export extras.
- License/attribution: reference remains read-only; no module is copied wholesale.

chatgpt-exporter:

- Source role: current conversation API trust boundary, `mapping`, `current_node`, and API full turns.
- Needed behavior: preserve API full turns as canonical copy data and do not let DOM partial data replace full API data.
- Simplified: no batch export, no extra formats, no historical export UI.

## Implementation Plan

1. Add safe DOM helpers and error-boundary debug so one DOM scan failure cannot stop rail/toolbar/click binding.
2. Replace single-selector DOM collection with layered rendered turn anchor scanning:
   - conversation wrappers and `data-testid*="conversation-turn"` first,
   - `data-turn-id` / `data-turn-id-container`,
   - role-node pairing fallback,
   - text fingerprint fallback,
   - safe visible-order binding for partial rendered subsets.
3. Replace scrollRoot detection with scored ChatGPT container selection and root-relative viewport metrics.
4. Rework jump to record click, resolve/rebind anchor, precise-scroll, wait for layout quiet, realign, then progressive search if the target anchor is not rendered.
5. Rework active detection against rendered anchor/group ranges and a stable reading line.
6. Rework hit testing from measured bar layouts, not the 100px outer button.
7. Rework lasso to pending click / pending marquee / dragging marquee with window capture listeners and unified cleanup.
8. Add explicit turn number title in preview and stronger rail index display.
9. Update debug, docs, build, then run `npm run release:patch` to ship `1.1.1`.

## Stage Self-Check

- Change summary: documented the v1.1.1 failure evidence, priorities, keep/rework boundaries, and reference intake before source edits.
- Verification checklist: startup docs, current source, and required references were read; subagents completed read-only audits for current code, AI-MarkDone, ophel, Claude Yada, and release safety.
- Known gaps or risks: live ChatGPT/Edge validation still requires a logged-in browser session after build.
- `reference/` modification status: no reference files were modified; `reference/归档.zip` remains untracked and untouched.
