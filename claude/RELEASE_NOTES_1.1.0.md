# Claude Yada 1.1.0

## Copy All

- Copy All now reads the complete Claude Conversation Tree and follows only the current leaf's active parent chain.
- Copy output no longer depends on the currently mounted DOM window, scroll position, or lazy loading.
- Parent-chain, message-count, branch-membership, first/last message, and final Markdown hashes are validated before the clipboard is written.
- Incomplete or failed Conversation API responses do not overwrite the clipboard.

## Current active conversation Token estimate

- Restores the local `o200k_base` counter using the mature `claude-counter-0.4.2` data flow.
- Counts only the current active branch and caches per-message results by conversation ID, message UUID, and normalized content hash.
- Refreshes on route, leaf, and completed generation changes without using page scroll as a trigger.
- Falls back to the current composer usage row when Claude omits the legacy chat-menu anchor.
- Recovers automatically from transient Conversation API failures with low-frequency bounded backoff.
- Displays `≈` and an explicit local-estimate tooltip.
- Marks non-text, unknown, incomplete-parent-chain, and explicit Claude Compaction states as estimate-incomplete.

## Privacy and limitations

- Conversation content and tokenization stay in the local browser; no API key or external service is used.
- System prompts, Project Knowledge, background Web Search/Research, image vision tokens, and PDF internal parsing tokens are not available to the extension.
