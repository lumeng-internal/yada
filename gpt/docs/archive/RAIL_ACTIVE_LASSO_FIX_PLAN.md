# Rail Active And Lasso Fix Plan

## Version

Target release: `v1.1.2`

Release type: `PATCH`

Reason: this is a bugfix for active round mapping and lasso selection ergonomics. It is not a new feature module, architecture rewrite, or compatibility break.

## Modules To Change

- `src/conversation/types.ts`
- `src/conversation/domCollector.ts`
- `src/rail/active.ts`
- `src/rail/rail.ts`
- `src/rail/preview.ts` only if display-number plumbing is needed
- `src/content.ts` for debug snapshot fields
- `docs/TEST_CHECKLIST.md`
- `docs/FINAL_REPORT.md`
- `README.md`
- `CHANGELOG.md`

## Modules Not To Change

- `reference/`
- copy-all logic
- selected-copy Markdown formatting
- attachment recognition behavior
- toolbar placement
- release script mechanism
- manifest permissions except version updates through release automation

## Active Mapping Plan

1. Treat the API/cached full turns array as the canonical rail order.
2. Preserve global indexes when turns are normalized and rendered.
3. Add explicit per-turn debug metadata:
   - `globalIndex`
   - `displayNumber`
   - `renderedLocalIndex`
   - `anchorMappingReason`
   - `anchorMappingTrusted`
4. Build DOM-anchor maps by message id, turn DOM id, and unique user fingerprint.
5. Use full index fallback only when DOM turn count equals full turn count.
6. Remove partial scroll-ratio index fallback as a direct active/jump binding source.
7. Allow estimated partial mapping only as debug context, not as a trusted active anchor.
8. Update active state to expose:
   - active global index and display number
   - rendered local index
   - mapping reason
   - visible rendered anchors
   - scrollRoot metrics and bottom detection
   - candidate top/bottom ranges
9. Fix active rendering so a re-render reapplies `data-active` even if the numeric index did not change.
10. Keep rail click target indexes global. Before direct-anchor jump, rely only on trusted anchor bindings.

## Active Selection Rule

Use a root-relative reference line and full group ranges:

1. Compute the scroll root viewport.
2. Use a reference line around 35% of that viewport.
3. Prefer a rendered, trusted anchor whose grouped range contains the line.
4. Otherwise choose the nearest trusted rendered anchor.
5. If near bottom and no better candidate exists, use the nearest trusted visible bottom candidate.
6. If no trusted visible anchor exists, keep no active mark rather than lighting a wrong local-index mark.

## Lasso Plan

1. Keep hover hit testing narrow around the mark bar.
2. Keep click hit testing wider than hover but still mark-based.
3. Add a separate lasso start zone that is active only in selection mode.
4. Compute lasso zone from mark list geometry:
   - extend left of the rail marks by roughly 220px
   - extend right to the viewport edge
   - cover the visible mark list vertical range with a small vertical pad
5. Make the rail host wide only in selection mode so the transparent start zone can actually receive `pointerdown`.
6. Keep ordinary mode `pointer-events` narrow enough that page text selection is unaffected.
7. On pointerdown:
   - click zone starts a pending mark toggle
   - lasso zone starts pending marquee
   - outside both zones is ignored without `preventDefault`
8. Pointer movement over 5px enters marquee drag.
9. `pointermove`, `pointerup`, and `pointercancel` remain captured on `window`.
10. Pointerup applies the box toggle once and keeps the selection menu open.
11. Exit or blur cleans the selection box and releases capture.

## Debug Plan

When `localStorage.chatgpt-yada-debug` is `1`, snapshots should expose:

- active index/display number/reason
- rendered local index
- global index
- mapping reason and trust
- visible rendered anchors
- full/API/DOM turn lengths
- scrollRoot type, top, height, bottom state
- candidate top/bottom ranges
- rail mark count, hover index, selected indexes
- click target index and hit-test zone details
- lasso start-zone rect, pointerdown zone booleans, drag box, preview indexes, applied indexes, cancel reason

## Manual Acceptance

- At the bottom of a 70+ turn conversation, active is near the bottom, not a historical upper mark.
- At manually verified round 37, rail active is round 37.
- Hover and preview show global `第 N 轮`.
- Clicking rail mark `N` targets full turn `N`.
- Selection mode can start a lasso from the rail-side area to the right, without needing to hit the short bar.
- Ordinary mode does not interfere with ChatGPT text selection.
- Build passes.
- `npm run release:patch` creates `ChatGPT-Yada-v1.1.2-dist_chrome.zip`.
- `reference/` is unmodified.

## v1.1.3 Rail Visual Layer Plan

Target release: `v1.1.3`

Release type: `PATCH`

Reason: this is a visual/interaction bugfix for selection-mode rail overlap. It does not change copy-all, selected-copy Markdown, attachment summaries, API conversation loading, active mapping, jump behavior, or release automation.

### Modules To Change

- `src/rail/rail.ts`
- `src/content.ts`
- `docs/RAIL_ACTIVE_LASSO_POSTMORTEM.md`
- `docs/RAIL_ACTIVE_LASSO_FIX_PLAN.md`
- `docs/TEST_CHECKLIST.md`
- `docs/FINAL_REPORT.md`

### Modules Not To Change

- `reference/`
- copy-all logic
- selected-copy Markdown formatting
- attachment recognition behavior
- API conversation fetching
- active/jump mapping
- toolbar placement
- manifest permissions except version updates through release automation

### Implementation Plan

1. Split the rail into a transparent `.lasso-hit-zone` and a fixed-width visual `.zone` / `.marks` layer.
2. Keep the visual rail right-aligned and fixed at `--yada-rail-width`.
3. Allow selection mode to widen the host/hit area only for transparent pointer capture.
4. Remove selection-mode persistent major index labels.
5. Keep index labels visible only for hover, active, selected, and box-preview states.
6. Bind hover/click events to the mark layer so preview remains narrow.
7. Bind lasso pointerdown to the transparent hit-zone and the mark layer.
8. Measure the real lasso hit-zone DOM rect for pointerdown/debug instead of relying only on computed mark geometry.
9. Add debug audit fields for host/layer/index counts and first bar/index rects.

### Manual Acceptance

- Selection mode still allows lasso drag start from the rail-side transparent area.
- The right rail always appears as one column of quiet short bars.
- No middle column of persistent major index numbers appears in selection mode.
- Hover still shows the current round number and preview.
- Active, selected, and box-preview states may show numbers.
- Mouse movement far from the bar column does not trigger hover preview.
- The selection menu remains open through lasso interactions.
- `reference/` remains unmodified.
