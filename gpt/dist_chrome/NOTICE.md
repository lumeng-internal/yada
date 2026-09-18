# NOTICE

ChatGPT Yada GPT 扩展（`gpt/`）使用 GNU Affero General Public License v3.0 发布。完整许可证见 `LICENSE`。

## Vibe Bar

本目录包含从 [AstroQore/vibe-bar](https://github.com/AstroQore/vibe-bar) 移植并修改的 ChatGPT Chat quota 代码。

- 上游仓库：https://github.com/AstroQore/vibe-bar
- 上游 Commit：`af26391c5bcc074108072af8f2807fc4c47edf21`
- 原许可证：AGPL-3.0
- 原版权：AstroQore / Vibe Bar contributors
- 移植：Swift → TypeScript，仅用于 ChatGPT Yada 的个人 Chat Pro 额度估算

| 上游文件 | 本项目 TypeScript | 修改说明 |
| --- | --- | --- |
| `Sources/VibeBarCore/Adapters/ChatGPTChatProModels.swift` | `src/quota/vibebar/allowances.ts`、`src/quota/vibebar/conversationParser.ts`、`src/quota/vibebar/modelLimits.ts`、`src/quota/vibebar/types.ts` | 保留 Pro / ProLite 桶、User turn 计费、Work 排除、`model_limits` 解析；去掉 macOS UI 与非 Chat 路径 |
| `Sources/VibeBarCore/Adapters/ChatGPTChatParser.swift` | `src/quota/vibebar/json.ts`、`src/quota/vibebar/conversationParser.ts` | 保留 JSON 边界、日期与 model slug 校验 |
| `Sources/VibeBarCore/Utilities/PrivacyPreservingHash.swift` | `src/quota/vibebar/conversationParser.ts` 中的 `identity()` | 使用 Web Crypto SHA-256，前缀 `chat-` |
| `Sources/VibeBarCore/Adapters/ChatGPTChatClient.swift` | `src/quota/pageClient.ts` | 只移植 `wham/usage` 的 `plan_type` 与 `conversation/init` 的 `model_limits` |
| `Sources/VibeBarCore/Services/ChatGPTChatHistoryReader.swift` | `src/quota/vibebar/historyReader.ts` | 保留 7 天窗口、pageSize 50、最多 4 页、详情预算 24、25 秒截止、archived 双流 |
| `docs/chatgpt-chat.md` | 行为对照，未整篇复制 | 产品规则来源 |

未复制 Vibe Bar 的 macOS 应用壳、菜单栏 UI、其他供应商适配器或密钥处理。

## 仓库中的独立程序

`claude/` 与 `gemini/` 是同一 Git 仓库中的独立程序。它们不与 `gpt/` 构建、链接或打包，继续保留各自原有许可证。
