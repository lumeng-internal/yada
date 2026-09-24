# ChatGPT Yada Agent Guide

Read this file before every work session in `gpt/`.

## Product contract

Current version is **4.1.3**. Yada restores and preserves ChatGPT's native long-conversation Prompt Navigator by completing host history loading without moving the reader's position.

The page toolbar contains only: Pro quota rings, Copy All, Prompt Library. There is no Yada rail, navigation preview, green mode dot, direct jump, official-button proxy, stable-slot jump, `?message=` preparation, official-nav hiding, or fallback navigator.

Runtime is subtractive: BOOT work may use CPU/network; STEADY must sleep; heavy Prompt/Quota UI is ON-DEMAND.

## Architecture

- `ConversationSync`: the only complete current-conversation truth for Copy All, current-conversation quota turns, and Navigator `expectedPrompts`. Ordinary new answers use one recent tail read; full pagination is reserved for the first snapshot, Copy All, manual refresh, and unsafe merges. Mutation batches coalesce for 250ms. Listeners do not block each other.
- `nativeNavigator/mainHook.ts`: thin document-start MAIN-world fetch wrapper for route events, bounded prepare lease, `num_turns` boost, and request lifecycle signals; it never reads a history response body and has no `chrome.*` API.
- `nativeNavigator/hydrator.ts`: isolated official-UI loader. It exposes the host pagination sentinel, compares official DOM count with ConversationSync, sleeps on transient unavailability, and parks heavy work after two stable matching checks.
- `quota/vibebar/*`: authoritative quota parsing and allowance rules.
- `QuotaTracker`: live ledger delta + last-known-good baseline. Automatic history maintenance is at most one bounded slice, not a 10-minute full scan; a trusted baseline waits 24 hours and then checks non-archived revisions only. Full repair (normal + archived) is for the first baseline, account change, schema damage, or manual refresh. A due timer waits until the work is due; an idle callback then takes one page-idle chance. Maintenance stays off while BootGate is still waiting for or running the first Full, or ConversationSync is reading. Web Locks keep a single tab in a slice; a busy lock retries after 60 seconds without dropping a manual full. Hidden cancels a slice that has not started.
- `QuotaSnapshot`: the single source for Action rings, toolbar rings, inline details, and popup.
- `quota/heatmap.ts` + `ui/quotaHeatmap.ts`: on-demand, ledger-only rolling-hour aggregation and direct SVG rendering. No heatmap work runs until quota details open; close removes the SVG, shared tooltip, delegated listeners, and hour-boundary timeout.

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
npm run build
git diff --check
npm run verify:gate
```

Do not run candidate/Playwright/Mac mini ChatGPT acceptance, create test conversations, or consume Pro quota. Real 10–15 tab product acceptance remains a MacBook manual task.

## Upstream boundaries

- Vibe Bar `af26391c5bcc074108072af8f2807fc4c47edf21`, AGPL-3.0: quota source of truth.
- AI-MarkDone `d6cc562931607f378c48023420f814de1f7c9d60`, MIT: minimal official navigator selectors/structure and stable message identity are adapted.
- GPT Conversation Toolkit `ca628eeaed87323c195aa7b6d2750d2804e6ac77`, MIT: existing conversation API and prompt library patterns remain; no Fiber virtualizer code.
- GPT Navigator Helper `2ac38de536dacb0ed1ad25c31396fd62a1c49022`, no project license: behavioral reference only; no source copied.
- Cal-Heatmap `4.2.4` / `815d7440acb40e91f0907f82267d5b8b4dd8ac76`, MIT: rolling hour/day cell semantics and delegated tooltip lifecycle are narrowly adapted; D3, Popper and dayjs are not bundled.
- `@uiw/react-heat-map` `v2.3.4` / `8eb45dff2ec5ce0d317a9094e42afbdb44c10f92`, MIT: SVG rect grid, spacing, dynamic panel thresholds and hover contract are ported without React/ReactDOM.

`gpt/` remains AGPL-3.0-only. Keep `NOTICE.md` and `THIRD_PARTY_NOTICES.md` accurate when upstream-derived code changes.

## Versioning and test packages

任何进入测试包的产品代码变化必须 bump version。产品行为、代码逻辑、UI 功能或 bugfix 均属于此规则；禁止代码更新而 manifest/package 版本不变。

- PATCH：bugfix、小功能、小交互优化、运行生命周期收口；例如 4.0.2 → 4.0.3。
- MINOR：新增完整功能模块；例如 4.0.x → 4.1.0。
- MAJOR：架构兼容性变化或产品方向重大变化。
- package、lockfile、source manifest、dist manifest、ZIP 文件名必须一致；`npm run package` 强制检查，拒绝覆盖已有版本包。
- 固定依赖与 lockfile；SortableJS 1.15.6（MIT）使用官方默认 ESM（包含 AutoScroll），不实现自有拖拽状态机。
- `historyComplete=true` 不因刷新开始、reload 或失败降级；只有账号变化、存储丢失/损坏或不兼容 schema 才能使 baseline 失效。
- 本地固定验证：`npm test`、`npm run build`、`npm run verify:gate`、`git diff --check`，之后 `npm run package`。
- `HOSTED_CI = DISABLED_BY_OWNER_NO_QUOTA`，含义为 `NOT_USED_BY_POLICY`；不属于 PASS、FAILURE 或 Release Authority。本分支仅测试包交付，不执行 PR、merge、Release 或部署阶段。
