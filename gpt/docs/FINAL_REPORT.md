# ChatGPT Yada v2.2.2

本轮按 Owner 指定以 PATCH 发布：收紧原生历史分页事务、官方导航接管、会话级取消上限和刷新恢复。范围仅 gpt/，基线 5a34f9f72faf269863abc31a50c08549afe4328a。

## 实现结果

- 完整 API 仍决定全部导航条目；ChatGPT 原生分页补齐网页骨架；官方按钮优先；2.2.0 骨架跳转保留。
- 历史分页改为一次请求一个 nonce 事务。`load-result` 只表示原生回调是否触发；`fetch-result` / `page-settled` 带 nonce、conversationId 和 sentinelGeneration。后台会话刷新、其他会话和没有 active load 的 GET 不能成为当前页结果。
- `rewriteFetchInput` 完整保留 Request+init 的 signal/cache/credentials/headers；只改写当前会话同源 GET。
- HistoryHydrator 改为会话实例状态机：pause 立即 abort 当前页等待；空闲恢复沿用剩余 20 页 / 60 秒 / 3 次恢复；显式目标有独立 AbortSignal。
- 官方导航出现时：若没有用户目标则隐藏 Yada 并取消普通校准；若有进行中的目标则隐藏 Yada，用官方按钮接管该目标。
- `?message=` pending 恢复改为事件驱动，窗口 45 秒；API 条目、官方按钮或骨架任一就绪且点击/滚动成功后才清除。

## 本地验证与发布记录

2026-09-17：verify:copy、verify:features 连续三次、严格 TypeScript/生产构建及 diff 检查通过。五处版本在发布脚本后为 2.2.2，ZIP/dist 逐文件一致；详细清单见 TEST_CHECKLIST。测试模拟 API/storage 和原生哨兵，不访问真实 ChatGPT。MacBook 真实页面仍需复验，未标记为通过。

固定命令：`npm run verify:copy`、`npm run verify:features`、`npm run build`、`git diff --check`。产物：`dist_chrome/`、`ChatGPT-Yada-v2.2.2-dist_chrome.zip`，发布时核对五处版本和 ZIP/dist 逐文件一致。

按本轮明确授权创建单个提交 `fix(gpt): harden native history hydration transactions`，fetch/rebase 后普通 push main；最终 SHA 以 Git main 和本任务交付记录为准。无 PR、force push 或远端工作流调用。

HOSTED_CI = DISABLED_BY_OWNER_NO_QUOTA（NOT_USED_BY_POLICY），不是 PASS。Claude/Gemini 保持基线不变。
