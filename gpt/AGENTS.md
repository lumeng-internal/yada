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
  └─ quota source → Vibe Bar parser → Local Ledger → Action rings / Popup
```

One current-conversation read. One snapshot. Navigation does not own a second conversation copy. Quota history may read older conversations with the same parser.

Vendored Luna files live in `vendor/luna-navigation/` and are limited to the virtual-navigation core listed in `UPSTREAM.json`.

## Scope

Allowed: complete Yada rail, hover preview, copy-all, prompt library, local Pro quota estimates.

Forbidden:

- Native bootstrap / official TOC as a product path
- Playwright, Edge QA, a second Chrome/Edge, cookie/token export
- debugger / webRequest / cookies permissions
- ECS / RDS / OSS / analytics
- Modifying `claude/` or `gemini/`
- Pushing `main`, force push, PRs, GitHub Actions, Releases

## Verification

```bash
npm run check
npm run build
npm run candidate
```

`npm run candidate` is the only acceptance gate. It reuses the existing meeting browser on port 9222. Hosted CI is disabled.

## License

`gpt/` is AGPL-3.0 because it ports Vibe Bar Chat quota code. `claude/` and `gemini/` stay separate programs with their own licenses.
