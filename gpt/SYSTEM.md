# ChatGPT Yada 系统

版本：**4.0.1**。

```text
ChatGPT Host
  ├─ Official Prompt Navigator
  │    ↑
  │    └─ Native History Hydrator
  │         ├─ document_start MAIN fetch hook
  │         ├─ metadata-only cursor chain
  │         └─ host pagination sentinel
  ├─ ConversationSync
  │    ├─ Copy All
  │    └─ current-conversation quota turns
  ├─ Vibe Bar quota reader
  │    └─ last-good baseline + staged reconciliation cache
  └─ Yada Toolbar
       ├─ Pro quota rings
       ├─ 复制全部
       └─ 提示词
```

## 官方导航

`native-navigator-main.js` 在 `document_start`、MAIN world 运行。它只包装 `window.fetch`，识别 chatgpt.com 同源、GET、地址栏当前 conversation 的已知 history endpoint。普通 initial request 的 `num_turns` 至少提升到 100；message 深链和所有不确定请求原样放行。

ChatGPT 立即得到原始 Promise 和 Response。旁路只读取 Response clone 的 id、role、cursor、root 和 branch 元数据，并通过同源 `postMessage` 传给 isolated controller。正文、Cookie 和认证信息不跨 bridge。

isolated controller 只在 visible、desktop hover、宽度至少 1024px、非 streaming、稳定 scroller 时工作。它每次只暴露唯一 pagination sentinel 一页，并持续检查可见消息锚点。漂移超过 8px、用户 wheel/touch/pointer/key、布局变化或 route/page 生命周期变化会释放临时样式并停止。共享上限为 60 秒 active、20 个 additional pages、每页 12 秒、最多 3 次 interruption recovery。

HistoryChain 只有在 initial → linked before cursor → explicit root 完整闭合时才认定 complete。重复 cursor、无进展、branch 改变或无法验证都会停止。历史完整后最多等待官方控件 2.5 秒；若仍不存在，状态为 `loaded-no-native`，不提供 fallback。

## 当前对话与额度

`ConversationSync` 仍是 Copy All 与当前会话 quota turns 的唯一当前对话快照。额度算法只在 calculator / ledger / Vibe Bar parser 中执行；UI 只展示 `QuotaSnapshot`。

`QuotaTracker` 直接维护 history timer / flight / abort；删除 mount 无条件 backfill、historyStopped、historyResumePending 和跨轮 historyPass 状态。数据 slice 与传输 retry 是一次 reconcile 内的局部计数，不再叠加旧 warmup 状态机。

- 实时路径：ConversationSync → 当前聊天 quota turns → Ledger → Calculator → QuotaSnapshot，写入 live events 后才读取可选 model limits。Copy All 与 ConversationSync 不变。
- 首次没有 complete + success timestamp 时同步最近 7 天。已有旧版 complete、但缺少时间戳时保留数字并校准；不伪造上次成功时间。
- fresh mount/reload 只读取持久状态，不调用完整 history reader；`lastHistorySuccessAt + 10min` 到期后后台校准。hidden 中止昂贵请求，visible 重新检查 freshness。失败后约 10 分钟再试，manual refresh 忽略 TTL 并立即同步当前会话。
- `historyComplete` 表达可信 baseline 是否已建立；已建立后 syncStatus 保持 ready。后台失败仅更新 `lastHistoryAttemptAt` / `lastHistoryError`，保留最后完整数据与 success time。
- 各 slice 复用内存 staging cache；完整成功后由 service worker 串行账本写入一次 `chrome.storage.local.set`，同时提交合并后的 events、history cache、history-wide unclassified 与三个时间/错误字段。并发 live events 保留，按 accountKey + eventId 去重；失败不发布部分结果。
- `lastHistorySuccessAt` 是完整提交时间；`lastHistoryAttemptAt` 是该轮开始时间；`lastHistoryError` 成功清空。get-state / popup / render 不写这三个字段。updatedLabel 显示真实上次完整同步时间与最近失败提示。
- 保持 7 天窗口、pageSize 50、maxPages 4、detailBudget 24、25 秒 reader 调度预算、history list 45 秒超时、其他 API 15 秒超时和原 detail 逻辑。
- budget/deadline 且成功读取了新 detail 才允许下一个数据 slice，最多 20 pass。timeout/network/408/500/502/503/504 单独最多两次 retry，退避 1.5 秒和 5 秒；永久错误立即结束。
- Ledger 仍保留 14 天事件；Calculator 依 now 的 24h / 7d 滚动筛选，chrome.alarms / nextAlarmAt 保持原路径。滚动恢复不依赖 full reconcile。
- 账号不明的临时网络错误不会被当成账号切换；真正 identity 变化重置 baseline。账本缺失、结构损坏或不兼容版本不沿用完整状态。多个 tab 允许偶发幂等校准，无 leader election/heartbeat。

额度状态仍为 `loading | backfill | ready | partial | error`，仅 first baseline 未建立时使用补齐/错误显示。详情卡仍使用独立 fixed Shadow DOM portal，三环 renderer 与 allowance 未改。

## 提示词顺序

PromptLibrary schema v2 使用 prompts 数组作为唯一排序。保留原 storage key 以读取 v1；首次读取 v1 时按旧 UI 的 updatedAt 降序生成 canonical order 并保存 v2，此后不再按时间排序。

官方 SortableJS 1.15.6 默认 ESM 入口包含 AutoScroll。仅卡片 header 的 18px 六点 SVG grip 可拖动，150ms animation、轻微透明，list 是 scroll container；不加入 React/Vue wrapper 或自写 pointer/scroll 状态机。drag end 读取 DOM ids，立即保存数组顺序，失败回滚旧顺序并提示。rerender、编辑、close、dispose 均销毁实例。

新增放顶部，编辑原位修改，删除保留其余顺序；复制不改变排序。不增加搜索、分类、云同步、导入导出或 composer 注入。
