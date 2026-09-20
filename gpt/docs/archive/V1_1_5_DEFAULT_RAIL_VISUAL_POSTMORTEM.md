# v1.1.5 Default Rail Visual Postmortem

## 用户现象

Activity panel 没有打开时，ChatGPT 页面右侧仍然出现一整列密集灰色短横线。它们靠近页面最右侧原生滚动条 / 视觉边界，视觉上像两条导航条，或者像一条正常 GPT Yada rail 加一面灰色毛刺墙。

本轮只修默认右侧 rail 的视觉噪声和默认布局边距，不处理 Activity panel。

## 为什么 Activity 没打开也会像两个导航条

v1.1.4 已经修了 duplicate rail host / layer 的问题，但默认视觉策略仍然会把每一轮 `.mark-bar` 都显示出来。

长对话中如果有 80 到 100 多轮，右侧就会出现接近 80 到 100 条灰色短横线。它们不是第二个 host，也不是 Activity panel 残留，但视觉上会形成一面密集灰色短横线墙。

同时默认 rail right offset 可能只有个位数到二十几像素，离浏览器原生滚动条或页面最右侧边界太近，用户会把 GPT Yada rail 和页面滚动条看成两条并排导航。

## 根因

根因不是 Activity panel，而是两个默认状态问题叠加：

- 普通 marker 默认全量可见：`.mark-bar` 默认 `opacity: 1`，每个 turn 都有一条可见短横线。
- rail 默认位置过靠右：默认 right offset 太小，和页面原生滚动条 / 右边界缺少明显间隔。

v1.1.4 的 duplicate cleanup 只能保证 rail host / rail layer 唯一，不能解决“同一个 rail layer 内普通 marker 全量显影”的视觉噪声。

## 修复策略

v1.1.5 将 rail 默认视觉改成稀疏、单轴、低噪声：

- 保留所有 marker DOM，不删除节点，避免影响 hover、click、lasso 和 jump 的测量逻辑。
- 新增 `MarkerVisualRole`：`active`、`hovered`、`selected`、`nearby`、`sparseMajor`、`hidden`。
- 普通非 active / 非 selected / 非 sparseMajor marker 默认完全隐藏。
- 默认只显示 active 和少量 sparseMajor tick，长对话不再把所有 bar 都显示出来。
- hover 时只增强当前 marker 附近少量条目，不让整条 rail 全量显影。
- mark-index 默认隐藏；只在 hover、active、少量 selected 时显示，避免数字形成第二列。
- 默认 right offset 提高到更靠内容区内侧的位置，让 GPT Yada rail 和页面原生滚动条有明显区分。
- 保留 v1.1.4 的 duplicate rail host / layer cleanup。

## 新增诊断

新增 `window.auditRailVisualState()`，并在 debug snapshot 中输出 `rail.railVisualAudit`。

重点字段：

- `markCount`
- `visibleBarCount`
- `hiddenBarCount`
- `sparseMajorCount`
- `activeIndex`
- `hoverIndex`
- `selectedCount`
- `rightOffset`
- `railHostRect`
- `marksRect`
- `visibleIndexCount`
- `lassoTransparent`
- `warning`

当 `markCount > 30` 且 `visibleBarCount > markCount * 0.4` 时，诊断会提示：

`Too many rail markers visible; rail may look like a second scrollbar.`

## 明确未改

- 复制全部
- 选择复制
- hover preview 内容
- active 跳转
- 附件摘要
- Activity panel 检测
- manifest permissions
- `reference/`
