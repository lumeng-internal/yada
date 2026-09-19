# Changelog

## v4.0.0 - 2026-09-19

- 产品方向改为只使用 ChatGPT 官方 Prompt Navigator。
- 删除 Yada Rail、导航 hover preview、绿色模式点、Direct / Official Button Proxy / Stable Slot 跳转、官方导航隐藏和空 `?message=` preparation。
- 新增 `document_start` MAIN-world history hook：只扩大当前对话合法 initial history request，并从 Response clone 读取 metadata。
- 新增 bounded native history hydrator：使用 ChatGPT 自己的 pagination sentinel，不滚动页面；包含 cursor chain、阅读位置漂移保护、用户操作让权、共享恢复预算和 deep-link 排除。
- 若 ChatGPT 最终不提供官方 Navigator，停止主动动作，不绘制 fallback。
- 保留 ConversationSync、复制全部、真实时间戳和提示词库。
- Pro 额度从单次扫描改为持久 cache 的渐进式有界补齐；新增 loading / backfill / ready / partial / error 状态。
- 三环详情移至 body 下独立 fixed Shadow DOM portal，避免 ChatGPT Header 裁切。
- 构建产物：`ChatGPT-Yada-v4.0.0-official-only-UNVERIFIED.zip`；MacBook 手工验收前不发布正式 Release 包。

## v3.0.1 - 2026-09-17

- 同一对话继续新增消息后刷新导航预览数据；请求合并防抖。

## v3.0.0 - 2026-09-17

- 引入 ConversationSync、复制、时间戳、提示词和早期官方导航集成。
