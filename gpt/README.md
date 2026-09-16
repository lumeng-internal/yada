# ChatGPT Yada Copy

ChatGPT Yada Copy is a single-purpose Chrome / Edge MV3 extension. On a saved ChatGPT conversation page, it shows one `复制全部` button and copies the canonical current branch as Markdown.

## Status

v2.0.0 is the current release.

This MAJOR release removes the navigation rail, active markers, rail click-to-jump, hover preview, preview-mode dot, selective copy, selection menu, and lasso selection. The only user-facing action is `复制全部`.

## Why the copy is complete

The extension does not infer a long conversation from the currently mounted DOM. ChatGPT virtualizes long threads, so DOM-only collection can silently miss older messages.

On click, the extension:

1. Reads the current conversation id from the URL.
2. Fetches ChatGPT's canonical `/backend-api/conversation/{id}` mapping with the current signed-in session.
3. Walks backward from `current_node`, so only the active branch is copied.
4. Keeps visible user messages and final assistant messages.
5. Formats the result as Markdown and writes it to the clipboard.

If the canonical conversation cannot be fetched, the button reports `复制失败`; it does not claim success after copying a potentially partial DOM snapshot.

## Output

```md
# User

...

# ChatGPT

...
```

Images, files, pasted content, and messages without readable text use local placeholders such as `[图片]`, `[PDF 文件] file.pdf`, `[粘贴内容]`, and `[无文字消息]`. Attachment bodies are not downloaded.

## Build and verify

```bash
npm run verify:copy
npm run build
```

Release builds are produced with the version automation required by this repository:

```bash
npm run release:major
```

Release outputs:

```text
dist_chrome/
ChatGPT-Yada-v2.0.0-dist_chrome.zip
```

## Edge installation

The installed developer extension uses:

```text
/Users/harsonru/Code/Codex/AI-Markdown/GPTYADA/GPTyada-v1.1.7/dist_chrome
```

After a build, open `edge://extensions` and reload **ChatGPT Yada**. Then reload an existing `https://chatgpt.com/c/...` tab.

## Scope

The release intentionally contains no navigation, per-turn selection, hover preview, mode switching, settings page, remote scripts, API keys, OCR, attachment downloads, or batch historical export.

The extension only matches `https://chatgpt.com/*`. Its release manifest requests no `storage` permission.

## Reference boundary

`reference/` remains read-only and is not included in the extension release bundle.
