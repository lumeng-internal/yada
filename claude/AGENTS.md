# Claude Yada Project Instructions

## Project Goal

This project is named Claude Yada.

Use `claude-nexus-main` as the main Chrome extension project. Use `claude-counter-0.4.2` only as a reference plugin and migration source.

Do not migrate claude-nexus into claude-counter. Do not modify claude-counter unless explicitly asked.

## Main Project

Main project to edit:

- `claude-nexus-main`

Reference projects only:

- `claude-counter-0.4.2`
- `AI-MarkDone-main`

## AI-MarkDone Reference Rules

- `AI-MarkDone-main` is a read-only reference project.
- Do not modify `AI-MarkDone-main`.
- Do not merge or copy the whole `AI-MarkDone-main` project into `claude-nexus-main`.
- Only reference its right-side navigation rail UI, interaction model, hover behavior, active-item highlight, and rail design.
- Re-adapt any borrowed ideas to the Claude page DOM. Do not directly reuse ChatGPT selectors.
- Final implementation code must live inside `claude-nexus-main`.
- If a concrete implementation idea is borrowed from `AI-MarkDone-main`, explain the borrowed point in the project output.

## Must Keep From Claude Nexus

- Timeline
- ExportButton
- Existing export extractors
- Existing export formatters
- Existing conversation extraction logic

## Must Remove From Claude Nexus

- FloatBall
- WidthPanel
- Chat width adjustment
- useWidthControl
- useUsageRings
- Nexus usage rings
- PromptButton
- Prompt library
- usePromptLibrary
- promptLibrary storage logic
- float ball position storage logic
- chat width storage logic
- FolderManager
- folder manager storage logic

## Must Migrate From Claude Counter

- Token count
- Cache timer
- 5-hour session usage
- 7-day weekly usage
- Usage bars
- Injected bridge logic
- Fetch / SSE / conversation tree listening

## Must Add

- Copy all current conversation
- Selective copy for current conversation
- Selective copy should use the right-side navigation rail or Timeline as the core selection UI.
- Do not use body-side inline checkboxes as the selective copy entry.
- In normal mode, clicking a rail node navigates to that conversation turn.
- In selection mode, clicking a rail node toggles that turn's selected state.
- Selected rail nodes should use Claude-style orange highlighting.
- Do not use modal, floating panel, draggable panel, or overlay for selective copy.
- Copy output should be Markdown.
- Reuse existing exportExtractors and exportFormatters as much as possible.

## Development Rules

- Do not do a large architecture rewrite.
- Prefer small, staged changes.
- After each implementation stage, run `yarn build:chrome`.
- If build fails, fix it before moving to the next stage.
- Do not add new production dependencies unless absolutely necessary.
- Do not store API keys or secrets in the extension.
- Do not leave console spam.
- Keep CSS class names namespaced to avoid affecting claude.ai native UI.

## Version Rules

- Claude Yada current official version starts from v1.0.0.
- Regular small iterations should upgrade the third version number by default:
  - v1.0.0 -> v1.0.1
  - v1.0.1 -> v1.0.2
- Major version changes should upgrade the first version number:
  - v1.0.0 -> v2.0.0
  - v2.0.0 -> v3.0.0
- Documentation-only changes, README updates, test checklist updates, comments, and light maintenance with no functional impact may keep the same version, but the final output must explain why.
- Every Codex task must start by reading AGENTS.md, then decide whether the requested work requires a version bump under these rules.
- Any change that affects plugin functionality, UI, DOM recognition, copy logic, Counter, build output, or user-visible behavior should upgrade the third version number by default.
- Large refactors, architecture changes, permission changes, core feature replacement, compatibility-breaking changes, or major new modules should upgrade the first version number.
- Chrome manifest.json version must not include a `v` prefix. Use `1.0.0`, not `v1.0.0`.
- Git tags must include the `v` prefix, for example `v1.0.0`.
- Every formal release seal must confirm that these all match the release version:
  - package.json version
  - manifest.json version
  - README version note
  - dist_chrome build output
  - release zip file name
  - git tag
