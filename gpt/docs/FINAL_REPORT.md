# ChatGPT Yada v3.1.0

本轮按 MINOR 发布：在 3.0.1 上把官方导航准备做进单一扩展。范围仅 gpt/，不恢复自定义导航条。

ChatGPT Yada 3.1.0 是单一扩展。安装一次即可获得自动让官方导航出现、官方导航悬停预览、复制全部和时间戳、提示词收藏。正式进入 main 前，仍需 MacBook 在真实 ChatGPT 长对话上验收。需要 Chrome / Edge 152 或更高。

## 实现结果

- 生产入口为 `document_start` MAIN world `native-bootstrap-page.js` 加上 `document_idle` isolated `content.js`。
- 页面脚本只处理当前会话同源 GET 的 `/backend-api/conversations/{id}` 与 `/messages?before=`，把不足 100 的 `num_turns` 提升到 100，原样返回 fetch Promise / Response，只读取 `response.clone()` 轻量状态。
- `NativeBootstrapController` 在可见宽屏对话页自动暴露 ChatGPT 分页 sentinel，不滚动、不点击官方导航、不创建 Yada 导航条。
- 阅读位置漂移、用户操作、隐藏、生成回答、20 页 / 60 秒上限会停止；空闲 2.5 秒后同一会话最多恢复 3 次。
- 官方导航悬停预览、复制全部、时间戳和提示词库保持 3.0.1 行为。GPT Navigator Helper 只作为设计研究来源，不是依赖。

## 本地验证与发布记录

2026-09-18：verify:copy、verify:features 连续五次、严格 TypeScript/生产构建及 diff 检查通过。五处版本为 3.1.0，ZIP/dist 逐文件一致并包含 `native-bootstrap-page.js`。测试模拟 API/DOM/storage 和官方按钮，不访问真实 ChatGPT。MacBook 真实页面仍需复验，未标记为通过。

固定命令：`npm run verify:copy`、`npm run verify:features`、`npm run build`、`git diff --check`。产物：`dist_chrome/`、`ChatGPT-Yada-v3.1.0-dist_chrome.zip`。

按本轮明确授权创建单个提交 `feat(gpt): embed native navigator bootstrap`，fetch/rebase 后普通 push 到 `codex/gpt-native-navigation-v3`；不 push main。最终 SHA 以 Git 测试分支和本任务交付记录为准。无 PR、force push 或远端工作流调用。

HOSTED_CI = DISABLED_BY_OWNER_NO_QUOTA（NOT_USED_BY_POLICY），不是 PASS。Claude/Gemini 保持基线不变。
