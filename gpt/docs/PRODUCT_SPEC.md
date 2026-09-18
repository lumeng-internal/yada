# Product Spec — ChatGPT Yada 4.0.0

## Positioning

One Chrome/Edge MV3 extension. Install once. No second plugin.

## User-visible capabilities

1. Complete long-thread Yada rail from the full conversation API.
2. Hover preview (gray Harson, green Harson + ChatGPT).
3. Copy-all Markdown.
4. Real User / ChatGPT timestamps.
5. Local prompt library.
6. Local GPT-6 Pro / GPT-5.6 Sol Pro ledger.
7. Dynamic three-ring action icon.
8. Compact popup with 预计剩余.

## Data authority

`ConversationRepository` is the only conversation reader. `activeTurns` feed rail, preview and copy. `assistantEvents` feed quota. Navigation and quota never fetch separately.

Official ChatGPT navigation:

- Does not decide turn count.
- Does not decide whether Yada navigation exists.
- May be used only as an internal `navigateTo()` fast path when button count equals `activeTurns` count.

## Historical veto

3.1.1 automatically prepared official navigation. It worked around 30+ turns and failed at 100+ turns. That design is closed. Do not restore native bootstrap, pagination sentinel exposure, `native-bootstrap-page.js`, “导航准备中”, or dual navigation hand-off.

## Quota

Local estimated remaining for personal Chat only. Never label it 官方余额. Work and Codex are out of scope. Ruleset `openai-pro-200-chat-2026-09-18`.

## Privacy

No upload. No ECS/RDS/OSS. Storage holds metadata only.
