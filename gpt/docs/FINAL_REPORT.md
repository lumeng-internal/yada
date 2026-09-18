# ChatGPT Yada v3.1.1

本轮按 PATCH 发布：在 3.1.0 上收口真实页面的 sentinel、官方导航、请求世代和用户恢复时序。范围仅 gpt/，不恢复自定义导航条。

ChatGPT Yada 3.1.1 仍是单一扩展。安装一次即可获得自动让官方导航出现、官方导航悬停预览、复制全部和时间戳、提示词收藏。正式进入 main 前，仍需 MacBook 在真实 ChatGPT 长对话上验收。需要 Chrome / Edge 152 或更高。

## 实现结果

- 历史还有更早页面但 sentinel 尚未出现时进入 waiting-dom，最多约 3 秒；支持后补 `data-testid`、detached 接入和每页 sentinel 替换（替换至少约 1 秒）。
- 历史完整后进入 waiting-native，最多 2.5 秒等待官方导航。完整轮次以 `expectedTurns`、否则 `history.prompts` 为准，不再用可见 User DOM 数量误报 ready。
- MAIN world 为每个历史 GET 建立 `CaptureContext`；路由切换提升 `routeGeneration`，迟到的旧对话/旧 initialVersion 响应静默丢弃，旧 `finally` 不减少新会话 pending。
- `response.clone()` 改为流式读取，超过 16 MiB 或 8 秒立即取消 reader；原始 Promise / Response 不替换。
- 用户每次滚动操作都从本次重新计算 2.5 秒安静窗口；同一会话累计预算仍为 60 秒 / 20 页 / 3 次恢复。
- 官方导航悬停预览、复制全部、时间戳和提示词库保持 3.0.1 / 3.1.0 行为。

## 本地验证与发布记录

2026-09-18：verify:copy、verify:features 连续五次、严格 TypeScript/生产构建及 diff 检查通过。五处版本为 3.1.1，ZIP/dist 逐文件一致并包含 `native-bootstrap-page.js`。测试模拟 API/DOM/storage 和官方按钮，不访问真实 ChatGPT。MacBook 真实页面仍需复验，未标记为通过。

固定命令：`npm run verify:copy`、`npm run verify:features`、`npm run build`、`git diff --check`。产物：`dist_chrome/`、`ChatGPT-Yada-v3.1.1-dist_chrome.zip`。

按本轮明确授权创建单个提交 `fix(gpt): harden native navigator bootstrap timing`，fetch/rebase 后普通 push 到 `codex/gpt-native-navigation-v3`；不 push main。最终 SHA 以 Git 测试分支和本任务交付记录为准。无 PR、force push 或远端工作流调用。

HOSTED_CI = DISABLED_BY_OWNER_NO_QUOTA（NOT_USED_BY_POLICY），不是 PASS。Claude/Gemini 保持基线不变。
