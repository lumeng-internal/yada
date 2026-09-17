# ChatGPT Yada v3.1.0 测试清单

ChatGPT Yada 3.1.0 是单一扩展。正式进入 main 前，仍需 MacBook 在真实 ChatGPT 长对话上验收。需要 Chrome / Edge 152 或更高。用户不再单独安装 GPT Navigator Helper。

## Mac mini 本地验证

以下本地验证已于 2026-09-18 在 Mac mini 执行。不能当作真实 ChatGPT 页面验收。

- [x] `npm run verify:copy`：完整复制、附件占位、独立真实时间戳与缺失/无效时间回归。
- [x] `npm run verify:features`：Chrome 无头模式，官方按钮预览 / 映射 / 提示词 / API fixture / native bootstrap，本地 API/storage；无 React 私有对象 fixture。
- [x] `npm run verify:features` 连续五次通过。
- [x] `npm run build`：严格 TypeScript、Vite 与 `native-bootstrap-page.js`。
- [x] `git diff --check`。
- [x] package、lock、manifest、dist manifest、ZIP manifest 均为 3.1.0；ZIP/dist 文件名集合和文件内容逐一相同。
- [x] `dist_chrome` 与 ZIP 都包含 `native-bootstrap-page.js`，不包含 `src/history`、`src/rail` 或自定义导航代码。
- [x] 所有修改限定 gpt/；claude/、gemini/ 与 a4bc0c56908df1e2643e1adb76c897f119891df2 一致。

## fixture 验收覆盖

- [x] 当前会话初始 GET 的 num_turns=5 被提升为 100。
- [x] 已经 num_turns=200 不被降低。
- [x] Request + init 的 signal、headers、credentials、cache 全部保留。
- [x] POST、SSE、其他会话、message deep link 不被修改。
- [x] prepare 未启动时，普通 older request 不被额外扩大。
- [x] prepare 启动时，当前会话 older request 扩大到 100。
- [x] 10 秒心跳过期后自动关闭 boost。
- [x] 初始页 + 两个 older 页正确拼成连续链。
- [x] has_previous_page=false 判定 complete。
- [x] 重复 cursor 停止。
- [x] 空页、重复消息、分支变化和乱序响应不会误判完整。
- [x] 原始 fetch Promise 和原始 Response 不被替换。
- [x] 18 轮对话刷新后，自动加载并让官方导航出现。
- [x] 150 轮 fixture 经过多页加载后官方导航完整。
- [x] 每次只有一个分页请求。
- [x] sentinel 样式在请求开始、失败、中断后全部恢复。
- [x] 整个过程不修改 scrollTop。
- [x] 阅读位置漂移超过 8px 时停止。
- [x] wheel / touch / pointer / 键盘立即停止。
- [x] 空闲 2.5 秒后最多恢复 3 次。
- [x] 整体最多 20 页、60 秒。
- [x] 页面隐藏、生成回答、窄屏、深链时不启动。
- [x] 官方导航完整后不再请求。
- [x] 同一对话新增第 19 轮后预览继续更新。
- [x] 页面没有 Yada 自定义导航条或刻度。
- [x] 官方按钮点击行为不变。
- [x] 灰色 / 绿色预览正常。
- [x] Harson / ChatGPT / 时间正常。
- [x] 复制全部、当前分支、附件占位、双方时间戳正常。
- [x] 提示词新增、复制、编辑、删除正常。
- [x] claude/、gemini/ 未修改。

## MacBook 真实页面仍需复验

先按 `docs/OFFICIAL_NAVIGATION_SETUP.md` 安装 Yada 3.1.0，并禁用其他导航插件。需要 Chrome / Edge 152 或更高。不要再安装 GPT Navigator Helper。

- [ ] 约 18 轮真实对话：停在底部刷新，等待官方导航出现，点击官方刻度跳转，悬停查看 Harson / ChatGPT / 时间预览。
- [ ] 同一篇约 18 轮对话继续发送新消息，不刷新页面，悬停新增官方刻度应出现新轮次预览。
- [ ] 100+ 轮真实对话：停在底部刷新，不要手动往上滚，等待 Yada 自动加载更早记录，确认官方导航完整出现后再跳转。
- [ ] 100+ 轮对话继续新增消息后，新刻度悬停预览更新；已能映射的旧刻度不反复打转。
- [ ] 滚动、点按或键盘操作应立即停止自动准备；停手约 2.5 秒后可以有限恢复。
- [ ] 官方导航尚未出现时，复制全部和提示词仍可用，页面无报错，也没有 Yada 自己的导航条。
- [ ] 灰绿模式、Harson/ChatGPT 绿色标题、2/5 行展开、User 本地轮次时间与缺失时间。
- [ ] 提示词既有数据、三个纯图标、完整复制/对勾、编辑/删除、新增；确认不写入输入框。
- [ ] 真实账号复制全部、分页完整性、活动分支和逐消息时间戳。

HOSTED_CI = DISABLED_BY_OWNER_NO_QUOTA（NOT_USED_BY_POLICY）。未运行 CI、未创建 PR、未创建或调用 GitHub Actions。
