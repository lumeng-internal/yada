# Test Checklist — ChatGPT Yada 4.0.0

Local command: `npm run verify` (run three consecutive times before reporting). Then `npm run build` and `git diff --check`.

Hosted CI is disabled.

## Must pass locally

ConversationRepository sharing/cancellation, rail tick counts 18/50/150/300, duplicate prompt IDs, jump cancel, ledger dedupe, Work exclusion, calculator windows, icon sizes, popup copy “预计剩余”, prompt CRUD, copy-all active branch, no nativeBootstrap, claude/gemini unchanged.

## Live ChatGPT (MacBook)

Requires a logged-in browser and:

- `YADA_LIVE_SHORT_URL` (~18)
- `YADA_LIVE_MEDIUM_URL` (30–50)
- `YADA_LIVE_LONG_URL` (100+)
- `YADA_LIVE_DUPLICATE_URL`

Until that happens: `LIVE_ACCEPTANCE_STATUS=PENDING`. Do not report PASS.
