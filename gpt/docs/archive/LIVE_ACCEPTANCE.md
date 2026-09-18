# Live Acceptance — ChatGPT Yada 4.0.0

`npm run acceptance:live` connects through Chrome DevTools Protocol to an already logged-in ChatGPT browser.

Environment:

```bash
YADA_CDP_URL=ws://127.0.0.1:9222/devtools/browser/...
YADA_LIVE_SHORT_URL=https://chatgpt.com/c/...
YADA_LIVE_MEDIUM_URL=https://chatgpt.com/c/...
YADA_LIVE_LONG_URL=https://chatgpt.com/c/...
YADA_LIVE_DUPLICATE_URL=https://chatgpt.com/c/...
```

Checks:

1. Rail count equals complete API turns.
2. Jump first / middle / last userMessageId.
3. Duplicate prompts land on distinct IDs.
4. Wheel cancels jump with no auto-pullback.
5. Only one visible navigation.
6. Action icon and popup exist; popup says 预计剩余.

Artifact: `gpt/artifacts/live-acceptance/<commit-sha>.json`.

If the logged-in browser or URLs are missing, the script writes `LIVE_ACCEPTANCE_PENDING` and does not pretend to pass.
