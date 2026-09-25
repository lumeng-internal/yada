# NOTICE

ChatGPT Yada GPT 扩展（`gpt/`）使用 GNU Affero General Public License v3.0-only 发布。完整许可证见 `LICENSE`。

## Vibe Bar

本目录包含从 [AstroQore/vibe-bar](https://github.com/AstroQore/vibe-bar) 移植并修改的 ChatGPT Chat quota 代码。

- 上游 Commit：`af26391c5bcc074108072af8f2807fc4c47edf21`
- 原许可证：AGPL-3.0
- 原版权：AstroQore / Vibe Bar contributors
- 移植范围：Swift → TypeScript 的 ChatGPT 个人 Chat Pro 额度估算

| 上游文件 | 本项目 TypeScript | 修改说明 |
| --- | --- | --- |
| `ChatGPTChatProModels.swift` | `src/quota/vibebar/allowances.ts`、`conversationParser.ts`、`modelLimits.ts`、`types.ts` | 保留 Pro / ProLite 桶、User turn 计费、Work 排除和 `model_limits` |
| `ChatGPTChatParser.swift` | `src/quota/vibebar/json.ts`、`conversationParser.ts` | JSON、日期、模型与活动分支解析 |
| `PrivacyPreservingHash.swift` | `conversationParser.ts` 的 `identity()` | Web Crypto SHA-256 哈希身份 |
| `ChatGPTChatClient.swift` | `src/quota/pageClient.ts` | 读取 plan 与 exhausted/reset metadata |
| `ChatGPTChatHistoryReader.swift` | `src/quota/vibebar/historyReader.ts` | 7 天、page size 50、4 pages、detail budget 24、25 秒、archived 双流 |

未复制 Vibe Bar 的 macOS 应用壳、菜单栏 UI、其他供应商适配器或密钥处理。浏览器侧 last-known-good / stale-only reconciliation 编排原有 reader 和 cache，不改变额度规则。

浏览器适配为 history list 单独使用 45 秒传输超时，保留 reader 的 25 秒默认调度预算和其他 API 的 15 秒默认超时。Reader 显式区分临时传输失败与永久失败，有真实数据进展时最多 20 数据 pass，临时传输失败另行最多 2 次重试（1.5 秒 / 5 秒）；完整成功才原子发布 cache、账本与历史未分类数。

## @uiw/react-heat-map

`src/ui/quotaHeatmap.ts` 直接移植并适配了 [uiwjs/react-heat-map](https://github.com/uiwjs/react-heat-map) 的 MIT SVG heatmap 源码。

- 固定 Tag：`v2.3.4`
- 固定 Commit：`8eb45dff2ec5ce0d317a9094e42afbdb44c10f92`
- 原许可证：MIT
- 原版权：Copyright (c) 2021 uiw

| 上游文件 | 本项目文件 | 复制或改编范围 |
| --- | --- | --- |
| `core/src/SVG.tsx` | `src/ui/quotaHeatmap.ts` | SVG 容器、cell/space 尺寸合同、panel colors 与 dynamic maximum 入口；11px cell 为适配 312px 浮层缩为 8px，保留 2px gap |
| `core/src/Day.tsx` | `src/ui/quotaHeatmap.ts` | `<g>` + `<rect>` grid、row/column/index 元数据和 `x/y = index × (cell + gap)` 结构 |
| `core/src/Rect.tsx` | `src/ui/quotaHeatmap.ts` | rect render/hover 交互合同；通过原 `rectProps`/`rx` 能力固定为 2px 圆角 |
| `core/src/utils.ts` | `src/ui/quotaHeatmap.ts` | `ceil(maxCount / (colors.length - 1))` 动态 panel threshold 与有序颜色选择；Yada 对 `count=0` 明确保留中性灰 |
| `core/src/style/index.less` | `src/ui/quotaHeatmap.ts` | hover 时 1px stroke；删除 active fill 与所有 transition |

React component、React DOM、Legend、month/week calendar navigation 与 `@uiw/react-tooltip` 没有复制或打包。Yada 使用原生 SVG DOM、稀疏滚动小时轴、CSS variables 和一个共享 Tooltip。

## Cal-Heatmap

`src/ui/quotaHeatmap.ts` 直接移植并适配了 [wa0x6e/cal-heatmap](https://github.com/wa0x6e/cal-heatmap) 的 MIT 时间 cell 与 Tooltip 源码。

- 固定稳定 Tag：`4.2.4`
- 固定 Commit：`815d7440acb40e91f0907f82267d5b8b4dd8ac76`
- 原许可证：MIT
- 原版权：Copyright (c) 2012 Tyler Kellen, contributors

| 上游文件 | 本项目文件 | 复制或改编范围 |
| --- | --- | --- |
| `src/templates/hour.ts` | `src/quota/heatmap.ts`、`src/ui/quotaHeatmap.ts` | 连续小时 cell、小时起点、row/column 时间语义；适配为从下一本地整点开始的固定 24/168 小时 row-major 布局 |
| `src/templates/day.ts` | `src/ui/quotaHeatmap.ts` | 连续日期 row label 语义；适配为每 24 小时一行的 `MM/DD` 标签，不使用自然周 |
| `src/subDomain/SubDomainPainter.ts` | `src/ui/quotaHeatmap.ts` | SVG group/rect、gutter、radius、mouseover/mouseout 交互；适配为原生 DOM 事件委托 |
| `src/plugins/Tooltip.ts` | `src/ui/quotaHeatmap.ts` | 单一 Tooltip root、mouseover 立即 show、mouseout 立即 hide、销毁时 remove；Popper 定位改为本地 viewport clamp |
| `src/cal-heatmap.scss` | `src/ui/quotaHeatmap.ts` | light/dark 中性 cell、hover stroke、Tooltip padding/background/radius/shadow；颜色通过 Yada CSS variables 适配 |

未引入 Cal-Heatmap npm runtime、D3、Popper、dayjs、动画、插件系统、导航、日期翻页、locale framework 或 legend。聚合算法只读取 Yada 现有 Ledger，未复制 Cal-Heatmap 的数据获取器。

## AI-MarkDone

本目录直接适配了 [zhaoliangbin42/AI-MarkDone](https://github.com/zhaoliangbin42/AI-MarkDone) 的极少量 MIT 结构。

- 上游 Commit：`d6cc562931607f378c48023420f814de1f7c9d60`
- 原许可证：MIT
- 原版权：zhaoliangbin42 / AI-MarkDone contributors
- 本项目文件：`src/nativeNavigator/dom.ts`
- 复用范围：ChatGPT 官方 Navigator root/fixed-child/button 识别结构，以及稳定 message identity 属性的选择顺序

未引入 Reader、书签、PDF/PNG、Drive、Annotation、其他平台、自绘 Directory Rail、React Fiber 或 private virtualizer。

## GPT Navigator Helper

[GPT Navigator Helper](https://github.com/sssstf0rest/GPT-Navigator-Helper) 0.6.4、Commit `2ac38de536dacb0ed1ad25c31396fd62a1c49022` 的仓库未声明项目许可证。

本项目只将其作为经过验证的行为和架构参考。4.0.3 的 PrepareSession / bounded lease / older-page boost 按 Yada 自己的模块独立实现；**behavioral reference only / no source copied**。未将该项目源码、分发物或许可证声明并入 Yada。

## GPT Conversation Toolkit

[GPT Conversation Toolkit](https://github.com/bujue3709/GPT-Conversation-Toolkit) Commit `ca628eeaed87323c195aa7b6d2750d2804e6ac77`，MIT。现有完整 Conversation API 与 Prompt Library 交互继续保留；未移植 React Fiber virtualizer bridge、private `scrollToIndex` 或自有 navigator。

## 仓库中的独立程序

`claude/` 与 `gemini/` 不与 `gpt/` 构建、链接或打包，保留各自许可证。

## Heroicons

`src/ui/quotaIndicator.ts` 直接内联移植了 [tailwindlabs/heroicons](https://github.com/tailwindlabs/heroicons) 的一个 MIT outline SVG path，用作额度详情标题右侧的刷新按钮。

- 固定 Tag：`v2.2.0`
- 固定 Commit：`0435d4ca364a608cc75e2f8683d374e55abbae26`
- 原许可证：MIT
- 原版权：Copyright (c) Tailwind Labs, Inc.
- 上游文件：`optimized/24/outline/arrow-path.svg`（仓库同时提供 `src/24/outline/arrow-path.svg`；当前 16px 视觉选用官方 24px outline path）
- 移植范围：仅一个 `<path d>`，通过 `currentColor` 内联进 Yada；不安装 heroicons npm、不引入 React/Vue 或图标运行时

未复制 Heroicons 其余图标、24/solid、20/solid、16/solid 或任何框架组件。

## SortableJS

[SortableJS/Sortable](https://github.com/SortableJS/Sortable)，固定 npm `sortablejs@1.15.6`，MIT，Copyright (c) 2019 All contributors to Sortable。用于现有提示词卡片拖拽和官方 AutoScroll；采用默认 ESM 入口，不引入框架 wrapper。完整 MIT 文本与版权见 `THIRD_PARTY_NOTICES.md`；package-lock.json 固定 tarball integrity。
