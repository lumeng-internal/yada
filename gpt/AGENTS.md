# ChatGPT Yada Agent Guide

Read this file before every work session in `gpt/`.

## Product contract

Current version is **4.0.0**. Yada restores and preserves ChatGPT's native long-conversation Prompt Navigator by completing host history loading without moving the reader's position.

The page toolbar contains only: Pro quota rings, Copy All, Prompt Library. There is no Yada rail, navigation preview, green mode dot, direct jump, official-button proxy, stable-slot jump, `?message=` preparation, official-nav hiding, or fallback navigator.

## Architecture

- `ConversationSync`: the one current-conversation snapshot for Copy All and current-conversation quota turns.
- `nativeNavigator/mainHook.ts`: narrow document-start MAIN-world fetch wrapper; no `chrome.*` API.
- `nativeNavigator/hydrator.ts`: isolated, bounded host-history hydration with no scrolling or reload.
- `quota/vibebar/*`: authoritative quota parsing and allowance rules.
- `QuotaTracker`: progressive browser-lifecycle cache warmup; one flight, bounded passes, pause/cancel/stop.
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
