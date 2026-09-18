# ChatGPT Yada Agent Guide

This file is mandatory reading before every work session in this repository.

## Project

Project name: ChatGPT Yada

Positioning: a single lightweight ChatGPT extension for 复制全部 + 每条消息真实时间戳 + 提示词库 + ChatGPT 官方导航悬停预览 + 自动准备官方导航。

The final product must stay small, focused, and easy to audit. The goal is not to merge all reference projects into one large enhancement suite.

Current product direction: one extension. API-first complete conversation copy with real timestamps, a local prompt library, hover previews on ChatGPT's official conversation navigation, and automatic loading of earlier history so ChatGPT's official navigator can appear. Yada does not own a navigation rail, does not jump, and does not scroll or click official buttons.

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
- Read selected files for product, DOM, export, preview, and engineering reference.
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

Official navigation is owned by ChatGPT:

1. Complete API turns are the only authority for preview text and timestamps.
2. ChatGPT official TOC buttons own jumping, page scrolling and final positioning.
3. Yada 3.1.1 prepares official navigation itself: a MAIN-world `native-bootstrap-page.js` may enlarge the current conversation's history GET, and isolated `NativeBootstrapController` may wait for delayed/replaced sentinels and official navigation. Do not restore a custom rail, marks layer, click-to-jump, scroll positioning, or position correction.
4. Never reintroduce `?message=` refresh, React private-object scanning, a virtualizer bridge, text matching, estimated heights, or probe scrolling.
5. Do not wrap `IntersectionObserver`. Do not assign `scrollTop` or call `scrollIntoView`.

Production entry:

```text
document_start / MAIN world → native-bootstrap-page.js
document_idle / isolated world → content.js → Toolbar + NativePreviewController + NativeBootstrapController
```

No service worker, no backend server, no new production dependencies.

## Scope Control

The feature set is limited to:

1. One-click copy of the current ChatGPT conversation as Markdown.
2. Real per-message timestamps in copied Markdown and official-navigation hover previews.
3. Local-only prompt CRUD and icon-only copying via chrome.storage.local; no search or composer insertion.
4. Hover previews on ChatGPT official navigation buttons.
5. Automatic official-navigator preparation by enlarging current-session history requests and exposing ChatGPT's own pagination sentinel.
6. Natural light/dark adaptation and existing attachment placeholders.

Do not add features outside this scope unless the user explicitly changes the product scope in writing.

Explicitly forbidden:

- A second Yada navigation rail or custom tick marks.
- Clicking official navigation buttons, scrolling the page, or Yada-owned jump/position correction.
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
- Service workers.

## Reference Code Intake Rule

Before migrating any reference code or close derivative implementation, first document:

1. Source path.
2. Specific behavior needed.
3. Why a smaller local implementation is not enough.
4. What will be simplified or removed.
5. License or attribution concern if applicable.

Default preference: re-implement the smallest needed behavior in this project using the reference only as a guide.

GPT Navigator Helper has no clear source license. Never copy, modify, package, or commit its source, fonts, or assets. It is a design-research source for the 3.1.0 product flow, not a runtime dependency. Users no longer install it separately.

## UI Standards

Render `预览模式圆点 | 导航状态 | 复制全部 | 提示词` in the header actions with a compact fixed fallback and Shadow DOM isolation. Prompt modal has its own body-level Shadow DOM host. Official navigation hover preview uses an independent Shadow DOM host with `pointer-events: none`. Do not modify, replace, hide, or click official navigation. Prompt text must use plain-text rendering. API data is canonical for complete copy, timestamps and preview text. Never reintroduce a custom rail, React private-object scanning, a virtualizer bridge, or text matching. Prompts only copy through SVG icon controls and never insert into the composer.

## Stage Discipline

Every stage must include a self-check before completion.

Report concise progress and a final verification result. Only gpt/ may be modified; claude/ and gemini/ remain read-only. No hosted CI, remote workflows or PR. 3.1.1 is the hardened official-navigator bootstrap on the dedicated test branch `codex/gpt-native-navigation-v3`. Do not modify or push main unless the user explicitly asks. Never force push.

During formal development, the project must be able to build. A stage that introduces source code must also define the relevant build and verification commands.

`src/`, `package.json`, and `manifest.json` may be edited within the requested scope. Do not install dependencies unless a blocker proves it necessary.
