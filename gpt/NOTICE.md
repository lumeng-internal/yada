# NOTICE

ChatGPT Yada GPT 扩展（`gpt/`）使用 GNU Affero General Public License v3.0-only 发布。完整许可证见 `LICENSE`。

## Vibe Bar

本目录包含从 [AstroQore/vibe-bar](https://github.com/AstroQore/vibe-bar) 移植并修改的 ChatGPT Chat quota 代码。

- 上游 Commit：`af26391c5bcc074108072af8f2807fc4c47edf21`
- 原许可证：AGPL-3.0
- 原版权：AstroQore / Vibe Bar contributors
- 移植范围：Swift → TypeScript 的 ChatGPT 个人 Chat Pro 额度估算

| 上游文件 | 本项目 TypeScript | 修改说明 |
| --- | --- | --- |
| `ChatGPTChatProModels.swift` | `src/quota/vibebar/allowances.ts`、`conversationParser.ts`、`modelLimits.ts`、`types.ts` | 保留 Pro / ProLite 桶、User turn 计费、Work 排除和 `model_limits` |
| `ChatGPTChatParser.swift` | `src/quota/vibebar/json.ts`、`conversationParser.ts` | JSON、日期、模型与活动分支解析 |
| `PrivacyPreservingHash.swift` | `conversationParser.ts` 的 `identity()` | Web Crypto SHA-256 哈希身份 |
| `ChatGPTChatClient.swift` | `src/quota/pageClient.ts` | 读取 plan 与 exhausted/reset metadata |
| `ChatGPTChatHistoryReader.swift` | `src/quota/vibebar/historyReader.ts` | 7 天、page size 50、4 pages、detail budget 24、25 秒、archived 双流 |

未复制 Vibe Bar 的 macOS 应用壳、菜单栏 UI、其他供应商适配器或密钥处理。浏览器侧多轮 warmup 只编排原有 reader 和 cache，不改变额度规则。

浏览器适配为 history list 单独使用 45 秒传输超时，保留 reader 的 25 秒默认调度预算和其他 API 的 15 秒默认超时。Reader 显式区分临时传输失败与永久失败，沿用最多 20 pass、间隔 1.5 秒的有限续跑；历史未分类数仅由 history summary 更新。

## AI-MarkDone

本目录直接适配了 [zhaoliangbin42/AI-MarkDone](https://github.com/zhaoliangbin42/AI-MarkDone) 的极少量 MIT 结构。

- 上游 Commit：`d6cc562931607f378c48023420f814de1f7c9d60`
- 原许可证：MIT
- 原版权：zhaoliangbin42 / AI-MarkDone contributors
- 本项目文件：`src/nativeNavigator/dom.ts`
- 复用范围：ChatGPT 官方 Navigator root/fixed-child/button 识别结构，以及稳定 message identity 属性的选择顺序

未引入 Reader、书签、PDF/PNG、Drive、Annotation、其他平台、自绘 Directory Rail、React Fiber 或 private virtualizer。

## GPT Navigator Helper

[GPT Navigator Helper](https://github.com/sssstf0rest/GPT-Navigator-Helper) 0.6.4、Commit `2ac38de536dacb0ed1ad25c31396fd62a1c49022` 的仓库未声明项目许可证。

本项目只将其作为经过验证的行为和架构参考。官方历史 hydration 由 Yada 按自身模块和约束独立实现；**behavioral reference only / no source copied**。未将该项目源码、分发物或许可证声明并入 Yada。

## GPT Conversation Toolkit

[GPT Conversation Toolkit](https://github.com/bujue3709/GPT-Conversation-Toolkit) Commit `ca628eeaed87323c195aa7b6d2750d2804e6ac77`，MIT。现有完整 Conversation API 与 Prompt Library 交互继续保留；未移植 React Fiber virtualizer bridge、private `scrollToIndex` 或自有 navigator。

## 仓库中的独立程序

`claude/` 与 `gemini/` 不与 `gpt/` 构建、链接或打包，保留各自许可证。
