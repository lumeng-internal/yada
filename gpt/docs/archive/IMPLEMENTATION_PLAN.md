# Implementation Plan — ChatGPT Yada 4.0.0

## Baseline

New branch `rebuild/gpt-yada-v4` from 3.0.1 (`564e4f92`). Do not continue 3.1.1.

## Modules

1. Vendor Luna navigation core at commit `1339969ec25d7c9b63068abd3776ce41780023ed` into `vendor/luna-navigation/`.
2. `ConversationRepository` + `extractAssistantUsageEvents`.
3. Yada `NavigationPort`: direct target → official fast path → Luna virtual search.
4. Rail / preview presentation from 2.2.2 visuals, new jump path.
5. Quota ledger, calculator, backfill, icon, popup, MV3 service worker.
6. Local `npm run verify` (no GitHub CI). Live acceptance is optional and must stay PENDING when a logged-in browser is unavailable.

## Non-goals

- Patching 3.1.1.
- GPT Navigator Helper as a runtime dependency.
- Remote quota or analytics.
- Official remaining.
