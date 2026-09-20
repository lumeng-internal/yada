# ChatGPT Yada Agent Guide

Read this file before every work session in `gpt/`.

## Product contract

Current version is **4.0.2**. Yada restores and preserves ChatGPT's native long-conversation Prompt Navigator by completing host history loading without moving the reader's position.

The page toolbar contains only: Pro quota rings, Copy All, Prompt Library. There is no Yada rail, navigation preview, green mode dot, direct jump, official-button proxy, stable-slot jump, `?message=` preparation, official-nav hiding, or fallback navigator.

## Architecture

- `ConversationSync`: the one current-conversation snapshot for Copy All and current-conversation quota turns.
- `nativeNavigator/mainHook.ts`: narrow document-start MAIN-world fetch wrapper and bounded prepare lease; no `chrome.*` API.
- `nativeNavigator/hydrator.ts`: isolated PrepareSession that exposes the host pagination sentinel; no scrolling or reload.
- `quota/vibebar/*`: authoritative quota parsing and allowance rules.
- `QuotaTracker`: live ledger delta + last-known-good baseline + 10-minute stale-only reconciliation; one timer/flight, private staged slices, pause on hidden.
- `QuotaSnapshot`: the single source for Action rings, toolbar rings, inline details, and popup.

## Required safety boundaries

- Preserve the original fetch Promise/Response; inspect only a clone.
- Never bridge or persist message bodies, auth data, Cookie, Token, or full payloads.
- Never scroll, restore-scroll, reload, rewrite a deep link, or manipulate ChatGPT's official Navigator UI.
- Stop on uncertainty, user input, drift over 8px, unstable layout, streaming, hidden page, route change, or budget exhaustion.
- Do not add React/Vue, Fiber scanning, private virtualizer calls, debugger/webRequest/cookies permissions, a second extension, analytics, or external services.
- Do not modify `claude/` or `gemini/`, push `main`, force push, open PRs, run hosted CI, or create Releases.

## Verification contract

The engineering closeout gate is:

```bash
npm run build
git diff --check
npm run verify:gate
```

Focused or full unit tests may be used for changed pure logic, but `npm run check` and browser automation are not release authority. Do not run candidate/Playwright/Mac mini ChatGPT acceptance, create test conversations, or consume Pro quota. Real product acceptance remains a MacBook manual task.

## Upstream boundaries

- Vibe Bar `af26391c5bcc074108072af8f2807fc4c47edf21`, AGPL-3.0: quota source of truth.
- AI-MarkDone `d6cc562931607f378c48023420f814de1f7c9d60`, MIT: minimal official navigator selectors/structure and stable message identity are adapted.
- GPT Conversation Toolkit `ca628eeaed87323c195aa7b6d2750d2804e6ac77`, MIT: existing conversation API and prompt library patterns remain; no Fiber virtualizer code.
- GPT Navigator Helper `2ac38de536dacb0ed1ad25c31396fd62a1c49022`, no project license: behavioral reference only; no source copied.

`gpt/` remains AGPL-3.0-only. Keep `NOTICE.md` and `THIRD_PARTY_NOTICES.md` accurate when upstream-derived code changes.

## Versioning and test packages

任何进入测试包的产品代码变化必须 bump version。产品行为、代码逻辑、UI 功能或 bugfix 均属于此规则；禁止代码更新而 manifest/package 版本不变。

- PATCH：bugfix、小功能、小交互优化；例如 4.0.1 → 4.0.2。本轮长对话 official Navigator PrepareSession 修复属于 PATCH。
- MINOR：新增完整功能模块；例如 4.0.x → 4.1.0。
- MAJOR：架构兼容性变化或产品方向重大变化。
- package、lockfile、source manifest、dist manifest、ZIP 文件名必须一致；`npm run package` 强制检查，拒绝覆盖已有版本包。
- 固定依赖与 lockfile；SortableJS 1.15.6（MIT）使用官方默认 ESM（包含 AutoScroll），不实现自有拖拽状态机。
- `historyComplete=true` 不因刷新开始、reload 或失败降级；只有账号变化、存储丢失/损坏或不兼容 schema 才能使 baseline 失效。
- 本地固定验证：`npm test`、`npm run build`、`npm run verify:gate`、`git diff --check`，之后 `npm run package`。
- `HOSTED_CI = DISABLED_BY_OWNER_NO_QUOTA`，含义为 `NOT_USED_BY_POLICY`；不属于 PASS、FAILURE 或 Release Authority。本分支仅测试包交付，不执行 PR、merge、Release 或部署阶段。
