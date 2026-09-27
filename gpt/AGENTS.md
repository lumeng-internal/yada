# ChatGPT Yada Agent Guide

Read this file before every work session in `gpt/`.

## Product contract

Current version is **4.1.5**. Candidate work lives on `work/gpt-yada-native-compat`, not `main`. `main` is not the in-use candidate.

Yada is a single ChatGPT plugin. The right side uses only ChatGPT's official Prompt Navigator. Long conversations should cause that official navigator to appear and cover the history that should be shown; clicks keep official behavior. Do not restore a Yada rail, green mode dots, hover previews, proxy clicks, or a custom scroll engine.

The page toolbar contains only: Pro quota rings, Copy All, Prompt Library. It uses a page-level independent host and Shadow DOM, positioned with `@floating-ui/dom` to the left of the native header action group. It must not cover Share, More, or other native actions. Do not insert the toolbar into ChatGPT's React header tree, and do not use the old inline/fixed `right:88px` fallback.

Runtime is subtractive: BOOT work may use CPU/network; STEADY must sleep; heavy Prompt/Quota UI is ON-DEMAND.

## Page recognition

`src/platform/pageFacts.ts` (re-exported from `chatgptAdapter.ts`) is the single source of ChatGPT page facts:

- current conversation identity
- generating vs completed stable message identity
- actual message and scroll containers
- official navigator location, visibility, and readable indexes
- top native action group

Old and new ChatGPT structures adapt here. Other modules must not keep a second set of role, generation, or message-container selectors.

Role clues (H4, accessible names) are not message identity. Dedup and completion use the owning container's stable id. Virtual remount of the same id is not a new answer. Regeneration and branch switches keep existing ConversationSync merge semantics; do not swallow them with a permanent cross-conversation seen-id set.

Generation state comes from this module (stop-button and streaming attributes). Missing an old attribute is not "the answer finished". Do not parse chat bodies to guess generation.

Scrollers are identified by message ancestry, layout, and actual scroll ability. `overflow-anchor: none` and negative `scrollTop` are not vetoes. Reading-position protection uses the same stable message's screen position.

Page facts do not download chats, store bodies, compute quota, or own a second conversation store.

URL helpers in `conversationUrl.ts` are DOM-free and shared by MAIN and isolated worlds. Do not pack toolbar/UI into the MAIN hook.

## Official navigator

Keep the thin MAIN fetch wrapper: current-conversation history GET signals and the existing initial `num_turns` boost. Do not clone or parse history bodies. Do not treat Yada's own API download as proof that ChatGPT's page consumed history.

Distinguish three facts:

- official navigator available
- official navigator proven complete
- Yada currently preparing

Example: API 89 turns, official 88 items is a mismatch, not completeness, and not an infinite retry. Do not hard-code minus one. If the official navigator exists while the API count fails, keep the native navigator usable.

`isMaintenanceBlocked()` is true only while a prepare operation is actually running. Waiting, observing, or sleeping must not block quota history maintenance. Success, failure, cancel, hidden, route change, and dispose must release heavy observers, prepare heartbeat, sentinel styles, timers, input guards, and busy flags through the hydrator cleanup exits.

Waiting for a late page may use bounded local discovery on the conversation surface (or `document.body` childList until `main` exists). After stopping, resume only on new page evidence, route change, visibility, or a real host request. Do not treat heartbeat, repeated snapshots, or the same invalid state as endless recovery. Do not hide recognition bugs by raising 60s / 20 pages / 3 recoveries.

If the initial host request already makes the official navigator complete, stop preparing. If history is still missing, only the current host pagination sentinel path may be used, and only after it is shown to trigger the correct history request, the host consumes the result, and the page actually progresses. Empty `?message=` is an AI-MarkDone user refresh action; it must not be Yada's default auto-reload, and must not reload a page the user is reading, typing, or generating on.

Do not restore React Fiber scanning, private virtualizer calls, custom long-distance scrolling, official-button proxy clicks, or stacked fallback preparers. Old and new page shapes pick one adapter; they must not run two preparers on the same page.

Until a real ChatGPT page proves ChatGPT itself loaded history → official navigator appeared → range verified, treat official-navigator auto-restore as **unfinished / unverified**. Local tests passing is not that proof.

## Architecture

- `ConversationSync`: the only complete current-conversation truth for Copy All, current-conversation quota turns, and Navigator `expectedPrompts`. Ordinary new answers use one recent tail read; full pagination is reserved for the first snapshot, Copy All, manual refresh, and unsafe merges. Mutation batches coalesce for 250ms. Listeners do not block each other. Observe the conversation surface when it exists; rebind when that root is replaced.
- `nativeNavigator/mainHook.ts`: thin document-start MAIN-world fetch wrapper for route events, bounded prepare lease, `num_turns` boost, and request lifecycle signals; it never reads a history response body and has no `chrome.*` API.
- `nativeNavigator/hydrator.ts`: isolated official-UI loader. It exposes the host pagination sentinel, compares official DOM count with ConversationSync, sleeps on transient unavailability, and parks heavy work after two stable matching checks. Waiting is not preparing.
- `ui/toolbar.ts` + `ui/toolbarPlacement.ts`: independent toolbar host; Floating UI `computePosition` / `autoUpdate` (`animationFrame: false`). Prompt and quota popovers keep their own hosts.
- `quota/vibebar/*`: authoritative quota parsing and allowance rules.
- `QuotaTracker`: live ledger delta + last-known-good baseline. Automatic history maintenance is at most one bounded slice, not a 10-minute full scan; a trusted baseline waits 24 hours and then checks non-archived revisions only. Full repair (normal + archived) is for the first baseline, account change, schema damage, or manual refresh. A due timer waits until the work is due; an idle callback then takes one page-idle chance. Maintenance stays off while BootGate is still waiting for or running the first Full, ConversationSync is reading, or the navigator is actually preparing. Web Locks keep a single tab in a slice; a busy lock retries after 60 seconds without dropping a manual full. Hidden cancels a slice that has not started.
- `QuotaSnapshot`: the single source for Action rings, toolbar rings, inline details, and popup.
- Inline quota refresh: the details heading hosts a 16px Heroicons `arrow-path` button. It calls `QuotaTracker.refreshCurrentLight()`, which prefers a current-conversation Recent read, does one Full fallback only when the snapshot is no longer usable, waits for ledger ingest, and may schedule one idle history-repair slice. It does not use Popup `quota/refresh-current`.
- `quota/heatmap.ts` + `ui/quotaHeatmap.ts`: on-demand, ledger-only rolling-hour aggregation and direct SVG rendering. No heatmap work runs until quota details open; close removes the SVG, shared tooltip, delegated listeners, and hour-boundary timeout.

Do not casually rewrite quota rules, history cache, session pagination, or prompt storage.

## Runtime rules for new work

任何新模块必须优先：

- event-driven
- complete-and-sleep

禁止重新加入：

- per-frame polling
- whole-body permanent observer
- duplicate cross-tab history scan
- 复杂多标签调度框架、性能设置页、云端或 telemetry

Route 变化只走已有 MAIN `postMessage`。不要新增 `chrome.webNavigation` / tabs 轮询。

Navigator 长期原则：

1. 一个 conversation 只能有一个完整数据真相来源：`ConversationSync`。
2. MAIN world 不解析完整 ChatGPT history response body。
3. Navigator 不重建 ConversationSync 已经拥有的数据。
4. transient unavailable 不等于 terminal。
5. success 后 complete-and-sleep。
6. 失败恢复必须事件驱动，不使用固定轮询。
7. waiting 不等于 preparing；只有实际准备任务才允许短暂挡住额度维护。

## Required safety boundaries

- Preserve the exact original fetch Promise/Response. MAIN may observe fulfillment status and timing but must never clone, read, decode, or parse a history response body.
- Never bridge or persist message bodies, auth data, Cookie, Token, or full payloads.
- Never scroll, restore-scroll, reload, rewrite a deep link, or manipulate ChatGPT's official Navigator UI.
- Stop on uncertainty, user input, drift over 8px, unstable layout, streaming, hidden page, route change, or budget exhaustion.
- Do not add React/Vue, Fiber scanning, private virtualizer calls, debugger/webRequest/cookies permissions, a second extension, analytics, or external services.
- Do not modify `claude/` or `gemini/`, push `main`, force push, open PRs, run hosted CI, or create Releases.

## Verification contract

The engineering closeout gate is:

```bash
npm test
npm run verify:copy
npm run build
npm run verify:gate
git diff --check
```

Do not create test conversations or consume Pro quota. Do not treat Mac mini meeting Chrome, a test Chrome profile, or a mocked page as Harson's real Edge.

If an already-authorized MacBook connection exists, reuse it in the same task to read the real Edge page and re-verify after the change. Keep the loaded extension directory and extension identity unchanged. Do not restart the whole browser, bulk-refresh or close the user's 10–15 tabs, auto-send chats, click Share to publish, or install a second navigator plugin. Do not copy cookies or full user profiles.

If that connection is missing, record the actual failed step, finish engineering delivery, and mark remaining real-page checks in `QA.md`. Do not block the whole task on Harson.

Real layout, click occlusion, and official-navigator auto-restore require a browser. jsdom rectangles are not that proof.

## Upstream boundaries

- Vibe Bar `af26391c5bcc074108072af8f2807fc4c47edf21`, AGPL-3.0: quota source of truth.
- AI-MarkDone `8269364d7162712d1eb45a27937e00116f8e1ca7`, MIT: new-structure message identity, generation evidence, official navigator structure, and page adapters actually used this round. Reader, bookmarks, Fiber, and virtualizer code are not copied.
- GPT Conversation Toolkit `ca628eeaed87323c195aa7b6d2750d2804e6ac77`, MIT: existing conversation API and prompt library patterns remain; no Fiber virtualizer code.
- GPT Navigator Helper `2ac38de536dacb0ed1ad25c31396fd62a1c49022`, no project license: behavioral reference only; no source copied.
- Cal-Heatmap `4.2.4` / `815d7440acb40e91f0907f82267d5b8b4dd8ac76`, MIT: rolling hour/day cell semantics and delegated tooltip lifecycle are narrowly adapted; D3, Popper and dayjs are not bundled.
- `@uiw/react-heat-map` `v2.3.4` / `8eb45dff2ec5ce0d317a9094e42afbdb44c10f92`, MIT: SVG rect grid, spacing, dynamic panel thresholds and hover contract are ported without React/ReactDOM.
- `@floating-ui/dom` `1.8.0` (with `@floating-ui/core` 1.8.0 and `@floating-ui/utils` 0.2.12), MIT: toolbar `computePosition` / `autoUpdate` only. No React/Vue, no WXT migration.

`gpt/` remains AGPL-3.0-only. Keep `NOTICE.md` and `THIRD_PARTY_NOTICES.md` accurate when upstream-derived code changes.

## Versioning and test packages

任何进入测试包的产品代码变化必须 bump version。产品行为、代码逻辑、UI 功能或 bugfix 均属于此规则；禁止代码更新而 manifest/package 版本不变。

- PATCH：bugfix、小功能、小交互优化、运行生命周期收口；例如 4.1.4 → 4.1.5。
- MINOR：新增完整功能模块；例如 4.0.x → 4.1.0。
- MAJOR：架构兼容性变化或产品方向重大变化。
- package、lockfile、source manifest、dist manifest、ZIP 文件名必须一致；`npm run package` 强制检查，拒绝覆盖已有版本包。
- 固定依赖与 lockfile；SortableJS 1.15.6（MIT）使用官方默认 ESM（包含 AutoScroll），不实现自有拖拽状态机。`@floating-ui/dom` 锁定 1.8.0。
- `historyComplete=true` 不因刷新开始、reload 或失败降级；只有账号变化、存储丢失/损坏或不兼容 schema 才能使 baseline 失效。
- 本地固定验证：`npm test`、`npm run verify:copy`、`npm run build`、`npm run verify:gate`、`git diff --check`，之后 `npm run package`。
- `HOSTED_CI = DISABLED_BY_OWNER_NO_QUOTA`，含义为 `NOT_USED_BY_POLICY`；不属于 PASS、FAILURE 或 Release Authority。本分支仅测试包交付，不执行 PR、merge、Release 或部署阶段。
- 安装和验收必须写明候选分支、提交和 ZIP。不要只写“更新到最新版”，以免 MacBook 拉到旧 `main`。
