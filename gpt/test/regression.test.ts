import { describe, expect, it } from "vitest";
import { formatTurnsAsMarkdown } from "../src/export/markdownFormatter";
import { normalizeConversation } from "../src/conversation/normalizeConversation";
import { parseLibrary } from "../src/prompts/storage";
import { branchedConversation, linearConversation } from "./helpers";

describe("copy and prompt regressions", () => {
  it("copies the active branch with attachment placeholders and independent timestamps", () => {
    const conversation = branchedConversation();
    conversation.mapping!["u0"].message!.content = {
      content_type: "multimodal_text",
      parts: [{ content_type: "image_asset_pointer", asset_pointer: "file-service://image-1" }, "请总结这张图"]
    };
    conversation.mapping!["u0"].message!.create_time = 1_700_000_000;
    conversation.mapping!["a0"].message!.create_time = 1_700_000_042;
    const markdown = formatTurnsAsMarkdown(normalizeConversation(conversation));
    expect(markdown).toMatch(/\[图片\]/);
    expect(markdown).toMatch(/请总结这张图/);
    expect(markdown).not.toMatch(/old branch/);
    expect(markdown).toMatch(/# User\n\n20\d\d-/);
    expect(markdown).toMatch(/# ChatGPT\n\n20\d\d-/);
  });

  it("keeps prompt library ids through parse/save shape", () => {
    const library = parseLibrary({
      version: 1,
      prompts: [{ id: "existing-210-id", title: "A", content: "Body", createdAt: 10, updatedAt: 20 }]
    });
    expect(library.prompts[0].id).toBe("existing-210-id");
  });

  it("does not collapse duplicate user questions in the copied active branch", () => {
    const turns = normalizeConversation(linearConversation(4));
    expect(turns[0].userMarkdown).toBe(turns[2].userMarkdown);
    expect(turns[0].userMessageId).not.toBe(turns[2].userMessageId);
  });
});
