# V4 系统失败根因

记录系统问题，不再写成「问题 A 打补丁 A」。

基线 Commit：`bc7918175296536a5d67c663d190f4fa9100d27c`。

## 事实

1. `bc791817` 一次提交改变约 153 个文件，新增约 2.4 万行。
2. 导航、额度、后台、Popup、真实验收、发布门禁同时改动，变化单位过大。
3. `ConversationRepository` 同时负责缓存、请求共享、refresh、debounce、abort、publish，导致职责混合。
4. refresh 存在旧 Promise 悬挂和读取期间漏掉 trailing refresh 的风险。
5. `QuotaTracker` 把普通 DOM Mutation 当成业务事件，触发范围过宽。
6. Popup 手动刷新没有等待：对话读取 → 提取事件 → 账本写入整条链结束。
7. `HistoryBackfill` 存在失败后 offset 继续推进、静默漏历史的问题。
8. 导航还残留官方 TOC fast path 和 suppressor，继续依赖 ChatGPT 不稳定 DOM。
9. 每次导航点击重新构建指纹 / segment，存在重复计算。
10. Rail 旧任务可以覆盖新任务状态。
11. `vendor/luna-navigation` 带入远多于实际生产所需的源码和测试。
12. 默认测试包含大量上游测试，反而 Yada 自己的产品测试较少。
13. `fingerprintCollector` 测试依赖 20 / 40ms 真实时钟，属于随机测试。
14. `scripts/live-acceptance.mjs` 目前即使条件齐全也不会真正 PASS。
15. `release:official` 会把 4.0.0 major bump 成 5.0.0，发布合同错误。
16. artifacts 没有完整忽略，导致工作区污染。
17. 过去多个 postmortem 已经指出「构建通过 != 真实 ChatGPT 页面通过」，但这个经验没有变成自动门禁。

## 根因

产品方向基本正确。

失败主要来自：同步职责混杂 + 引入过多上游表面积 + 真实验收没有成为开发闭环。
