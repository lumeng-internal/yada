# ChatGPT Yada v3.0.1 测试清单

3.0.1 已补上同一对话继续新增消息后的预览刷新。正式进入 main 前，仍需 MacBook 使用 GPT Navigator Helper 原版完成真实长对话验收。需要 Chrome / Edge 152 或更高。

## Mac mini 本地验证

以下本地验证已于 2026-09-17 在 Mac mini 执行通过。不能当作真实 ChatGPT 页面验收。

- [x] `npm run verify:copy`：完整复制、附件占位、独立真实时间戳与缺失/无效时间回归。
- [x] `npm run verify:features`：Chrome 无头模式，官方按钮预览 / 映射 / 提示词 / API fixture，本地 API/storage；无 React 私有对象 fixture。
- [x] `npm run verify:features` 连续三次通过。
- [x] `npm run build`：严格 TypeScript 和 Vite。
- [x] `git diff --check`。
- [x] package、lock、manifest、dist manifest、ZIP manifest 均为 3.0.1；ZIP/dist 文件名集合和文件内容逐一相同。
- [x] `dist_chrome` 与 ZIP 都不包含 `history-page.js`。
- [x] 所有修改限定 gpt/；claude/、gemini/ 与 a4bc0c56908df1e2643e1adb76c897f119891df2 一致。

## fixture 验收覆盖

- [x] manifest 只有 `content.js`，不存在 `history-page.js`。
- [x] 生产源码没有 `window.fetch` 劫持。
- [x] 生产源码没有 `IntersectionObserver` 包装。
- [x] 页面中不会创建 `chatgpt-yada-rail-host`。
- [x] 页面中不会创建自定义导航刻度。
- [x] 官方按钮原生 click 行为完全不受影响。
- [x] 官方按钮悬停后显示对应轮次预览。
- [x] 100～300 个官方按钮时仍能正确映射。
- [x] 两条提问正文相同时不会靠文字误匹配。
- [x] 索引无法唯一确定时不显示错误预览。
- [x] 灰色只显示 Harson；绿色显示 Harson + ChatGPT。
- [x] 角色标题绿色加粗。
- [x] 时间格式正确，缺失时不伪造。
- [x] 悬停一秒后两段正文分别由两行扩展到五行。
- [x] 预览不遮挡官方按钮，`pointer-events: none`。
- [x] 路由切换后旧预览、旧 API 请求和旧 timer 被清理。
- [x] 官方导航尚未出现时没有报错，也没有第二条导航。
- [x] 初始 18 轮 API 与 18 个官方按钮可映射。
- [x] 同一路由 API 更新为 19 轮并增加第 19 个官方按钮后，悬停显示「第 19 轮」。
- [x] 多次连续插入按钮只合并成有限请求。
- [x] API 请求进行中又出现新刻度时，结束后最多追加一次 pending refresh。
- [x] 第一次读取失败后，再次悬停未映射刻度可以恢复。
- [x] 已经能够映射的普通悬停不重复请求。
- [x] 复制全部、活动分支、附件占位、逐消息时间戳全部回归通过。
- [x] 提示词新增、编辑、删除、SVG 图标复制和本地持久化全部回归通过。
- [x] claude/、gemini/ 没有修改。

## MacBook 真实页面仍需复验

先按 `docs/OFFICIAL_NAVIGATION_SETUP.md` 安装 Yada 3.0.1 和 Chrome 应用商店中的原版 GPT Navigator Helper，并禁用其他导航插件。需要 Chrome / Edge 152 或更高。

- [ ] 约 18 轮真实对话：停在底部刷新，等待官方导航出现，点击官方刻度跳转，悬停查看 Harson / ChatGPT / 时间预览。
- [ ] 同一篇约 18 轮对话继续发送新消息，不刷新页面，悬停新增官方刻度应出现新轮次预览。
- [ ] 100+ 轮真实对话：停在底部刷新，不要手动往上滚，等待辅助插件加载更早记录，确认官方导航完整出现后再跳转。
- [ ] 100+ 轮对话继续新增消息后，新刻度悬停预览更新；已能映射的旧刻度不反复打转。
- [ ] 官方导航尚未出现时，复制全部和提示词仍可用，页面无报错，也没有 Yada 自己的导航条。
- [ ] 灰绿模式、Harson/ChatGPT 绿色标题、2/5 行展开、User 本地轮次时间与缺失时间。
- [ ] 提示词既有数据、三个纯图标、完整复制/对勾、编辑/删除、新增；确认不写入输入框。
- [ ] 真实账号复制全部、分页完整性、活动分支和逐消息时间戳。

HOSTED_CI = DISABLED_BY_OWNER_NO_QUOTA（NOT_USED_BY_POLICY）。未运行 CI、未创建 PR、未创建或调用 GitHub Actions。
