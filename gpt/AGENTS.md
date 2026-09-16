# ChatGPT Yada Agent Guide

This file is mandatory reading before every work session in this repository.

## Project

Project name: ChatGPT Yada

Positioning: a single-purpose extension that copies the current ChatGPT conversation as Markdown with one click.

The final product must stay small, focused, and easy to audit. The goal is not to merge all reference projects into one large enhancement suite.

Current product direction: v2 removes navigation, selective copy, preview, rail markers, and mode switching. The only user-facing action is `复制全部`.

## Versioning

Version format: `MAJOR.MINOR.PATCH`.

1. PATCH: every small change, bugfix, or interaction repair increments the rightmost number.
   Example: `1.0.4 -> 1.0.5`.
2. MINOR: a complete feature module increments the middle number and resets PATCH.
   Example: `1.0.9 -> 1.1.0`.
3. MAJOR: an architecture change, compatibility break, or core feature rewrite increments the leftmost number and resets MINOR and PATCH.
   Example: `1.9.9 -> 2.0.0`.

If package or manifest metadata still reports `0.1.0`, correct it to the current `1.0.x` release line before building or packaging.

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
   `/Users/harsonru/Code/Codex/AI-Markdown/GPTYADA/GPTyada-v1.1.7`
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
2. Natural light/dark mode adaptation for the single button.
3. Placeholder summaries for images, files, pasted content, and no-text messages.

Do not add features outside this scope unless the user explicitly changes the product scope in writing.

Explicitly forbidden:

- Navigation rails, marks, jumps, active-turn tracking, or hover previews.
- Selective copy, selection menus, lasso selection, or per-turn controls.
- Preview-mode dots or User/User+ChatGPT switching.
- GPT quota reminders.
- Token estimation.
- Claude Counter features.
- Multi-platform support.
- Claude, Gemini, Grok, DeepSeek, or other platform support.
- Prompt Library.
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

Render one compact `复制全部` button in ChatGPT's header action area, with a small fixed fallback when that target is unavailable. It must not push, resize, or cover ChatGPT's native content. Feedback belongs in the button label; do not add panels, menus, dots, rails, or extra controls.

## Stage Discipline

Every stage must include a self-check before completion.

At the end of every stage, output:

1. Change summary.
2. Test or verification checklist.
3. Known gaps or risks.
4. Confirmation that `reference/` was not modified.

During formal development, the project must be able to build. A stage that introduces source code must also define the relevant build and verification commands.

`src/`, `package.json`, and `manifest.json` may be edited within the requested scope. Do not install dependencies unless a blocker proves it necessary.
