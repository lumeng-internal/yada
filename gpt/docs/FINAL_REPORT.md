# ChatGPT Yada v3.0.0

本轮按架构变更以 MAJOR 发布：删除 Yada 自研导航和历史加载，把完整轮次跳转交给 ChatGPT 官方导航。范围仅 gpt/，基线 1229d95a40f45201703651c8394df968e13ca31f。

3.0.0 代码开发完成，但正式进入 main 前，仍需 MacBook 使用 GPT Navigator Helper 原版完成真实长对话验收。

## 实现结果

- Yada 只保留复制全部、真实时间戳、提示词库、官方导航悬停预览。
- 入口改为 `NativePreviewController + YadaToolbar`。manifest 只保留一个 `document_idle` 的 `content.js`。
- 已删除 `src/history/`、`src/rail/`、`history-page.js`、MAIN world、`window.fetch` 劫持和 `IntersectionObserver` 包装。
- 官方按钮悬停预览使用完整 API 轮次；映射优先 `data-toc-item-index`，数量一致时按页面顺序，无法唯一确定时不显示。
- GPT Navigator Helper 只作为独立推荐插件写在文档中，未复制源码，未打进 ZIP。

## 本地验证与发布记录

2026-09-17：verify:copy、verify:features 连续三次、严格 TypeScript/生产构建及 diff 检查通过。五处版本在发布脚本后为 3.0.0，ZIP/dist 逐文件一致；详细清单见 TEST_CHECKLIST。测试模拟 API/storage 和官方按钮，不访问真实 ChatGPT。MacBook 真实页面仍需复验，未标记为通过。

固定命令：`npm run verify:copy`、`npm run verify:features`、`npm run build`、`git diff --check`。产物：`dist_chrome/`、`ChatGPT-Yada-v3.0.0-dist_chrome.zip`，发布时核对五处版本和 ZIP/dist 逐文件一致。

按本轮明确授权创建单个提交 `feat(gpt): delegate navigation to ChatGPT native TOC`，fetch/rebase 后普通 push 到 `codex/gpt-native-navigation-v3`；不 push main。最终 SHA 以 Git 测试分支和本任务交付记录为准。无 PR、force push 或远端工作流调用。

HOSTED_CI = DISABLED_BY_OWNER_NO_QUOTA（NOT_USED_BY_POLICY），不是 PASS。Claude/Gemini 保持基线不变。
