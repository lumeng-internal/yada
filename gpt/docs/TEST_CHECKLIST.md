# ChatGPT Yada v2.2.2 测试清单

## Mac mini 本地验证

以下本地验证已于 2026-09-17 在 Mac mini 执行通过；浏览器报告包含 23 组验收，`verify:features` 连续三次通过。不能当作真实 ChatGPT 页面验收。

- [x] `npm run verify:copy`：完整复制、附件占位、独立真实时间戳与缺失/无效时间回归。
- [x] `npm run verify:features`：Chrome 无头模式，API 18 / 初始 DOM 5 / 分页 10 / 18 骨架 fixture，本地 API/storage；无 React 私有对象 fixture。
- [x] `npm run build`：严格 TypeScript 和 Vite。
- [x] `git diff --check`。
- [x] package、lock、manifest、dist manifest、ZIP manifest 均为 2.2.2；ZIP/dist 文件名集合和文件内容逐一相同。
- [x] 所有修改限定 gpt/；claude/、gemini/ 与 a4bc0c56908df1e2643e1adb76c897f119891df2 一致。

## fixture 验收覆盖

- [x] API 返回 18 轮后导航立即显示 18 个刻度；DOM 只有 5 个骨架时不得缩成 5 个。
- [x] 初始 5 个骨架精确绑定 API 最后 5 轮，不得绑定前 5 轮；当前轮使用全局编号。
- [x] 5→10→18 过程中 marker DOM 不重建。
- [x] 点击已加载第 16 轮直接跳转；点击未加载第 2 轮触发原生历史分页后按 message ID 跳转。
- [x] 两个 User 正文完全相同，仍按不同 message ID / 容器 ID 跳到正确位置。
- [x] 初始 ChatGPT 请求 `num_turns=5` 提升到 100；POST、SSE、发送接口和精确 message 深链不被改写。
- [x] 原生 IntersectionObserver 普通目标不受影响；哨兵替换后新 generation 可继续加载。
- [x] 游标重复、无增长、网络失败、429、页数上限和时间上限都能有限停止。
- [x] 加载历史前后阅读锚点基本保持；wheel/touch/pointer/键盘立即暂停；空闲后最多恢复 3 次。
- [x] 会话切换后旧加载不会污染新会话。
- [x] `?message=` 兜底只执行一次，pending target 能恢复，不能形成刷新循环。
- [x] 官方导航出现后 Yada 按 host 第一次 hidden 的真实时间让位，隐藏耗时 <100ms，不把后续 rAF 算进延迟。
- [x] 历史分页一请求一 nonce；后台 fetch-result、延迟响应和会话刷新不能串页。
- [x] Request+init 重写保留 signal/cache/credentials/自定义 header。
- [x] 会话级页数/时间上限跨 pause/resume 不重置；显式目标 AbortSignal 可取消。
- [x] 官方导航在显式目标补全中出现时接管目标，而不是 cancelJump。
- [x] `?message=` pending 恢复窗口超过 6 秒仍可恢复；API 失败但官方按钮完整时用保存的 index 恢复。
- [x] 复制全部、活动分支、逐消息时间戳回归通过。
- [x] Harson/ChatGPT 预览和时间回归通过。
- [x] 提示词三个纯 SVG icon、复制、编辑、删除回归通过。
- [x] 长距离直接跳、短距离 rAF、200/600/1200/2000ms 校正、用户取消。
- [x] claude/、gemini/ 没有修改。

## MacBook 真实页面仍需复验

- [ ] 重载 2.2.2 扩展并刷新一篇完整约 18 轮、初始只露出最近若干骨架的 ChatGPT 对话；确认导航立即显示完整轮数，而不是只有已加载骨架。
- [ ] 点击已加载轮次仍走 2.2.0 骨架跳转；点击尚未加载的更早轮次时，原生历史分页补齐目标骨架后再准确跳转。
- [ ] 点击尚未加载的更早轮次时，若补全过程中官方导航出现，应由官方按钮接管目标而不是取消跳转。
- [ ] 刷新恢复：API 较慢或失败时，pending 目标仍能按 message id / 保存的 index 恢复，且每个会话每个标签页只刷新一次。
- [ ] 后台补全时当前阅读位置不明显跳动；滚轮/触摸/键盘立即暂停，空闲后有限恢复。
- [ ] 官方导航真实出现后 ≤100ms 让位；消失后恢复同一导航。
- [ ] 灰绿模式、Harson/ChatGPT 绿色标题、2/5 行展开、User 本地轮次时间与缺失时间。
- [ ] 提示词既有数据、三个纯图标、完整复制/对勾、编辑/删除、新增；确认不写入输入框。
- [ ] 真实账号复制全部、分页完整性、活动分支和逐消息时间戳。
- [ ] 若原生补全失败，空 `?message=` 只刷新一次且能恢复目标跳转，不形成循环。

HOSTED_CI = DISABLED_BY_OWNER_NO_QUOTA（NOT_USED_BY_POLICY）。未运行 CI、未创建 PR、未创建或调用 GitHub Actions。
