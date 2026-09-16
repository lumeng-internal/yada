# v1.1.6 Single Rail Hover Gradient Postmortem

## 用户真实需求

用户真正想要的不是 active-only rail，也不是默认只显示少量稀疏 marker。

目标是一条默认灰色 rail：所有轮次刻度可以存在并显示，但必须全部位于同一个 marks 容器、同一条视觉主轴上。鼠标靠近时，也只在这一条 rail 的同一套 `.mark-bar` 上做绿色递减高亮。

一句话：single rail, single marks layer, hover gradient on existing bars.

## v1.1.5 失败原因

v1.1.5 把默认视觉理解成“隐藏普通 marker，只显示 active / selected / sparseMajor”。这解决了全量灰色毛刺墙的一部分观感，但不符合用户最终确认的产品规则。

用户不想要 active-only，也不想默认大部分刻度消失。用户要的是：

- 默认所有轮次刻度在同一条 rail 上灰色、细、安静地显示。
- hover 时当前 marker 最绿、最亮、最长。
- 附近 marker 按距离递减。
- 更远 marker 保持默认灰色原样。
- 不出现第二条绿色 rail，不出现第二套 nearby marker，不出现第二列数字。

v1.1.5 还没有把 audit 按这套规则精确表达出来，尤其需要精确统计 `.mark-bar`，不能用 `includes("bar")` 之类的模糊判断。

## 本轮修复

v1.1.6 做了以下收敛：

- 保留 v1.1.4 / v1.1.5 的 rail host 和 layer cleanup。
- 保证 rail shadowRoot 中只有一个 `.zone` 和一个 `.marks` 是真正的 rail layer。
- 所有 `.mark` 都在同一个 `.marks` 容器内。
- 所有 `.mark-bar` 都在这些 `.mark` 内。
- 默认 `.mark-bar` 恢复为可见的灰色、短横线、低干扰状态。
- hover 不创建新 DOM、不创建第二 layer，只给同一套 `.mark` 写 `data-hover-distance="0" | "1" | "2" | "3"`。
- CSS 只基于同一套 `.mark-bar` 做绿色递减高亮。
- mark-index 默认隐藏，只允许 hover 当前项临时显示。
- rail 默认 right offset 提高到约 60px，让 GPT Yada rail 和原生滚动条明显分开。
- `railVisualAudit` 改成精确统计 `.mark-bar`，并输出单 rail / 单 marks layer / right distance 的警告。

## 新 audit 字段

`window.auditRailVisualState()` 和 debug snapshot 的 `rail.railVisualAudit` 现在包含：

- `yadaHostCount`
- `railHostCount`
- `toolbarHostCount`
- `previewHostCount`
- `menuHostCount`
- `zoneCount`
- `marksCount`
- `exactMarkBarCount`
- `visibleExactMarkBarCount`
- `markIndexVisibleCount`
- `hoverIndex`
- `activeIndex`
- `selectedCount`
- `maxHoverDistance`
- `railHostRect`
- `marksRect`
- `viewportWidth`
- `visibleRailRightDistance`
- `warning`

`exactMarkBarCount` 只统计 `classList.contains("mark-bar")` 的元素，不会把 toolbar / preview / menu 误判成 rail bar。

## 明确未改

- copy all
- selected copy
- active jump
- hover preview 内容
- attachment summary
- Activity panel 大逻辑
- manifest permissions
- `reference/`
