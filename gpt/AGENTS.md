# ChatGPT Yada Agent Guide

This file is mandatory reading before every work session in this repository.

## Project

Project name: ChatGPT Yada

Positioning: a single lightweight ChatGPT extension. Install once to get complete long-thread navigation, hover preview, copy-all with real timestamps, a local prompt library, and local Pro quota estimates.

Current version: **4.0.0**. This is still the pre-release architecture closeout. Do not invent 4.0.1 or 5.0.0 unless a person explicitly changes the version.

## Architecture

```text
业务事件 → ConversationSync → readConversation() → ConversationSnapshot
  ├─ activeTurns → Rail / Preview / Copy All
  └─ quota source → Vibe Bar parser → Local Ledger → Action rings / page toolbar rings / Popup

Navigation:
  NativeNavigationPort
    ├─ Direct
    ├─ Official Button
    └─ Stable Slot
```

One current-conversation read. One snapshot. Navigation does not own a second conversation copy. Quota history may read older conversations with the same parser.

Yada Rail always renders `ConversationSnapshot.activeTurns`. Clicking a tick uses ChatGPT native capabilities: a mounted user message, the official Prompt buttons, or persistent `data-turn-id-container` slots. An empty `?message=` reload may run at most once per conversation per tab to ask ChatGPT to build that skeleton.

## Scope

Allowed: complete Yada rail, hover preview, copy-all, prompt library, local Pro quota estimates, native ChatGPT navigation (Direct / official button / stable slot).

Forbidden:

- Luna fingerprint / segment / virtual scroll search
- native-bootstrap-page / HistoryTracker / 20-page restore state machines
- Playwright, Edge QA from this Mac mini, a second Chrome/Edge, cookie/token export
- debugger / webRequest / cookies permissions
- ECS / RDS / OSS / analytics
- Modifying `claude/` or `gemini/`
- Pushing `main`, force push, PRs, GitHub Actions, Releases
- Claiming MacBook 100+ conversation acceptance from the meeting browser

## Verification

```bash
npm run check
npm run build
```

`npm run candidate` can reuse the existing meeting browser on port 9222 for short-thread smoke. It is not MacBook native acceptance. Hosted CI is disabled.

## License

`gpt/` is AGPL-3.0 because it ports Vibe Bar Chat quota code. `claude/` and `gemini/` stay separate programs with their own licenses.
