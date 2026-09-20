# v1.1.7 Composer Draft Exclusion Postmortem

## Problem

GPT Yada should only operate on sent historical conversation messages. The ChatGPT bottom composer is not a conversation turn while the user is still drafting text, uploading files, or previewing images before sending.

The observed failure was that draft composer content could appear as:

- an extra right rail marker;
- hover preview content;
- selected-copy content;
- an inflated turn count.

## Product Rule

Only sent messages can become turns.

Composer content is excluded until ChatGPT sends it into the conversation thread. This includes text drafts, textarea/contenteditable text, role textbox content, prompt textarea content, form content, unsent image previews, unsent file previews, upload previews, and send-button composer containers.

## Root Cause

The DOM collector depended on general excluded-area checks and message-like selectors. ChatGPT composer DOM can contain text, previews, forms, contenteditable editors, ProseMirror nodes, and upload UI that resemble message content enough for broad DOM fallback scans.

Because there was no centralized composer guard, different paths had different protection levels:

- role-node scan;
- wrapper scan;
- attachment extraction;
- text extraction;
- API turn to DOM anchor binding;
- rail rendering;
- hover preview.

## Fix

v1.1.7 adds a shared composer guard and applies it across the turn pipeline:

- `isComposerElement()`
- `isInsideComposer()`
- `isComposerDraftTurn()`
- `filterComposerDraftTurns()`
- `countComposerElements()`

The guard is used before accepting DOM candidates, before extracting DOM message text/attachments, after binding API turns to DOM anchors, before content state is rendered, before rail markers are created, and before hover preview is shown.

## Debugging

`conversationAudit` was added to the debug snapshot:

- `rawDomCandidateCount`
- `skippedComposerCandidateCount`
- `composerElementCount`
- `finalTurnCount`
- `composerTurnCount`
- `warning`

The warning string is:

```text
Composer draft leaked into turns.
```

## Explicit Non-Changes

This release does not change rail styling, hover gradient, Activity panel behavior, active jump, copy format, sent-message attachment summaries, toolbar/menu behavior, manifest permissions, or `reference/`.
