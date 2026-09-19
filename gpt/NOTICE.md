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

## AI-MarkDone

本目录包含从 [zhaoliangbin42/AI-MarkDone](https://github.com/zhaoliangbin42/AI-MarkDone) 移植并改写的 ChatGPT 导航闭包。

- 上游仓库：https://github.com/zhaoliangbin42/AI-MarkDone
- 上游 Commit：`d6cc562931607f378c48023420f814de1f7c9d60`
- 原许可证：MIT
- 原版权：zhaoliangbin42 / AI-MarkDone contributors

| 上游文件 | 本项目 TypeScript | 适配说明 |
| --- | --- | --- |
| `src/drivers/content/chatgpt/ChatGPTOfficialNavigation.ts` | `src/navigation/nativeCapability.ts` | 保留官方导航根节点与 fixed child 识别；增加 Prompt index / `data-toc-item-index` 完整性校验 |
| `src/drivers/content/chatgpt/ChatGPTConversationNavigation.ts` | `src/navigation/stableSlotDriver.ts`、`src/navigation/nativeCapability.ts` | 只移植持久槽位身份、去重 marker、角色校验和 User 优先；不移植 200 步 monotonic seek |
| `src/services/content/ConversationNavigationCoordinator.ts` | `src/navigation/nativeNavigationPort.ts` | 相同目标复用 Promise、新目标取消旧目标、finally 不清除新任务、约 15 秒超时 |
| `src/drivers/content/chatgpt/chatgptRoute.ts` | `src/navigation/nativePreparation.ts` | 空 `message` 查询准备；**不覆盖**非空 message 深链；每篇对话每标签页最多一次 |
| `src/ui/content/chatgptDirectory/navigation.ts` | `src/navigation/stableSlotDriver.ts` | 最多两次最终对齐 |
| `src/ui/content/controllers/ChatGPTOfficialNavigationVisibilityController.ts` | `src/navigation/officialVisibility.ts` | 不删除 DOM；改用 `opacity: 0; pointer-events: none`，程序仍可 click |

未移植 Reader、书签、PDF/PNG、标注、Google Drive、公式、云同步、设置中心、非 ChatGPT 平台，以及 `ConversationPendingNavigationRestorer` 书签恢复状态机。

## LunaTOC

LunaTOC 虚拟搜索曾用于 4.0.0 过渡实现，现已从生产和测试中移除，只作为历史来源记录。见 `THIRD_PARTY_NOTICES.md`。

## 仓库中的独立程序

`claude/` 与 `gemini/` 是同一 Git 仓库中的独立程序。它们不与 `gpt/` 构建、链接或打包，继续保留各自原有许可证。
