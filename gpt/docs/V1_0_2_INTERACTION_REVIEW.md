# v1.0.2 Interaction Review

## Summary

v1.0.1 fixed the v1.0 page-pollution failure. It added a Shadow DOM host, a visible right rail, hover preview, copy all, selection copy, and a passing build.

However, manual testing showed that v1.0.1 still feels like a technical demo. The product now needs v1.0.2 interaction completion: toolbar placement, UI host separation, rail state maturity, preview stability, and a complete rail-based selective-copy loop.

## What v1.0.1 Still Lacks

1. Toolbar placement is not natural. It looks like a floating plugin toolbar instead of joining ChatGPT's native top action area.
2. Toolbar, rail, preview, selection menu, route refresh, copy actions, and box selection are still coupled inside `src/rail/rail.ts`.
3. Rail marks are visible but do not yet feel like a mature interactive navigation rail.
4. Hover preview is directionally correct but needs stricter mode behavior, stability, left-of-node positioning, width control, and dark-mode polish.
5. Selection copy has the right primitives but not enough product feedback: selection mode needs to be obvious, selected state must be decisive, and the persistent menu must be anchored to toolbar state.

## UI Layer Problems

- `src/rail/rail.ts` is still a large controller that renders toolbar, menu, rail, preview, selection box, and all styles.
- `src/ui/toolbar.ts` only contains text helpers, not the toolbar view or lifecycle.
- `src/rail/preview.ts` renders preview content and position, but preview styles and hover lifecycle live in `rail.ts`.
- `src/rail/selection.ts` is a useful store, but pointer hit testing and box selection live in `rail.ts`.
- Inline CSS in `rail.ts` is hard to review and hard to align with product states.

## Interaction State Problems

- Navigation mode and selection mode exist but are visually too similar.
- Selection mode can persist through route changes unless explicitly reset.
- Selected state is technically represented but needs stronger product affordance without changing mark size.
- Copy selected uses current in-memory turns, which is acceptable, but it should be tied to current conversation lifecycle and cleared on conversation switch.

## Toolbar Mounting Problems

- Toolbar is currently inside the right fixed rail host.
- This couples toolbar layout to rail geometry and makes the toolbar feel external to ChatGPT.
- v1.0.2 should introduce a separate `yada-toolbar-host`.
- Preferred mount target is ChatGPT's top-right action area, with `#page-header #conversation-header-actions` as the first selector to try.
- If no stable header target exists, fallback should be a very light fixed toolbar near the native header, not in the rail host.

## Rail State Problems

- Idle, hover, active, and selected states need clearer hierarchy.
- In normal mode: idle weak gray, hover soft green, active strong green, click jumps.
- In selection mode: idle weak gray, hover soft green, selected solid green plus small dot, click toggles selection.
- Selected and active must not resize marks.
- The rail must stay transparent and only show short marks, not a scrollbar-like column.
- Rail x-position should prefer the content area's right edge when possible, not blindly hug the browser edge.

## Hover Preview Problems

- Preview must be driven by rail pointer movement and nearest mark calculation, not fragile mark `mouseenter` / `mouseleave` alone.
- Moving between rail and preview should not cause immediate flicker.
- Moving to a new mark must restart the one-second expansion timer.
- Preview should appear to the left of the active mark, be fixed-positioned, viewport-clamped, and avoid pushing deep into body text when there is enough right-side whitespace.
- Labels must be exactly `User:` and `ChatGPT:`.
- Fallbacks must be `[无文字消息]`, `本轮暂无 ChatGPT 回复`, and `未提取到 ChatGPT 摘要`.

## Selective Copy Closure Problems

- The menu must be a toolbar/menu concern, not a rail-layout concern.
- Menu order is fixed:
  1. `已选 N 轮`
  2. `复制选中`
  3. `反选`
  4. `全选`
  5. `取消全选`
  6. `退出选择`
- Menu stays open until `退出选择`.
- Rail clicks, box selection, copy selected, invert, select all, and clear must not close the menu.
- Box selection should start only from the rail empty area, after movement over 5px, with pointer capture and no body text selection.

## Claude Yada Interactions To Keep

- Compact top toolbar cluster.
- Transparent right rail made of short marks.
- Normal mode rail click jumps.
- Selection mode rail click toggles selection.
- Hover preview to the left of marks.
- Default User-only preview.
- Small-dot mode toggle for User + ChatGPT.
- One-second hover expansion.
- Persistent selection menu.
- Single selection and macOS-style box selection.
- Selected state does not resize.
- Placeholder-only attachments.
- Light/dark mode restraint.

## Claude Yada Features To Cut

- Counter.
- Token estimation.
- Quota and usage bars.
- Cache timer.
- Claude API bridge and selectors.
- Claude orange as a direct color.
- JSON/history/batch/ZIP/PDF/PNG export.
- Options/popup language settings.
- Prompt Library.
- FolderManager.
- FloatBall.
- WidthPanel.
- Reader.

## AI-MarkDone Logic To Borrow

- Idempotent Shadow DOM host creation and cleanup.
- Separate host/portal thinking for rail, preview, and header controls.
- Header mount target reference: `#page-header #conversation-header-actions`.
- Body MutationObserver used only as a debounced remount/scan trigger.
- Route watcher using polling plus `popstate` / `hashchange`.
- Scan scheduler with debounce/min interval/max wait.
- Rail mark state driven by data attributes.
- Preview placement based on mark rect with viewport clamp.
- Theme tokens isolated to extension UI.

## Current v1.0.1 Code To Keep

- Data and export layer:
  - `src/conversation/*`
  - `src/export/*`
  - `src/platform/chatgptAdapter.ts`
  - `src/utils/*`
- Selection store direction:
  - `src/rail/selection.ts` already stores selected turn ids.
- Active/scroll helpers:
  - `src/rail/active.ts` can be kept and refined.
- Theme detector:
  - `src/ui/theme.ts` can be kept.

## Current v1.0.1 Code To Change

- `src/content.ts`: become bootstrap/lifecycle, not just `mountYadaRail()`.
- `src/ui/toolbar.ts`: become real toolbar host/controller/view.
- `src/ui/menu.ts`: add selection menu view/controller.
- `src/rail/rail.ts`: shrink to rail host, marks, navigation, active/hover rendering, and rail event routing.
- `src/rail/preview.ts`: own fixed preview host and lifecycle helpers.
- `src/rail/selection.ts`: keep store, add lifecycle reset on conversation changes if needed.
- `src/styles.ts`: expand shared tokens and host ids.

## v1.0.2 Implementation Direction

1. Add a content lifecycle controller that coordinates toolbar, rail, preview, selection store, route refresh, and scan scheduling.
2. Split hosts:
   - `yada-toolbar-host`
   - `yada-rail-host`
   - `yada-preview-host`
3. Mount toolbar inline into ChatGPT header actions when possible, fallback to a light fixed toolbar.
4. Keep rail as a transparent right-side navigation host only.
5. Keep preview as a fixed host positioned by rail mark rect.
6. Keep selection menu attached to toolbar state.
7. Reset selection/preview/hover when conversation id changes.
8. Keep copy logic API-first and avoid any forbidden reference features.

## Stage Self-Check

- Change summary: documented the v1.0.2 interaction gaps and the implementation direction.
- Verification checklist: startup documents were read; reference exists and remains read-only; subagents completed read-only audits.
- Known gaps or risks: ChatGPT header selectors may drift, so toolbar needs a fixed fallback.
- `reference/` modification status: no reference files were modified.
