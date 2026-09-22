# Changelog

## v4.1.1 - 2026-09-22

- 7×24 热力图左侧日期改为对应行的历史使用日期；滚动起点、小时列、Tooltip、颜色与两张 24h 图保持不变。
- 三组额度文案统一为“已用 X / 上限”，X 直接使用现有 `metric.used`；环形与百分比继续显示剩余比例。
- 测试包 `ChatGPT-Yada-v4.1.1-official-only-UNVERIFIED.zip`；不执行 PR、CI、merge 或 Release。

## v4.1.0 - 2026-09-22

- 新增 Pro 使用量滚动热力图：GPT-6 Pro 为 7×24，Sol Pro 与组合桶为 1×24；第一格固定从下一个本地完整小时开始，Tooltip 显示对应历史使用小时和精确次数。
- 新增 `quota/get-heatmap` 按需消息。Service Worker 只读取现有 Ledger 并复用 Vibe Bar allowance；content 最多接收 216 个聚合 cell，不接收 raw events，不新增 ChatGPT 请求、历史扫描或长期 heatmap 数据。
- 热力图仅在三环详情打开时创建 SVG、一个共享 Tooltip、事件委托和单个整点 `setTimeout`；关闭即清理。无 legend、动画、RAF、interval、MutationObserver 或常驻后台过程。
- SVG rect grid、动态 panel colors 与 hover 合规移植自 `@uiw/react-heat-map` v2.3.4；rolling hour/day 和 Tooltip lifecycle 合规移植自 Cal-Heatmap 4.2.4。未引入 React、ReactDOM、D3、Popper、dayjs 或第三方图表运行时。
- 4.0.4 Navigator、ConversationSync、QuotaTracker、Web Locks、Prompt drag、Copy All 与 Toolbar 架构保持不变。
- 测试包 `ChatGPT-Yada-v4.1.0-official-only-UNVERIFIED.zip`；真实 MacBook 产品验收待执行。

## v4.0.4 - 2026-09-22

- Navigator 收口为单一完整对话真相：`ConversationSync.activeTurns.length` 是唯一 `expectedPrompts`；删除 Navigator 自建的 message/branch/cursor/boundary/explicit-root `HistoryChain` 与 `metadata.ts`。
- MAIN hook 收敛为 route、合法 history GET 的 `num_turns` boost 与 start/end/error lifecycle；不再 clone、读取、decode 或 `JSON.parse` history Response，页面继续得到原始 Promise/Response。
- 删除 `captureActive` 与 park handshake。普通 HTTP、DOM、count mismatch 或 sentinel 暂时无请求进入 event-driven sleeping；同 conversation 新 transport event、snapshot、重新可见或 route reset 可自动恢复。
- ready 合同改为 `expectedPrompts > 0`、official count 精确匹配、真实可见，并在同 root/container 上间隔约 300ms 稳定两次；`expectedPrompts=0` 永远 waiting。
- 完整 conversation 单请求默认 timeout 从 10 秒提高到 30 秒；429 仍只等待后重试一次，5xx/timeout 不增加无限重试。
- hidden idle tab 不主动执行首次完整 snapshot；streaming end、新 stable assistant、Copy All、额度手动刷新或重新 visible 仍通过 ConversationSync 读取。
- Quota、Prompt、Copy All、Toolbar 与 Theme 冻结；不加入 Heatmap 或新依赖。
- 测试包 `ChatGPT-Yada-v4.0.4-official-only-UNVERIFIED.zip`；MacBook 固定 10 个长对话真实验收待执行。

## v4.0.3 - 2026-09-20

- 减法式性能收口：BOOT 完成官方 Navigator 准备后进入 STEADY 休眠；提示词与额度详情改为第一次点击才创建。
- 删除永久 RAF URL 轮询，改用 MAIN-world `kind: "route"` 事件；Navigator terminal 后 park 重观察，MAIN fetch 进入 parked 直通。
- ConversationSync mutation 250ms debounce；Toolbar 只观察 Header 附近；删除 App hostGuard 整页重启。
- 额度：账号 30 分钟 / model limits 10 分钟内存缓存；Web Locks 保证 7 天历史同一时间最多一个标签校准；hidden 不再 abort 已开始的扫描。
- 三环详情健康状态只显示三组预计剩余和上次完整同步；异常状态仍保留说明。
- 测试包 `ChatGPT-Yada-v4.0.3-official-only-UNVERIFIED.zip`；旧 4.0.0 / 4.0.1 / 4.0.2 包保留。Mac mini 产品测试不运行，MacBook 15 标签验收待执行。

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
