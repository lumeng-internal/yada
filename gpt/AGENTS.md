# ChatGPT Yada Agent Guide

This file is mandatory reading before every work session in this repository.

## Project

Project name: ChatGPT Yada

Positioning: a single lightweight ChatGPT extension. Install once to get complete long-thread navigation, hover preview, copy-all with real timestamps, a local prompt library, and local Pro quota estimates.

Current version: **4.0.0**.

3.1.1 native bootstrap (auto-summoning ChatGPT official navigation) failed on 100+ turn conversations. It is a historical experiment on `codex/gpt-native-navigation-v3` and must not be restored. Official navigation is no longer a product prerequisite. Yada always owns a complete rail from ConversationRepository.activeTurns. Official TOC is only an internal fast path inside `navigateTo()`.

## Versioning

`MAJOR.MINOR.PATCH`. 4.0.0 is MAJOR because navigation authority, jump core, extension shape, and the quota module changed.

Keep package, manifest, documentation, build and zip versions identical.

## Architecture

```text
ChatGPT current conversation
        → ConversationRepository
        → ConversationSnapshot
              ├─ activeTurns → Yada rail / preview / copy-all
              └─ assistantEvents → Pro quota ledger
```

Navigation and quota do not call each other. One conversationId has at most one in-flight complete read.

Content script assembly:

ConversationRepository → NavigatorController, YadaRailController, YadaToolbar.copyAll, QuotaTracker

Jumping is only allowed through `NavigatorController.navigateTo()`.

Vendored Luna navigation core lives in `vendor/luna-navigation/` and is read-only.

## Scope

Allowed:

1. Complete Yada rail for every API turn.
2. Hover preview (gray Harson / green Harson+ChatGPT).
3. Copy-all Markdown with real timestamps.
4. Local prompt library.
5. Local Pro quota ledger, toolbar icon rings, and popup estimated remaining.

Forbidden:

- Native bootstrap / pagination sentinel exposure / history GET rewriting as a product gate.
- Second visible navigation.
- Official remaining / remote quota APIs.
- ECS / RDS / OSS / analytics / API keys.
- Modifying `claude/` or `gemini/`.
- Pushing `main`, force push, PRs, GitHub Actions.

## Start-Of-Work Rules

1. Read this file.
2. Work in `.../yada-gpt-optimization-20260916/gpt`.
3. Check `git status`.
4. Do not edit `reference/` or vendored Luna files.

## Verification

```bash
npm run verify
npm run acceptance:live
npm run build
npm run release
```

`npm run verify` is local only. Hosted CI is disabled. Live ChatGPT acceptance is separate and must not be faked as PASS.
