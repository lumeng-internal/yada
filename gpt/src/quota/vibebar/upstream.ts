/**
 * Upstream: AstroQore/vibe-bar
 * Upstream file: Sources/VibeBarCore/Adapters/ChatGPTChatProModels.swift
 *               Sources/VibeBarCore/Adapters/ChatGPTChatParser.swift
 *               Sources/VibeBarCore/Adapters/ChatGPTChatClient.swift
 *               Sources/VibeBarCore/Services/ChatGPTChatHistoryReader.swift
 * Commit: af26391c5bcc074108072af8f2807fc4c47edf21
 * License: AGPL-3.0
 * Port: Swift → TypeScript for ChatGPT Yada
 */

export const VIBE_BAR_UPSTREAM = {
  repo: "https://github.com/AstroQore/vibe-bar",
  commit: "af26391c5bcc074108072af8f2807fc4c47edf21",
  license: "AGPL-3.0",
  files: {
    allowances: "Sources/VibeBarCore/Adapters/ChatGPTChatProModels.swift",
    parser: "Sources/VibeBarCore/Adapters/ChatGPTChatProModels.swift",
    identity: "Sources/VibeBarCore/Adapters/ChatGPTChatParser.swift",
    hash: "Sources/VibeBarCore/Utilities/PrivacyPreservingHash.swift",
    client: "Sources/VibeBarCore/Adapters/ChatGPTChatClient.swift",
    history: "Sources/VibeBarCore/Services/ChatGPTChatHistoryReader.swift",
    plan: "Sources/VibeBarCore/Adapters/CodexResponseParser.swift",
    docs: "docs/chatgpt-chat.md"
  }
} as const;
