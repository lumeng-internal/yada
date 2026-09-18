import { afterEach, describe, expect, it } from "vitest";
import { createRenderedFingerprintCollector } from "@/platforms/chatgpt/renderedFingerprintCollector";

describe("rendered fingerprint collector with real timers", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("collects the latest text after DOM mutations settle", async () => {
    const records: string[] = [];
    const collector = createRenderedFingerprintCollector({
      debounceMs: 20,
      onFingerprintRecord: (_context, record) => {
        records.push(record.fingerprints[0]?.probeText ?? "");
      }
    });
    collector.setContext({
      conversationKey: "conversation-1",
      revision: 1,
      responsePromptIndexes: new Map([["response-1", 0]])
    });
    collector.observe(document.body);
    document.body.innerHTML = `
      <div data-message-author-role="assistant" data-message-id="response-1">
        <div class="markdown">Partial</div>
      </div>
    `;
    await new Promise((resolve) => setTimeout(resolve, 5));
    document.querySelector(".markdown")!.textContent = "Completed answer for fingerprinting";
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(records.some((text) => text.includes("Completed answer"))).toBe(true);
    collector.disconnect();
  });

  it("uses the current conversation context after a route switch", async () => {
    const records: Array<{ conversationKey: string; revision: number; promptIndex: number }> = [];
    const collector = createRenderedFingerprintCollector({
      debounceMs: 20,
      onFingerprintRecord: (context, record) => {
        records.push({
          conversationKey: context.conversationKey,
          revision: context.revision,
          promptIndex: record.promptIndex
        });
      }
    });
    collector.observe(document.body);
    collector.setContext({
      conversationKey: "old-conversation",
      revision: 1,
      responsePromptIndexes: new Map([["response-1", 0]])
    });
    collector.setContext({
      conversationKey: "new-conversation",
      revision: 4,
      responsePromptIndexes: new Map([["response-1", 2]])
    });
    document.body.innerHTML = `
      <div data-message-author-role="assistant" data-message-id="response-1">
        <div class="markdown">New route answer for fingerprinting</div>
      </div>
    `;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(records[0]).toMatchObject({
      conversationKey: "new-conversation",
      revision: 4,
      promptIndex: 2
    });
    collector.disconnect();
  });
});
