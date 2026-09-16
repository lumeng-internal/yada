import assert from "node:assert/strict";
import type { ApiConversation } from "../src/conversation/fetchConversation";
import { normalizeConversation } from "../src/conversation/normalizeConversation";
import { writeTextToClipboard } from "../src/export/clipboard";
import { formatTurnsAsMarkdown } from "../src/export/markdownFormatter";

const conversation: ApiConversation = {
  id: "conversation-1",
  current_node: "assistant-current",
  mapping: {
    root: { id: "root", children: ["user-1"], message: null },
    "user-1": {
      id: "user-1",
      parent: "root",
      children: ["assistant-current", "assistant-old"],
      message: {
        id: "message-user-1",
        author: { role: "user" },
        recipient: "all",
        content: {
          content_type: "multimodal_text",
          parts: [
            { content_type: "image_asset_pointer", asset_pointer: "file-service://image-1" },
            "请总结这张图"
          ]
        }
      }
    },
    "assistant-current": {
      id: "assistant-current",
      parent: "user-1",
      children: [],
      message: {
        id: "message-assistant-current",
        author: { role: "assistant" },
        recipient: "all",
        channel: "final",
        content: { content_type: "text", parts: ["当前分支答案", "包含第二段"] }
      }
    },
    "assistant-old": {
      id: "assistant-old",
      parent: "user-1",
      children: [],
      message: {
        id: "message-assistant-old",
        author: { role: "assistant" },
        recipient: "all",
        channel: "final",
        content: { content_type: "text", parts: ["旧分支答案不应复制"] }
      }
    }
  }
};

const turns = normalizeConversation(conversation);
assert.equal(turns.length, 1);

const markdown = formatTurnsAsMarkdown(turns);
assert.match(markdown, /^# User\n\n\[图片\]\n请总结这张图/m);
assert.match(markdown, /# ChatGPT\n\n当前分支答案\n\n包含第二段/);
assert.doesNotMatch(markdown, /旧分支答案不应复制/);
assert.ok(markdown.endsWith("\n"));

let clipboardText = "";
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    clipboard: {
      writeText: async (text: string): Promise<void> => {
        clipboardText = text;
      }
    }
  }
});

await writeTextToClipboard(markdown);
assert.equal(clipboardText, markdown);

console.info("copy verification passed");

// Local constructors make this independent of the machine's timezone.
const userTime = new Date(2026, 8, 16, 12, 31, 8).getTime() / 1000;
const assistantTime = new Date(2026, 8, 16, 12, 31, 42).getTime() / 1000;
conversation.mapping!["user-1"].message!.create_time = userTime;
conversation.mapping!["assistant-current"].message!.create_time = assistantTime;
const timedTurns = normalizeConversation(conversation);
assert.equal(timedTurns[0].userCreatedAt, userTime);
assert.equal(timedTurns[0].assistantCreatedAt, assistantTime);
const timed = formatTurnsAsMarkdown(timedTurns);
assert.match(timed, /# User\n\n2026-09-16 12:31:08\n\n\[图片\]/);
assert.match(timed, /# ChatGPT\n\n2026-09-16 12:31:42\n\n当前分支答案/);
for (const invalid of [undefined, NaN, Infinity, -Infinity, 1e20, null, "yesterday"]) {
  const result = formatTurnsAsMarkdown([{ ...turns[0], userCreatedAt: invalid as number, assistantCreatedAt: invalid as number }]);
  assert.equal(result, markdown, "Missing/invalid timestamps must not invent a time");
}
await writeTextToClipboard(timed);
assert.equal(clipboardText, timed);
console.info("independent local timestamps and missing/invalid times passed");
