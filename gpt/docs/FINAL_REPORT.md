# ChatGPT Yada v3.0.1

本轮按 PATCH 发布：同一对话继续新增 User / ChatGPT 消息后，刷新官方导航悬停预览数据，并限制请求合并与失败恢复。范围仅 gpt/，不重新设计导航。

3.0.1 代码开发完成，但正式进入 main 前，仍需 MacBook 使用 GPT Navigator Helper 原版完成真实长对话验收。需要 Chrome / Edge 152 或更高。

## 实现结果

- Yada 只保留复制全部、真实时间戳、提示词库、官方导航悬停预览。
- 保留首次读取和路由切换读取；官方按钮数量大于当前 `turns.length`，或悬停/聚焦无法映射的官方按钮时，合并安排一次重新读取。
- 同一时间只有一个 API 请求；请求中的刷新需求只保留一个 pending；DOM 自动触发约 600ms 防抖，自动刷新间隔约 2 秒。
- API 失败后不循环重试；下次悬停未映射刻度时可再尝试。路由切换取消旧请求、旧 timer 和 pending refresh。
- GPT Navigator Helper 首选 Chrome 应用商店安装，GitHub 仅作为源码和问题反馈入口。它独立安装，未复制源码，未打进 ZIP。

## 本地验证与发布记录

2026-09-17：verify:copy、verify:features 连续三次、严格 TypeScript/生产构建及 diff 检查通过。五处版本在发布脚本后为 3.0.1，ZIP/dist 逐文件一致；详细清单见 TEST_CHECKLIST。测试模拟 API/storage 和官方按钮，不访问真实 ChatGPT。MacBook 真实页面仍需复验，未标记为通过。

固定命令：`npm run verify:copy`、`npm run verify:features`、`npm run build`、`git diff --check`。产物：`dist_chrome/`、`ChatGPT-Yada-v3.0.1-dist_chrome.zip`，发布时核对五处版本和 ZIP/dist 逐文件一致。

按本轮明确授权创建单个提交 `fix(gpt): refresh native preview data in active conversations`，fetch/rebase 后普通 push 到 `codex/gpt-native-navigation-v3`；不 push main。最终 SHA 以 Git 测试分支和本任务交付记录为准。无 PR、force push 或远端工作流调用。

HOSTED_CI = DISABLED_BY_OWNER_NO_QUOTA（NOT_USED_BY_POLICY），不是 PASS。Claude/Gemini 保持基线不变。
