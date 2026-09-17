# ChatGPT Yada v2.2.1

本轮按 Owner 指定以 PATCH 发布：修复刷新后只显示局部骨架导航的缺陷。完整 API 决定刻度，页面骨架只表示已加载轮次，原生历史分页补齐缺失骨架。范围仅 gpt/，基线 60fdce374da95ca1476383c442f4f97be30f2cb4。

## 实现结果

- API 完整会话是导航总轮数、顺序、预览、时间和稳定 User message ID 的权威。页面 `data-turn-id-container` 只绑定 materialization。初始 5 个骨架精确绑定最后 5 轮，不得映射到前 5 轮。
- `history-page.js` 在 document_start MAIN world 运行：把当前会话同源 GET 的 `num_turns` 提升到 100，包装 IntersectionObserver，仅对分页哨兵记录回调并用合成 intersecting entry 触发 ChatGPT 自己的更早历史加载。
- HistoryHydrator 在 API 返回后按需补全；页数/时间/停滞/429/会话切换有限停止；加载前后保护阅读锚点；用户滚动立即暂停，空闲后最多恢复 3 次。点击未加载轮次提升优先级并在目标 ID 出现后复用 2.2.0 骨架跳转。
- 原生补全失败时，每个会话每个标签页最多一次空 `?message=` 刷新兜底，pending target 用 sessionStorage 保存，禁止刷新循环。
- 复制全部、时间戳、Harson/ChatGPT 预览、提示词 SVG 图标管理和官方导航即时让位保留。未恢复 React 私有对象扫描、virtualizer bridge 或文本匹配。

## 本地验证与发布记录

2026-09-17：verify:copy、verify:features（Chrome 无头 18 组验收，核心 fixture 为 API 18 / DOM 5→10→18）、严格 TypeScript/生产构建及 diff 检查通过。五处版本为 2.2.1，ZIP/dist 逐文件一致；详细清单见 TEST_CHECKLIST。测试模拟 API/storage 和原生哨兵，不访问真实 ChatGPT。MacBook 真实页面仍需复验，未标记为通过。

固定命令：`npm run verify:copy`、`npm run verify:features`、`npm run build`、`git diff --check`。产物：`dist_chrome/`、`ChatGPT-Yada-v2.2.1-dist_chrome.zip`，发布时核对五处版本和 ZIP/dist 逐文件一致。

按本轮明确授权创建单个提交 `fix(gpt): hydrate complete navigation history`，fetch/rebase 后普通 push main；最终 SHA 以 Git main 和本任务交付记录为准。无 PR、force push 或远端工作流调用。

HOSTED_CI = DISABLED_BY_OWNER_NO_QUOTA（NOT_USED_BY_POLICY），不是 PASS。Claude/Gemini 保持基线不变。
