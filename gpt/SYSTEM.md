# ChatGPT Yada 系统

版本：**4.0.0**。

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
  │    └─ progressive persistent history cache
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

`QuotaTracker` 使用同一个持久 cache 进行多个有界 history slice。每轮仍保持 Vibe Bar 的 7 天窗口、page size 50、最多 4 页、detail budget 24、25 秒 deadline。只有 budget/deadline 未完成时才短暂等待后继续；账号切换重置，hidden 暂停，complete 停止，持久错误不循环重试。

额度状态为 `loading | backfill | ready | partial | error`。补齐或部分状态不猜剩余数字。详情卡在 document body 下的独立 Shadow DOM portal 中 fixed 定位，不受 ChatGPT Header clipping context 影响。
