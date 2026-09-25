# ChatGPT Yada 系统

版本：**4.1.4**。

```text
ChatGPT Host
  ├─ Official Prompt Navigator
  │    ↑
  │    └─ Official Navigator Driver
  │         ├─ thin document_start MAIN request lifecycle hook
  │         ├─ route event + bounded prepare lease
  │         ├─ host pagination sentinel
  │         └─ official DOM stable-match detector
  ├─ ConversationSync
  │    ├─ complete conversation single truth
  │    ├─ Navigator expectedPrompts
  │    ├─ Copy All
  │    └─ current-conversation quota turns
  ├─ Vibe Bar quota reader
  │    └─ last-good baseline + staged reconciliation cache
  │    └─ Web Locks 跨标签单飞 7 天校准
  │    └─ on-demand rolling heatmap aggregation
  └─ Yada Toolbar
       ├─ Pro quota rings
       ├─ 复制全部
       └─ 提示词
```

## 运行生命周期

Yada 明确分成三个阶段。新工作必须进入其中一档，禁止把 BOOT 工作留在 STEADY。

### BOOT / PREPARE

打开、刷新或切换对话时允许：

- Conversation 初始读取
- Official Navigator history preparation（initial ≥100、PrepareSession、older pagination、10s lease、4s heartbeat）
- Toolbar 一次定位
- 本地额度读取

允许短时间集中消耗 CPU / 网络，目的是尽快把官方 Navigator 准备好。

### STEADY

官方 Navigator 已经成功、暂时没有新恢复证据或本次准备进入真正 stopped 后，必须进入极轻待机。

不再：

- 逐帧轮询 URL
- Navigator 全页面 MutationObserver / heartbeat / sentinel
- MAIN history clone / body reader / decode / JSON parse
- Toolbar 全 body subtree 观察
- 隐藏提示词或额度详情的全局 listener

只保留：

- MAIN route event（conversationId 变化）
- MAIN 轻量 history request lifecycle signal
- 回答完成检测（250ms debounce 的 ConversationSync observer）
- 当前聊天实时额度写入
- 用户按钮（三环 Canvas、复制全部、提示词）

### ON-DEMAND

只有用户点击提示词或额度三环，才创建对应的重 UI 和 document/window listener。关闭后 listener 必须卸掉；DOM 可以隐藏保留。

额度热力图严格属于 ON-DEMAND：页面加载不读取热力图数据、不创建 SVG/Tooltip/小时 timer。三环详情打开后，background 从现有 Ledger 按 allowance 聚合固定 cells；关闭后移除 renderer 与 listener。跨整点只使用一个指向下一整点后 50ms 的 `setTimeout`，不使用 interval、RAF、MutationObserver、历史扫描或新网络请求。

## 官方导航

`native-navigator-main.js` 在 `document_start`、MAIN world 运行。它只包装 `window.fetch`，识别 chatgpt.com 同源、GET、地址栏当前 conversation 的已知 history endpoint。可见页面上的合法 initial plural request 可以提前把 `num_turns` 至少提升到 100；只有 isolated PrepareSession 活跃时，同一 conversation 的 initial 与 older pagination 才会一起扩大。message 深链和所有不确定请求原样放行。Prepare 使用 10 秒 lease 与 4 秒 heartbeat；content script 消失、route/pagehide/generation 变化或 `prepare=false` 后立即停止扩大。

`history.pushState` / `replaceState` / `popstate` / `pageshow` 确认 conversationId 变化后，发送 `kind: "route"`。isolated content 收到后关闭面板、reset hydrator、同步当前对话。没有永久 `requestAnimationFrame` URL 轮询。

ChatGPT 始终得到原始 Promise 和原始 Response。MAIN 不调用 `response.clone()`、不读取 `body`、不使用 `TextDecoder`、不 `JSON.parse` history response。它只在合法请求开始、结束或 reject 时，通过同源 `postMessage` 发送 conversationId、generation、revision、history/older 计数、in-flight、request kind、HTTP status、duration、time、轻量 error 与 `boosted`。没有 `captureActive`；同 route 的后续请求始终可成为恢复证据。

isolated controller 从 `ConversationSync.activeTurns.length` 获得唯一 `expectedPrompts`。只有 visible、desktop hover、宽度至少 1024px、非 streaming、稳定 scroller 且 `expectedPrompts > 0` 时才进入 PrepareSession。它发送 prepare handshake、4 秒 heartbeat，并每次只暴露唯一 pagination sentinel 一页；发现 host history request start 立即释放 sentinel，等待 request end、短暂 settle 后重新检查 official DOM。漂移超过 8px、用户 wheel/touch/pointer/key、布局变化或 route/page 生命周期变化会释放临时样式、发送 prepare=false 并停止当前尝试。共享上限为 60 秒 active、20 个真实 older requests、每页 12 秒、最多 3 次 interruption recovery。

Navigator 不再构建 HistoryChain，也不拥有 messages、captured prompts、branch、cursor、boundary 或 explicit root。完成合同只有：`expectedPrompts > 0`、official `found === expectedPrompts`、至少一个按钮真实可见、root/container connected，并在同 root/container 上间隔约 300ms 稳定两次。祖先 `hidden` / `display:none` / `visibility:hidden` / `opacity:0` 与无 client rect 的按钮不计 visible。

状态只有五类：

- `waiting`：等待 ConversationSync snapshot、`expectedPrompts > 0` 或基础 DOM/layout；不运行 Sentinel。
- `preparing`：PrepareSession 正在驱动 host-owned pagination；每个真实 older request 计一次 page progress。
- `sleeping`：普通 HTTP/fetch transient、count mismatch、sentinel 12 秒无请求或暂时 layout/DOM 不可用。断开 MutationObserver、heartbeat、sentinel 与输入重 listener；没有固定 timer、轮询或 auto reload。同 conversation 新 transport lifecycle、ConversationSync snapshot、hidden → visible 或 route reset 才 wake。
- `ready`：稳定匹配两次后断开所有 heavy work，只保留 route、轻量 message listener 和共享 ConversationSync 生命周期。
- `stopped`：仅用于明确不支持的 deep link、dispose、60 秒 active、20 older requests 或 3 次用户 interruption recovery 耗尽。

不提供 fallback Navigator。普通官方 DOM 暂时缺失不是永久 terminal；它会在无进展后 sleeping，等待新证据。Hidden 页面释放当前 Sentinel 并 sleeping，因为 Sentinel 依赖阅读位置；重新 visible 可事件驱动恢复。

## 当前对话与额度

`ConversationSync` 是完整 current conversation 的唯一真相，同时服务 Navigator expectedPrompts、Copy All 与当前会话 quota turns。普通新回答走最近增量（`num_turns=16` 的一页，不翻旧页）；只有首次快照、复制全部、手动刷新、合并无法证明连续时才完整分页。同一时刻只有一个读取，多个 recent 合并，full 进行中覆盖 recent，recent 进行中最多追加一次 full。route 变化 abort 旧 generation，旧结果不发布。`requestRecent()` / `requestFull()` 的 Promise 在自己的 snapshot 已更新、`activeTurns` / `quotaTurns` 已合并并 `publish` 给 listener 之后才 resolve；不等 QuotaTracker 的网络附加工作。`publish` 立即更新 snapshot，listener 互相隔离，不等待对方的 Promise。完整请求的 timeout 覆盖 `fetch`、body 下载和 `response.json()`；外部 abort 在 body 阶段仍然有效。429 最多重试一次，5xx/timeout 不走 legacy endpoint，也不无限重试。

页面打开顺序是：Toolbar Shell 立即可见，然后等待当前对话、当前 generation 的 initial history 传输完成和一次 idle，再做首次 Full；15 秒内没有可匹配的传输完成信号时只 fallback 一次。PerformanceResourceTiming 只用来证明对应当前 initial 请求的 body 已经结束；同一 Document 里旧 route / 旧 generation 的 resource 必须忽略，无法可靠匹配时不猜测。复制全部不等待这个 Boot Gate。`expectedPrompts <= 0` 时 Navigator 不挂 whole-document observer。虚拟列表重新挂载已知 assistant id 不发请求。

额度算法只在 calculator / ledger / Vibe Bar parser 中执行；UI 只展示 `QuotaSnapshot`。MutationObserver 仍挂在 `document.documentElement`，但 callback 只调度 250ms debounce。hidden 页面不启动首次 Full；没有 baseline 时，回答完成仍允许一次 Full，避免后台回答漏记。

`QuotaTracker` 维护一个到期 timer、一次 idle callback 和最多一个 history flight。账号/套餐内存缓存 30 分钟，model limits 内存缓存 10 分钟；这不是历史扫描周期。手动刷新 bypass 当前对话缓存。实时 quotaTurns 仍然每次回答完成后立即写 Ledger，不依赖七天历史。

- 实时路径：Recent 或 Full → 当前聊天 quota turns → Ledger → Calculator → QuotaSnapshot。写入 live events 后才读取可选 model limits；limits 与上次指纹相同则不再写第二次。
- 自动日常核对最短 24 小时，且只在可见、非 streaming、Navigator 不在 preparing/heavy、BootGate 不再等待或执行首次 Full、ConversationSync 没有正在读、没有刚发生的用户输入时启动。任务未到期时只用一个 due timer；到期后用 `requestIdleCallback` 等一次页面空闲（API 不存在时退回普通 `setTimeout`）。默认只扫非归档列表，沿用 per-conversation `updatedAt`；revision 未变不读详情。
- 首次没有 baseline、账号变化、账本或 cache 不兼容、用户手动刷新，才同时扫描普通和 archived。不每 24 小时强制扫 archived。
- 一次调度机会只跑一个 slice。浏览器 detail budget 是 6。命中 budget 立即停止本 slice，保存已验证 cache，不把主动停止记成永久失败，也不在 1.5 秒后连跑 20 轮。
- 不完整 slice 持久化 history cache 和很小的 maintenance 状态，不覆盖 `historyComplete`、`lastHistorySuccessAt` 或正式完整 events。完整范围成功后一次提交 events、cache 和 success 状态。
- hidden 取消尚未开始的 slice，并 clear due timer / idle callback。已经开始的小 slice 只在 dispose 时 abort。Web Lock 仍保证多个标签只有一个维护任务。
- `quota/get-state` 只读 Snapshot，不重画图标、不重建 alarm、不广播。图标和广播还有一层展示指纹；rings、标题和下一 alarm 时间都不变时不重复 setIcon / setTitle / broadcast。
- 跨标签使用 `navigator.locks` 独占锁 `chatgpt-yada:quota-history-reconcile`，`ifAvailable: true`。拿不到锁时不报错、不清 last-good，把下一次机会推后 60 秒，并保留已有的 manual full / daily force；不能把用户手动 full 降成 daily 或直接取消。
- `historyComplete` 表达可信 baseline 是否已建立；已建立后 syncStatus 保持 ready。后台失败仅更新 `lastHistoryAttemptAt` / `lastHistoryError`，保留最后完整数据与 success time。
- 保持 7 天窗口、pageSize 50、maxPages 4、25 秒 reader 调度预算、history list 45 秒超时、其他 API 15 秒超时。手动刷新先等当前对话账本写完，再把 full repair 排成后续 slice，不假装几十秒内扫完七天。
- Ledger 仍保留 14 天事件；Calculator 依 now 的 24h / 7d 滚动筛选，chrome.alarms / nextAlarmAt 保持原路径。滚动恢复不依赖 full reconcile。
- 账号不明的临时网络错误不会被当成账号切换；真正 identity 变化重置 baseline。账本缺失、结构损坏或不兼容版本不沿用完整状态。

额度状态仍为 `loading | backfill | ready | partial | error`，仅 first baseline 未建立时使用补齐/错误显示。健康详情只显示三组已用次数、剩余百分比和上次完整同步；异常状态仍说明首次同步、失败或不完整原因。三环 Canvas 常驻；详情 Portal 第一次点击才创建。详情标题右侧有一个轻量刷新按钮：有完整 snapshot 时先 Recent，无法安全合并再一次 Full fallback；没有 baseline 时直接 Full。等待当前账本写入后才成功返回，再纯读取 Snapshot 并在弹窗仍打开时重画热力图。历史不完整或上次历史失败时只安排一个后台 idle slice，按钮不等待它，也不修改 `lastHistorySuccessAt`。Popup「立即刷新」仍走原来的 `quota/refresh-current` 重型路径。

`quota/get-heatmap` 只在健康、已知套餐、个人 Pro 可计费的详情打开状态请求。Service Worker 读取现有 Ledger，复用 `allowances(plan)` 的模型、周期与 Pro / ProLite 桶，在内存中按下一本地整点聚合；content 只接收 release hour、对应 usage hour、count 与 bucket 元数据，最多 216 cells，不接收 raw events。SVG renderer、共享 Tooltip 和整点 timer 在详情关闭时销毁。

## 提示词顺序

PromptLibrary schema v2 使用 prompts 数组作为唯一排序。保留原 storage key 以读取 v1；首次读取 v1 时按旧 UI 的 updatedAt 降序生成 canonical order 并保存 v2，此后不再按时间排序。

官方 SortableJS 1.15.6 默认 ESM 入口包含 AutoScroll。仅卡片 header 的 18px 六点 SVG grip 可拖动，150ms animation、轻微透明，list 是 scroll container；不加入 React/Vue wrapper 或自写 pointer/scroll 状态机。drag end 读取 DOM ids，立即保存数组顺序，失败回滚旧顺序并提示。rerender、编辑、close、dispose 均销毁实例。

新增放顶部，编辑原位修改，删除保留其余顺序；复制不改变排序。不增加搜索、分类、云同步、导入导出或 composer 注入。第一次点击工具栏按钮才实例化 PromptPanel；打开时才安装 document listener，关闭后卸掉。
