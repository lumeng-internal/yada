# v1.1.4 Activity Panel Duplicate Rail Postmortem

## 用户现象

当 ChatGPT 右侧 Activity / 侧边栏关闭时，页面右侧只看到一条 GPT Yada rail。

当 Activity / 侧边栏打开时，页面右侧会出现两个类似 rail 的竖向短横线区域：一个在主对话内容区右边界附近，一个在 Activity 面板右侧附近。视觉上像两个导航条重叠、残留或同时存在。

本轮只修这个问题：Activity panel 打开 / 关闭导致 rail 出现两条、重叠或残留。

## 为什么不是简单的旧目录加载错

用户已确认当前加载路径来自稳定基线：

`/Users/harsonru/Code/Codex/AI-Markdown/GPTYADA/GPTyada-v1.1.3/dist_chrome`

因此本轮从 `GPTyada-v1.1.3` 复制出 `GPTyada-v1.1.4`，不基于其他历史目录继续改。旧目录加载错误仍然是人工验收时需要排除的风险，但不是本轮源码判断的唯一解释。

## 为什么 yadaHostCount=4 不等于 4 条 rail

GPT Yada 页面上允许同时存在多个 host：

- toolbar host
- preview host
- selection menu host
- rail host

所以诊断脚本返回 `yadaHostCount: 4` 本身不代表存在 4 条 rail。真正需要区分的是：这些 host 中哪一个是 rail，rail host 是否重复，以及 rail host 的 shadowRoot 内是否有多个可见 rail layer。

## 真正要区分的对象

本轮诊断和 cleanup 必须分开统计：

- rail host: 真实右侧导航条宿主，只允许一份
- toolbar host: 顶部复制 / 选择工具，不算重复 rail
- preview host: hover 预览，不算重复 rail
- menu host: 选择复制菜单，不算重复 rail
- unknown Yada host: 需要诊断输出，但不能直接当作重复 rail 删除

rail host 内部也要继续区分：

- `.zone` / `[data-rail-zone]`
- `.marks` / `[data-marks]`
- `.lasso-hit-zone` / `[data-lasso-hit-zone]`
- `.mark-bar`
- `.selection-box`

如果只有一个 host 但 shadowRoot 内有多个可见 marks / rail layer，用户仍然可能看到两条 rail。

## 根因判断

v1.1.3 的 rail mount 逻辑只通过 `document.getElementById(YADA_RAIL_HOST_ID)?.remove()` 清理一个 host，然后重新创建 rail host。

如果页面上已经存在多个相同 id 的历史 rail host，`getElementById()` 只能命中其中一个，剩余的旧 host 可能继续留在页面上。Activity panel 打开 / 关闭触发布局、路由或 mutation 刷新时，新的 rail 又会根据当前布局重新定位，于是旧位置和新位置可能同时出现。

同时，原有 debug snapshot 主要检查当前 `#chatgpt-yada-rail-host`，没有把 toolbar / preview / menu 与真正的 rail host 精确拆开，也没有在布局变化后主动清理历史 rail host 或重复 rail layer。

## v1.1.4 修复策略

本轮修复保持范围收敛：

- rail host 唯一：只允许一个真正的 rail host；清理历史的 `yada + rail` host，但不误删 toolbar / preview / menu。
- rail layer 唯一：同一个 rail host 的 shadowRoot 内只允许一组可见 `.zone` / `.marks` / `.lasso-hit-zone` layer；发现重复 layer 时重建 rail skeleton。
- Activity panel 只移动同一个 host：右侧面板打开 / 关闭时，只更新同一个 rail host 的 right offset 和 layout dataset，不创建第二个 rail host。
- 布局变化后 cleanup：初始化、render 前后、resize、route change、mutation layout 刷新后都执行节流后的 rail cleanup / audit。
- 新增轻量诊断：暴露 `window.auditRailHostsAndLayers()`，并在 debug snapshot 中输出 rail / toolbar / preview / menu 的分类统计。

本轮明确不修改复制、选择复制、hover preview 内容、active 跳转、附件摘要，也不重构 rail 视觉。
