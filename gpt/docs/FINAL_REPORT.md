# Final Report: ChatGPT Yada v2.0.0 Copy-Only Release

## Outcome

ChatGPT Yada now exposes one user-facing feature: `复制全部`.

Removed from the runtime and release bundle:

- right-side navigation rail and markers;
- active-turn tracking and click-to-jump;
- hover previews;
- preview-mode dot and mode persistence;
- selective copy, selection store, menu, and lasso interaction;
- DOM scout and rail diagnostics;
- the no-longer-used `storage` permission.

## Copy integrity

The copy path keeps the canonical ChatGPT conversation API, active-branch traversal from `current_node`, visible-role filtering, Markdown formatting, attachment placeholders, and Clipboard API fallback.

DOM-only partial snapshots are no longer treated as complete copies. When the canonical conversation cannot be fetched, the UI reports failure and leaves the clipboard untouched.

## Architecture

The runtime is now:

```text
conversation URL -> canonical conversation fetch -> active branch normalization
-> Markdown formatter -> clipboard -> button feedback
```

There is one Shadow DOM host and one button. Route tracking only controls visibility and placement.

## Verification

- TypeScript strict check: required through `npm run build`.
- Copy-core verification: `npm run verify:copy`.
- Production Vite build: `npm run build`.
- Release bundle scan: no rail, selection-copy, preview-dot, lasso, or navigation runtime strings.
- Manifest verification: only `host_permissions` for `https://chatgpt.com/*`; no `storage` permission.
- Reference boundary: `reference/` unchanged.
- Edge runtime: unpacked extension reloaded as version `2.0.0`; the inspected saved conversation exposed only `复制全部` and no rail, selection control, or mode dot.
- Long-conversation copy: a real 80-user-turn conversation produced 620,082 clipboard bytes, 80 `# User` sections, 74 `# ChatGPT` sections, and a terminal newline.

## Version decision

The release uses a MAJOR bump from `2.0.0` to `2.0.0` because removing several public interaction modules is a compatibility-breaking product-scope change.
