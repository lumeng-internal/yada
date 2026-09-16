# Rail Active And Lasso Postmortem

## Scope

This postmortem covers the v1.1.2 PATCH repair for three manual-test failures:

1. The page was already at the bottom, but an upper historical rail mark such as round 17 stayed active.
2. Manual inspection showed the page was at round 37, but the rail active mark was not round 37.
3. Selection lasso existed, but the drag start area was too narrow.

This is not a product-scope change. Copy-all, selected-copy Markdown, attachment recognition, toolbar placement, preview mode, release scripts, and `reference/` stay outside the code-change scope.

## BUG1 / BUG2 Root Cause

The active mark is not a CSS state problem. A CSS-only fix would make the wrong mark more or less visible, but it would not change which conversation round is considered current.

The active chain is:

1. Full conversation turns provide the rail list.
2. Current ChatGPT DOM provides only the rendered anchors available near the viewport.
3. Active detection chooses a rendered anchor from viewport geometry.
4. The rail must highlight the full-turn global index for that rendered anchor.

The failure occurs when step 3 produces an anchor whose index came from the rendered DOM slice instead of from the full turns array. ChatGPT can unmount large parts of long conversations, so the first rendered user node might be global round 37 while its DOM local index is 0. Treating the DOM local index as the rail index can light an old mark or a nearby but wrong mark.

The risky paths before this repair were:

- DOM-only turns are created from the current rendered order.
- DOM refresh can estimate visible global indexes from scroll ratio when message ids and fingerprints do not match.
- Active state trusts `turn.index` once anchors are attached.
- Debug output did not clearly distinguish rendered local index, global index, and mapping reason.

The correct invariant is:

```ts
activeIndex = renderedAnchor.globalIndex;
displayNumber = renderedAnchor.globalIndex + 1;
```

`renderedLocalIndex`, DOM collection order, and current visible-anchor array indexes are debug-only values. They must not become the rail active index unless the full DOM is known to cover all turns.

## BUG3 Root Cause

The lasso bug is also not a mark style problem. The current lasso start zone is computed around mark bars, but the pointerdown listener only receives events inside the rail host. The host is narrow and the visual bar is already near its right edge, so a user moving slightly away from the short green marks falls outside the effective start area.

Hover, click, and lasso start have different interaction goals:

- Hover should be narrow to avoid accidental preview.
- Click should be slightly wider to make rail marks usable.
- Lasso start should be wide, but only while selection mode is active.

Mixing these zones forces a bad compromise: widening hover causes preview noise, while narrowing lasso makes marquee selection unusable.

## Reference Findings

AI-MarkDone uses a round-position layer with `jumpAnchor` and grouped DOM elements. Its active state is chosen by a viewport reference line against the full group top/bottom range, then mapped back to the round position.

ophel treats ChatGPT DOM anchors as volatile. It resolves `data-turn-id` / `data-turn-id-container`, checks stale DOM references, and reparses anchors after scroll or route changes.

Claude Yada keeps marquee selection as a separate interaction from hover and click. Selection mode enables a wider transparent start area while ordinary mode keeps the page text-selectable.

No reference module is copied wholesale. The repair uses the same lightweight local architecture.

## Required Invariants

- Rail mark `N` corresponds to `turns[N - 1]`.
- Full turns keep stable zero-based global indexes.
- Rendered DOM anchors can carry local order for debug, but not for rail identity.
- Active, hover number, selected state, preview title, and click target all display global round numbers.
- Index fallback is allowed only when the rendered DOM covers the full turns list.
- Estimated partial-DOM mapping is low trust and must be visible in debug.
- Bottom-of-page active state cannot remain pinned to an upper historical rendered-local index.
- Selection-mode lasso can start from a wide rail-side zone.
- Ordinary mode does not intercept page text selection.
- `reference/` remains read-only.

## v1.1.3 Visual Rail / Lasso Layer Root Cause

The v1.1.2 lasso repair widened the rail host in selection mode so the lasso could receive pointer events, but the visible rail and the transparent lasso start area still shared the same `.zone` / `.marks` interaction layer. At the same time, selection mode forced every major index label to stay visible:

```css
:host([data-selection-mode="true"]) .mark[data-major-index="true"] .mark-index
```

On long conversations this created a second visible vertical rhythm of numbers beside the short bars. The DOM host count was still expected (`toolbar`, `menu`, `rail`, `preview`), so the symptom was not a duplicate extension instance. It was one rail host drawing too much inside its own widened selection-mode area.

The corrected invariant is:

```text
visible rail layer = one fixed right-aligned mark column
selection lasso layer = transparent hit zone only
```

Hover and click remain mark-based. Selection mode may expand pointer capture width, but that expansion must not add visible rails, visible panels, persistent major index labels, borders, shadows, or backgrounds.

## v1.1.3 Repair

- `.lasso-hit-zone` is a separate transparent layer used only for selection-mode drag starts.
- `.zone` and `.marks` remain the only visual rail layer and stay right-aligned at the fixed rail width.
- Major index labels no longer stay visible merely because selection mode is active.
- Index labels show only for hover, active, selected, or box-preview states.
- Lasso debug now records the real lasso hit-zone rect, visual rail rect, marks rect, host rect, layer counts, visible index counts, and whether the pointer down happened in the transparent lasso zone or the visual rail.
- Debug snapshots now include a rail visual audit to make duplicate host/layer/index visibility problems inspectable.

## v1.1.3 Non-Causes

The ChatGPT page can emit React hydration errors such as React `#418` from ChatGPT-owned chunks. That is not treated as the cause of this extension-specific rail overlap issue unless future evidence points to extension DOM mutation inside React-owned message bodies.
