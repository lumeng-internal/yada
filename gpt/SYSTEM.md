# ChatGPT Yada 系统

版本：**4.0.3**。

```text
ChatGPT Host
  ├─ Official Prompt Navigator
  │    ↑
  │    └─ Native History Hydrator
  │         ├─ document_start MAIN fetch hook
  │         ├─ route event + parked fast-pass
  │         ├─ bounded prepare lease
  │         ├─ metadata-only cursor chain
  │         └─ host pagination sentinel
  ├─ ConversationSync
  │    ├─ Copy All
  │    └─ current-conversation quota turns
  ├─ Vibe Bar quota reader
  │    └─ last-good baseline + staged reconciliation cache
  │    └─ Web Locks 跨标签单飞 7 天校准
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

官方 Navigator 已经成功，或本次准备已经进入 terminal 后，必须进入极轻待机。

不再：

- 逐帧轮询 URL
- Navigator 全页面 MutationObserver / heartbeat / sentinel / history parsing
- MAIN history clone / parse / pending / broadcast
- Toolbar 全 body subtree 观察
- 隐藏提示词或额度详情的全局 listener

只保留：

- MAIN route event（conversationId 变化）
- 回答完成检测（250ms debounce 的 ConversationSync observer）
- 当前聊天实时额度写入
- 用户按钮（三环 Canvas、复制全部、提示词）

### ON-DEMAND

只有用户点击提示词或额度三环，才创建对应的重 UI 和 document/window listener。关闭后 listener 必须卸掉；DOM 可以隐藏保留。

## 官方导航

`native-navigator-main.js` 在 `document_start`、MAIN world 运行。它只包装 `window.fetch`，识别 chatgpt.com 同源、GET、地址栏当前 conversation 的已知 history endpoint。可见页面上的合法 initial plural request 可以提前把 `num_turns` 至少提升到 100；只有 isolated PrepareSession 活跃时，同一 conversation 的 initial 与 older pagination 才会一起扩大。message 深链和所有不确定请求原样放行。Prepare 使用 10 秒 lease 与 4 秒 heartbeat；content script 消失、route/pagehide/generation 变化或 `prepare=false` 后立即停止扩大。

`history.pushState` / `replaceState` / `popstate` / `pageshow` 确认 conversationId 变化后，发送 `kind: "route"`。isolated content 收到后关闭面板、reset hydrator、同步当前对话。没有永久 `requestAnimationFrame` URL 轮询。

ChatGPT 立即得到原始 Promise 和 Response。旁路只读取 Response clone 的 id、role、cursor、root 和 branch 元数据，并通过同源 `postMessage` 传给 isolated controller。正文、Cookie 和认证信息不跨 bridge。Navigator terminal 后 MAIN `captureActive=false`，后续 fetch 只多一个 boolean 判断后直通 native fetch。SPA 切换对话时 `synchronizeRoute()` 会重新打开 capture。

isolated controller 只在 visible、desktop hover、宽度至少 1024px、非 streaming、稳定 scroller 时进入 PrepareSession。它发送 prepare handshake、4 秒 heartbeat，并每次只暴露唯一 pagination sentinel 一页，持续检查可见消息锚点。漂移超过 8px、用户 wheel/touch/pointer/key、布局变化或 route/page 生命周期变化会释放临时样式、发送 prepare=false 并停止。共享上限为 60 秒 active、20 个 additional pages、每页 12 秒、最多 3 次 interruption recovery。

HistoryChain 只有在 initial → linked before cursor → explicit root 完整闭合时才认定 complete。重复 cursor 或暂时无进展记为 `stalled`，但保留已经验证的 cursor 链；unlinked、limit 或明确 branch 变化仍然 fail closed。历史完整后最多等待官方控件 2.5 秒；官方 Navigator `found > 0` 且 `visible > 0` 即为 ready。ready-complete、loaded-no-native、deep-link、limit、unverified 等 terminal 状态会 park 重观察：断开 MutationObserver、清 timer/heartbeat、卸掉输入与 resize/visibility listener，并通知 MAIN park。只保留极轻的 window message listener。route change 时重新 arm。

若仍不存在官方 Navigator，状态为 `loaded-no-native`，不提供 fallback。Hidden 页面立即停止 Navigator，因为 Sentinel 依赖阅读位置。

## 当前对话与额度

`ConversationSync` 仍是 Copy All 与当前会话 quota turns 的唯一当前对话快照。额度算法只在 calculator / ledger / Vibe Bar parser 中执行；UI 只展示 `QuotaSnapshot`。MutationObserver 仍挂在 `document.documentElement`，但 callback 只调度 250ms debounce；streaming 中不读完整 Conversation API，streaming 结束或出现新的 stable assistant id 才 `requestSync()`。hidden 标签仍检测回答完成。

`QuotaTracker` 直接维护 history timer / flight / abort。账号/套餐内存缓存 30 分钟，model limits 内存缓存 10 分钟；手动刷新 bypass。实时 quotaTurns 仍然每次回答完成后立即写 Ledger。

- 实时路径：ConversationSync → 当前聊天 quota turns → Ledger → Calculator → QuotaSnapshot，写入 live events 后才读取可选 model limits。Copy All 与 ConversationSync 不变。
- 首次没有 complete + success timestamp 时同步最近 7 天。已有旧版 complete、但缺少时间戳时保留数字并校准；不伪造上次成功时间。
- fresh mount/reload 只读取持久状态，不调用完整 history reader；`lastHistorySuccessAt + 10min` 到期后后台校准。hidden 不能启动新的完整 history scan；已经拿到 Web Lock 并开始的 scan 不因 hidden abort。失败后约 10 分钟再试，manual refresh 忽略 TTL 并立即同步当前会话。
- 跨标签使用 `navigator.locks` 独占锁 `chatgpt-yada:quota-history-reconcile`，`ifAvailable: true`。拿不到锁时不报错、不清 last-good，把 `nextHistoryAt` 推后 60 秒。没有 Web Locks 时回退为只有 visible tab 能开始完整校准。
- `historyComplete` 表达可信 baseline 是否已建立；已建立后 syncStatus 保持 ready。后台失败仅更新 `lastHistoryAttemptAt` / `lastHistoryError`，保留最后完整数据与 success time。
- 各 slice 复用内存 staging cache；完整成功后由 service worker 串行账本写入一次 `chrome.storage.local.set`，同时提交合并后的 events、history cache、history-wide unclassified 与三个时间/错误字段。并发 live events 保留，按 accountKey + eventId 去重；失败不发布部分结果。
- `lastHistorySuccessAt` 是完整提交时间；`lastHistoryAttemptAt` 是该轮开始时间；`lastHistoryError` 成功清空。get-state / popup / render 不写这三个字段。updatedLabel 显示真实上次完整同步时间与最近失败提示。
- 保持 7 天窗口、pageSize 50、maxPages 4、detailBudget 24、25 秒 reader 调度预算、history list 45 秒超时、其他 API 15 秒超时和原 detail 逻辑。
- budget/deadline 且成功读取了新 detail 才允许下一个数据 slice，最多 20 pass。timeout/network/408/500/502/503/504 单独最多两次 retry，退避 1.5 秒和 5 秒；永久错误立即结束。
- Ledger 仍保留 14 天事件；Calculator 依 now 的 24h / 7d 滚动筛选，chrome.alarms / nextAlarmAt 保持原路径。滚动恢复不依赖 full reconcile。
- 账号不明的临时网络错误不会被当成账号切换；真正 identity 变化重置 baseline。账本缺失、结构损坏或不兼容版本不沿用完整状态。

额度状态仍为 `loading | backfill | ready | partial | error`，仅 first baseline 未建立时使用补齐/错误显示。健康详情只显示三组预计剩余和上次完整同步；异常状态仍说明首次同步、失败或不完整原因。三环 Canvas 常驻；详情 Portal 第一次点击才创建。

## 提示词顺序

PromptLibrary schema v2 使用 prompts 数组作为唯一排序。保留原 storage key 以读取 v1；首次读取 v1 时按旧 UI 的 updatedAt 降序生成 canonical order 并保存 v2，此后不再按时间排序。

官方 SortableJS 1.15.6 默认 ESM 入口包含 AutoScroll。仅卡片 header 的 18px 六点 SVG grip 可拖动，150ms animation、轻微透明，list 是 scroll container；不加入 React/Vue wrapper 或自写 pointer/scroll 状态机。drag end 读取 DOM ids，立即保存数组顺序，失败回滚旧顺序并提示。rerender、编辑、close、dispose 均销毁实例。

新增放顶部，编辑原位修改，删除保留其余顺序；复制不改变排序。不增加搜索、分类、云同步、导入导出或 composer 注入。第一次点击工具栏按钮才实例化 PromptPanel；打开时才安装 document listener，关闭后卸掉。
