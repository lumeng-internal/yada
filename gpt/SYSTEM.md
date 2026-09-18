# ChatGPT Yada 系统

版本 **4.0.0**。唯一数据流：

```text
业务事件
   ↓
ConversationSync
   ↓
readConversation()
   ↓
ConversationSnapshot
   │
   ├─ activeTurns
   │    ├─ Rail
   │    ├─ Preview
   │    └─ Copy All
   │
   └─ quota source
        ↓
  Vibe Bar-compatible parser
        ↓
    Local Ledger
        ├─ Action 三环
        └─ Popup
```

读取当前对话只有一个入口：`readConversation()`。当前对话状态只有一份：`ConversationSnapshot`。导航、复制、额度都不读第二份当前对话。历史额度扫描可以读历史对话，但复用同一 parser。UI 不负责业务读取。Service Worker 不抓 ChatGPT 页面。

完整同步只允许四类事件：路由 `conversationId` 变化、Assistant streaming `true→false`、新的稳定 Assistant `messageId`、Popup「立即刷新」。

导航只有 Direct（目标已渲染）和 Virtual（Luna 最小核心）。没有官方 TOC 路径。
