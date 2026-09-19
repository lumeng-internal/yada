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
   │    ├─ Rail（完整轮次）
   │    ├─ Preview
   │    ├─ Copy All
   │    └─ NativeNavigationPort
   │         ├─ Direct
   │         ├─ Official Button
   │         └─ Stable Slot
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

导航身份是 `userMessageId`，正文只用于预览。官方导航仅在 Yada Rail 已显示完整轮次、且官方根节点可唯一识别时视觉隐藏；DOM 与按钮保留，程序仍可点击。Direct 必须确认目标进入视口后才算成功。每篇对话、每个标签页最多一次空 `?message=` 原生准备；准备后会短暂等待官方按钮或稳定槽位，不因首帧不完整立即写成 unsupported。`sessionStorage` 状态为 unseen / attempted / ready / unsupported。Luna 虚拟搜索已从生产路径删除。
