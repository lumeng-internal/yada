# ChatGPT Yada

ChatGPT Yada 4.1.3 是一个轻量 Chrome MV3 扩展。它通过补齐 ChatGPT 自己的历史加载，恢复并保留官方长对话 Prompt Navigator，同时不移动读者的当前位置。

4.1.3 保持 4.1.2 的运行时方向：工具栏先出现，新回答只读最近增量，历史核对不再每 10 分钟全量扫描。本轮只收口 Recent 完成合同、Quota idle 调度、手动 full 的 Web Lock 重试，以及 BootGate 对旧 resource timing 的隔离。

Yada 不再绘制右侧导航条，也没有导航预览、绿色模式点或代理跳转。页面工具栏只有：`Pro 额度三环 | 复制全部 | 提示词`。

## 功能

- **官方导航恢复**：MAIN-world hook 只识别当前对话的历史 GET、提升合法 `num_turns` 并记录 request start/end/error；它不 clone、不读取、不解析 Response body。isolated 侧从 ConversationSync 获得 `expectedPrompts`，一次只临时暴露 ChatGPT 自己的 pagination sentinel；官方 Navigator 数量匹配且连续稳定两次后进入 ready 并休眠。Yada 不滚动、不 reload、不生成 fallback 导航。
- **阅读位置保护**：保存可见消息身份和 viewport offset；漂移超过 8px、用户操作、streaming、隐藏页面或布局变化都会立即停止本轮 hydration。
- **复制全部**：导出当前活动分支 Markdown 和真实时间戳。
- **提示词**：本地收藏、编辑、删除与复制；支持本地拖拽排序，顺序自动保存。新增放顶部，编辑不改变顺序。第一次点击「提示词」才创建面板。
- **Pro 额度**：当前回答完成后本地记账。已有可信基线时，自动核对不少于 24 小时一次，并且每次只跑一个有界 slice；首次、账号变化或手动刷新才做普通加归档的完整修复。后台刷新不会清空已有额度。沿用 Vibe Bar 规则与 `model_limits`，这是本地估算，不是 OpenAI 官方余额。
- **Pro 使用量滚动热力图**：只在用户打开三环详情时，Service Worker 从现有 `QuotaLedgerState.events` 按 allowance 在内存中聚合；页面只收到最多 216 个小时 cell。24 小时图从下一个完整小时开始，7 天图按 7 行 × 24 列连续排列；关闭详情即移除 SVG、共享 Tooltip、事件委托与整点 timer。
- **同一份额度数据**：页面三环、浏览器 Action 图标和 popup 都读取同一个 `QuotaSnapshot`。热力图不保存第二份长期数据，不新增 ChatGPT 网络请求，也不返回原始事件。

message / messageId 深链保持原样，Yada 不介入 hydration。普通网络、DOM 或 host pagination 暂时不可用时进入轻量 sleeping；同 conversation 的新请求、ConversationSync snapshot、重新可见或 route reset 会事件驱动恢复。只有明确深链、60 秒 active budget、20 个真实 older requests 或用户恢复预算耗尽才 stopped。官方 Navigator 按钮数必须与 `expectedPrompts > 0` 精确匹配才可 ready。

## 安装测试包

需要已登录 ChatGPT 的 Chrome 或 Edge。

1. 加载 `gpt/dist_chrome`，或解压 `ChatGPT-Yada-v4.1.3-official-only-UNVERIFIED.zip` 后加载其中的 `dist_chrome`。
2. 刷新 ChatGPT 标签页。

该包是手工验收包，不是正式 Release。Mac mini 不执行产品测试；MacBook Edge 与真实 10～15 标签的验收状态见 `QA.md`。

## 隐私与边界

MAIN-world bridge 只传递 conversation id、generation、history/older 请求计数、in-flight、HTTP status、duration、time、request kind/error 和 `boosted`。MAIN 不读取 Response body，因此不传消息正文、消息 id、branch、cursor 或完整 payload。`boosted` 只存在于当前 tab 的临时状态，不写入 `chrome.storage`。`chrome.storage.local` 只保存提示词、额度事件元数据和额度历史缓存；不保存提问/回复正文、Cookie、Token 或 Authorization。不接入外部服务。

## 本地工程验证

```bash
npm ci
npm test
npm run build
npm run verify:gate
git diff --check
npm run package
```

旧测试包保留，新的 4.1.3 包不覆盖 4.0.3、4.0.4、4.1.0、4.1.1、4.1.2。打包会检查 package、lockfile、两份 manifest 与 ZIP 版本一致。

不运行 Mac mini 浏览器验收、GitHub Actions、PR 或 Release。

## 许可证

`gpt/` 使用 AGPL-3.0-only。额度核心移植自 Vibe Bar；热力图窄范围移植并适配 Cal-Heatmap 与 `@uiw/react-heat-map` 的 MIT 源码，但未引入其 React、D3、Popper 或 dayjs 运行时。AI-MarkDone 的少量官方 Navigator DOM 识别结构按 MIT 合规复用。详见 `NOTICE.md` 与 `THIRD_PARTY_NOTICES.md`。
