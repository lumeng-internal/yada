# UI Failure Postmortem: v1.0

## Summary

The v1.0 UI failure was not a single CSS defect. It was an architectural failure: the project tried to hand-build a lightweight native DOM UI from scratch, including toolbar, rail, hover preview, selection, route handling, theme handling, and page isolation.

That route left too much product behavior dependent on unproven local UI code. The result passed build checks but failed manual UI expectations on a real ChatGPT page: the extension surface polluted or disturbed the host page, the toolbar and rail did not match the restrained Claude Yada standard, and large visible UI blocks appeared where the product required a transparent, quiet rail.

## Root Causes

1. The UI was built from scratch instead of being rebuilt around a mature ChatGPT content UI base.
2. The toolbar, rail, preview, selection, active state, and theme code were treated as small independent widgets, but their behavior is coupled through route changes, ChatGPT re-rendering, scroll position, hover hit zones, and Shadow DOM isolation.
3. The product standard was underestimated. ChatGPT Yada needs to be small in visible surface area, but the implementation still needs mature mounting, cleanup, scheduling, and UI isolation.
4. Passing `npm run build` was treated as too strong a signal. The broken UI only appears under live ChatGPT layout, theme, and dynamic rendering conditions.

## Claude Yada Lesson

Claude Yada succeeded because it did not start as a blank native DOM widget set. Its development used `claude-nexus-main` as a mature engineering base, preserved useful structure, export logic, and timeline capability, and then cut unrelated product surface such as FloatBall, WidthPanel, Prompt Library, and FolderManager.

That approach gave Claude Yada a stable base before product-specific rail, hover, selection copy, attachment summary, and dark-mode polish were refined.

## Correct ChatGPT Yada Route

ChatGPT Yada v1.0.1 should follow the same pattern:

1. Use `reference/AI-MarkDone-main` as the primary UI-base reference for ChatGPT rail, Shadow DOM, route watching, scan scheduling, theme tokens, and content mounting.
2. Use `reference/chatgpt-exporter-master` only as the complete current-conversation copy-data reference: conversation id, backend fetch, `mapping`, `current_node`, message filtering, and Markdown conversion.
3. Use `reference/ophel-main` only for ChatGPT DOM identification, scroll/root handling, active item heuristics, and theme adaptation ideas.
4. Use `reference/Claude-Yada-v1.0.0` as the product interaction and acceptance standard, not as ChatGPT source code.
5. Treat the current failed v1.0 UI layer as disposable. `src/rail/*`, `src/ui/*`, `src/styles.ts`, and content mounting behavior may be deleted or rewritten.
6. Re-audit the current v1.0 data layer before preserving it. Keep it only where it already satisfies API-first current-conversation copy, placeholder-only attachment summaries, and clean Markdown output.

## Reference Intake Boundaries

The goal is not to import a large reference project. Each reference has a narrow role:

- AI-MarkDone: UI/mount/rail/Shadow DOM/route/scan ideas.
- chatgpt-exporter: backend conversation copy-data correctness.
- ophel: ChatGPT DOM, scroll, active, and theme heuristics.
- Claude Yada: product behavior and visual standard.

Do not migrate Reader, PDF/PNG export, bookmarks, batch export, tokenizer/counter/quota logic, multi-platform architecture, settings panels, remote scripts, server code, API keys, OCR, attachment body reading, or historical export.

## Stage Self-Check

- Change summary: recorded v1.0 UI failure as an architectural problem and set the v1.0.1 mature-base rebuild direction.
- Verification checklist: project root and clean git state were checked; `reference/` exists.
- Known gaps or risks: live ChatGPT UI verification still must happen after code rebuild or be documented as unavailable.
- `reference/` modification status: this document only records read-only reference usage; no reference files were modified.
