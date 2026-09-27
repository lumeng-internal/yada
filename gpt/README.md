# ChatGPT Yada

ChatGPT Yada **4.1.6** 是一个轻量 Chrome MV3 扩展。它通过补齐 ChatGPT 自己的历史加载，恢复并保留官方长对话 Prompt Navigator，同时不移动读者的当前位置。

当前正在使用的候选不是 `main`。本轮候选分支是 `work/gpt-yada-native-compat`，版本 **4.1.6**。`main` 仍可能停在更旧的提交；MacBook 不要“拉最新 main”来安装这一包。

4.1.5 在 4.1.4 之上做兼容修复：统一 ChatGPT 页面识别；导航“正在等待”不再挡住额度历史维护；工具栏改为页面级独立宿主，用 Floating UI 跟随原生操作区。官方导航的自动恢复路径仍是现有 MAIN `num_turns` 提升 + 分页 sentinel；**真实 Edge 上“ChatGPT 自己加载历史 → 官方导航出现”尚未复验**。

Yada 不再绘制右侧导航条，也没有导航预览、绿色模式点或代理跳转。页面工具栏只有：`Pro 额度三环 | 复制全部 | 提示词`。

## 功能

- **官方导航**：MAIN-world hook 只识别当前对话的历史 GET、提升合法 `num_turns` 并记录 request start/end/error；它不 clone、不读取、不解析 Response body。isolated 侧从 ConversationSync 获得 `expectedPrompts`，一次只临时暴露 ChatGPT 自己的 pagination sentinel。官方 Navigator **可用**、**完整**、Yada **正在准备** 是三件分开的事。导航可用且连续稳定两次后进入 ready 并休眠；完整性单独保留 matching/mismatch/unknown。API 89 / 官方 88 记为 mismatch，不假报完整，也不无限重试。Yada 不滚动、不 reload、不把空的 `?message=` 当成自动恢复，不生成 fallback 导航。
- **页面识别**：`pageFacts.ts` 同时适配旧 role 属性和新版 turn / search-unit 结构。角色标题只是线索；去重和完成判断使用消息容器稳定 ID。`overflow-anchor: none` 和负 `scrollTop` 不再一票否决阅读位置保护。
- **阅读位置保护**：保存可见消息身份和 viewport offset；漂移超过 8px、用户操作、streaming、隐藏页面或布局变化都会立即停止本轮 hydration。
- **复制全部**：导出当前活动分支 Markdown 和真实时间戳。
- **提示词**：本地收藏、编辑、删除与复制；支持本地拖拽排序，顺序自动保存。新增放顶部，编辑不改变顺序。第一次点击「提示词」才创建面板。卡片本身不执行操作；复制、编辑、删除仍是纯 SVG 图标。
- **Pro 额度**：当前回答完成后本地记账。额度详情标题右侧可手动轻刷新当前对话数据；这不会重载 ChatGPT 页面，也不会把「上次完整同步」改成刚刚。已有可信基线时，自动核对不少于 24 小时一次，并且每次只跑一个有界 slice；首次、账号变化或手动刷新才做普通加归档的完整修复。后台刷新不会清空已有额度。沿用 Vibe Bar 规则与 `model_limits`，这是本地估算，不是 OpenAI 官方余额。导航等待页面时不再占用重任务，也不再因此挡住到期维护。
- **Pro 使用量滚动热力图**：只在用户打开三环详情时，Service Worker 从现有 `QuotaLedgerState.events` 按 allowance 在内存中聚合；页面只收到最多 216 个小时 cell。24 小时图从下一个完整小时开始，7 天图按 7 行 × 24 列连续排列；关闭详情即移除 SVG、共享 Tooltip、事件委托与整点 timer。
- **同一份额度数据**：页面三环、浏览器 Action 图标和 popup 都读取同一个 `QuotaSnapshot`。热力图不保存第二份长期数据，不新增 ChatGPT 网络请求，也不返回原始事件。
- **工具栏定位**：宿主挂在 `document.documentElement`，自有 Shadow DOM，不插入 ChatGPT Header。`@floating-ui/dom` 1.8.0 默认放在原生操作组左侧约 8px；越界时尝试下方靠右。与原生按钮或正文重叠则保持隐藏等待，不使用 `right:88px`。

message / messageId 深链保持原样，Yada 不介入 hydration。普通网络、DOM 或 host pagination 暂时不可用时进入轻量 sleeping；同 conversation 的新请求、ConversationSync snapshot、重新可见或 route reset 会事件驱动恢复。只有明确深链、60 秒 **实际执行** budget、20 个真实 older requests 或用户恢复预算耗尽才 stopped。官方 Navigator 按钮数必须与 `expectedPrompts > 0` 精确匹配才可报完整；ready 只表示稳定可用。

## 安装测试包

需要已登录 ChatGPT 的 Chrome 或 Edge。

**不要从 `main` 安装本轮候选。** 使用：

1. 分支 `work/gpt-yada-native-compat` 上的 `gpt/dist_chrome`，或
2. 解压 `gpt/ChatGPT-Yada-v4.1.6-official-only-UNVERIFIED.zip` 后加载其中的 `dist_chrome`。

保持现有扩展身份和加载目录，不要卸载换目录，也不要清空提示词和额度数据。

该包是手工验收包，不是正式 Release。本轮已原位更新 MacBook 实际加载目录。真机验收状态见 `QA.md`。

## 隐私与边界

MAIN-world bridge 只传递 conversation id、generation、history/older 请求计数、in-flight、HTTP status、duration、time、request kind/error 和 `boosted`。MAIN 不读取 Response body，因此不传消息正文、消息 id、branch、cursor 或完整 payload。`boosted` 只存在于当前 tab 的临时状态，不写入 `chrome.storage`。`chrome.storage.local` 只保存提示词、额度事件元数据和额度历史缓存；不保存提问/回复正文、Cookie、Token 或 Authorization。不接入外部服务。

## 本地工程验证

```bash
npm ci
npm test
npm run verify:copy
npm run build
npm run verify:gate
git diff --check
npm run package
```

旧测试包保留，新的 4.1.5 包不覆盖 4.1.4 及更早版本。打包会检查 package、lockfile、两份 manifest 与 ZIP 版本一致。

不运行 GitHub Actions、PR 或 Release。不把 Mac mini 的会议浏览器或模拟页面当成 Harson 的真实 Edge。

## 许可证

`gpt/` 使用 AGPL-3.0-only。额度核心移植自 Vibe Bar；热力图窄范围移植并适配 Cal-Heatmap 与 `@uiw/react-heat-map` 的 MIT 源码，但未引入其 React、D3、Popper 或 dayjs 运行时。AI-MarkDone `8269364d7162712d1eb45a27937e00116f8e1ca7` 的消息身份 / 生成状态 / 官方导航结构按 MIT 合规复用。工具栏定位使用 `@floating-ui/dom` 1.8.0（MIT）。详见 `NOTICE.md` 与 `THIRD_PARTY_NOTICES.md`。

## MacBook 2026-09-27 4.1.6 closeout

候选分支保持 `work/gpt-yada-native-compat`。本机 Edge 原位加载路径为 `/Users/harsonru/Documents/ChatGPT-Yada-v2.1.0`，扩展 ID 保持 `abdfkmhjbchcmblijimlonobmklkpkjg`。

- 清理所有带 Yada 所有权标记的重复 Toolbar Host；无有效矩形时不启动 Floating UI 异步定位。隐藏页面解除定位观察，Header 替换后继续定位同一 Host。
- 新版 Timeline：User bubble 向上取完整容器身份；角色属性只用于角色判断；已知 Timeline 为快速路径；通用祖先必须有实际滚动范围。负 scrollTop、column-reverse、overflow-anchor:none 均正常。
- 官方导航稳定可用时休眠，89/88 保留 completeness=mismatch。只有真实历史请求启动/结束才唤醒失败准备；prepare ACK revision 不能自唤醒。
- Floating UI 在 shell/app jsdom 单测中隔离。未修改 Vitest 超时或错误检查；真机几何不能由这组单测替代。
- OFFICIAL_NAV_AUTO_RESTORE = BLOCKED：真实页面 initial num_turns=100 / HTTP 200 后无官方导航，旧 sentinel 为 0；新版历史加载绑定用户手势/边界或内容不足一屏的 ResizeObserver，没有安全的公开触发入口；单独测试空 message + 一次 reload 仍无导航。未接入自动 message fallback，不添加第四种导航系统。
- main 只有核心真机合同全部通过才可普通快进推送。本轮导航阻塞，main 不变。CI、PR、Release 均不使用。真机记录见 QA.md。
