# Changelog

## v4.0.2 - 2026-09-20

- 修复长对话 official Navigator 无法出现：PrepareSession 期间 initial 与 older pagination 合法请求都扩大到 `num_turns >= 100`，并使用 10 秒 lease + 4 秒 heartbeat，避免 MAIN 请求扩大泄漏。
- HistoryChain 在 transient stalled 时保留已验证 cursor 链；unlinked / branch mismatch 仍 fail closed。
- 官方 Navigator 按钮数与 API/captured prompt 数不一致不再作为 readiness 硬阻断；无自绘 fallback，不主动滚动。
- Quota、Prompt Library 拖拽、ConversationSync / Copy All 行为不变。
- 测试包 `ChatGPT-Yada-v4.0.2-official-only-UNVERIFIED.zip`；旧 4.0.0 / 4.0.1 包保留。Mac mini 产品测试不运行，MacBook 手工验收待执行。

## v4.0.1 - 2026-09-20

- 额度改为实时 local ledger、last-known-good baseline 和 10 分钟 stale-only reconciliation；fresh reload 不扫历史，刷新与失败保留已有数字。
- 完整结果统一提交账本、cache、unclassified 与成功/尝试/错误元数据；updatedLabel 使用真实完整同步时间。
- 数据进展最多 20 pass；传输失败最多两次重试，不再混用 20 pass；hidden 暂停，visible 过期才校准，manual refresh 忽略 TTL。
- 提示词使用 SortableJS 1.15.6（MIT）增加手柄拖拽、AutoScroll 和本地持久排序；v1 → v2 一次迁移保持旧视觉顺序，新增顶部、编辑原位、失败回滚。
- 写入长期版本规则，打包检查 package / lock / manifest / dist / ZIP 一致，保留旧 4.0.0 包。
- Official Navigator、ConversationSync、Copy All、三环 renderer、Vibe Bar allowance 与窗口保持不变。
- 测试包 `ChatGPT-Yada-v4.0.1-official-only-UNVERIFIED.zip`；Mac mini 产品测试不运行，MacBook 手工验收待执行。

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
