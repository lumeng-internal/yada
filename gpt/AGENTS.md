# ChatGPT Yada Agent Guide

This file is mandatory reading before every work session in this repository.

## Project

Project name: ChatGPT Yada

Positioning: a lightweight ChatGPT extension for 复制全部 + 对话导航 + 提示词库.

The final product must stay small, focused, and easy to audit. The goal is not to merge all reference projects into one large enhancement suite.

Current product direction: API-first complete conversation copy with real timestamps, a single navigation rail with hover previews, and a local prompt library.

## Versioning

Version format: `MAJOR.MINOR.PATCH`.

1. PATCH: every small change, bugfix, or interaction repair increments the rightmost number.
   Example: `1.0.4 -> 1.0.5`.
2. MINOR: a complete feature module increments the middle number and resets PATCH.
   Example: `1.0.9 -> 1.1.0`.
3. MAJOR: an architecture change, compatibility break, or core feature rewrite increments the leftmost number and resets MINOR and PATCH.
   Example: `1.9.9 -> 2.0.0`.

Keep package, manifest, documentation, build and release archive versions consistent.

## Release Automation Rules

Every completed change that affects user-visible behavior must use the project release scripts before final reporting:

1. Bugfixes, small changes, and interaction repairs: `npm run release:patch`.
2. Complete new feature modules: `npm run release:minor`.
3. Architecture changes, compatibility breaks, or core rewrites: `npm run release:major`.

Never manually update only `manifest.json`.
Never leave `package.json` and `manifest.json` with different versions.
Never build a release without refreshing the versioned zip archive.
Every final report must state the version bump type and the reason for that choice.

## Start-Of-Work Rules

1. Read `AGENTS.md` before making any change.
2. Confirm the current working directory is the project root:
   `/Volumes/AutomationData/10_Workspace/Codex/yada-gpt-optimization-20260916/gpt`
3. Check the workspace state before edits.
   - If this is a Git repository, run `git status --short`.
   - If the working tree is dirty with changes unrelated to the current request, stop and explain before editing.
   - If this is not a Git repository, say so in the work summary and continue only with the requested scope.
4. Do not blindly modify files when unexpected changes are present.

## Read-Only Reference Boundary

`reference/` is a read-only reference directory.

Never modify, format, move, delete, rename, or generate files under `reference/`.

Allowed use:

- Read directory structure.
- Read selected files for product, DOM, export, rail, preview, and engineering reference.
- Summarize findings in project docs.

Forbidden use:

- Directly editing reference files.
- Treating reference projects as source roots.
- Running formatters or build commands inside reference projects.
- Copying large modules without first documenting why the code is needed.

## Current Architecture Rule

The accepted route is:

1. Keep this repository's MV3 + Vite + TypeScript shell.
2. Read the active conversation id from the current ChatGPT URL.
3. Fetch the canonical current branch from `/backend-api/conversation/{id}`.
4. Normalize only visible user and final assistant messages, including attachment placeholders.
5. Format Markdown and write it through the Clipboard API with the existing local fallback.
6. Never report success after copying a DOM-only partial snapshot.

## Scope Control

The feature set is limited to:

1. One-click copy of the current ChatGPT conversation as Markdown.
2. Official turn-skeleton conversation navigation, active-turn tracking, container-ID jumps and Harson/Harson+ChatGPT hover previews.
3. Local-only prompt CRUD and icon-only copying via chrome.storage.local; no search or composer insertion.
4. Natural light/dark adaptation and existing attachment placeholders.

Do not add features outside this scope unless the user explicitly changes the product scope in writing.

Explicitly forbidden:

- Selective copy, selection menus, lasso selection, or per-turn controls.
- GPT quota reminders.
- Token estimation.
- Claude Counter features.
- Multi-platform support.
- Claude, Gemini, Grok, DeepSeek, or other platform support.
- FolderManager.
- FloatBall.
- WidthPanel.
- Backend server.
- API keys.
- Remote scripts.
- OCR.
- Reading file bodies.
- Downloading attachment contents.
- Batch historical conversation export.
- PDF or PNG large export.
- Reader mode.
- Bookmark system.
- Complex settings pages.
- A large all-in-one enhancement suite.

## Reference Code Intake Rule

Before migrating any reference code or close derivative implementation, first document:

1. Source path.
2. Specific behavior needed.
3. Why a smaller local implementation is not enough.
4. What will be simplified or removed.
5. License or attribution concern if applicable.

Default preference: re-implement the smallest needed behavior in this project using the reference only as a guide.

## UI Standards

Render `预览模式圆点 | 复制全部 | 提示词` in the header actions with a compact fixed fallback and Shadow DOM isolation. Maintain one rail host and one marks layer; official side panels reposition it, while visible official conversation navigation hides that same host until it disappears. Prompt modal has its own body-level Shadow DOM host. Do not modify official navigation. Prompt text must use plain-text rendering. API data is canonical for complete copy, timestamps and preview text. Official direct-child data-turn-id-container skeletons are authoritative for rail count, order, active turn and navigation. Never reintroduce React private-object scanning or a virtualizer bridge. Prompts only copy through SVG icon controls and never insert into the composer.

## Stage Discipline

Every stage must include a self-check before completion.

Report concise progress and a final verification result. Only gpt/ may be modified; claude/ and gemini/ remain read-only. No hosted CI, remote workflows or PR. For the explicitly authorized 2.2.0 MINOR release, local commit and direct push to main are allowed after local build and relevant verification. Never force push.

During formal development, the project must be able to build. A stage that introduces source code must also define the relevant build and verification commands.

`src/`, `package.json`, and `manifest.json` may be edited within the requested scope. Do not install dependencies unless a blocker proves it necessary.
