# ChatGPT Yada 4.1.5 验收

候选不是 `main`。本轮交付：

```text
BRANCH = work/gpt-yada-native-compat
BASELINE = work/gpt-yada-4.1.4 @ 083e8a5a444282b89ef47f3d8acda1c59fe75fca (4.1.4)
VERSION = 4.1.5
PACKAGE = gpt/ChatGPT-Yada-v4.1.5-official-only-UNVERIFIED.zip
PACKAGE_SHA256 = fdae05173e7a8bc1592cd0031731fbb61171374b86a61b27bfa5d0a03b18540d
LOAD_DIR = gpt/dist_chrome
REMOTE = https://github.com/lumeng-internal/yada
ZIP_IN_GIT = NO（与既有策略一致，zip 被 gpt/.gitignore 忽略；GitHub 可取 dist_chrome）
MACBOOK_LOAD_DIR_UPDATED = NO
OFFICIAL_NAV_AUTO_RESTORE = UNVERIFIED
```

远端 SHA 以推送后回读为准，见本轮交接报告。不要只写“更新到最新版”。

## 本轮工程门禁

```bash
cd gpt
npm test
npm run verify:copy
npm run build
npm run verify:gate
git diff --check
npm run package
```

检查 build metafile、旧符号、manifest 的 `document_start` MAIN hook、无额外权限，以及 `claude/` / `gemini/` 未改变。

本轮不运行 GitHub Actions、PR、Release，不创建测试对话，不消耗 Pro 次数。工程构建成功不等于真实 Edge 长对话体验通过。

```text
MAC_MINI_ENGINEERING = COMPLETE_AFTER_GATE
MAC_MINI_PRODUCT_BROWSER = NOT_USED
MACBOOK_CONNECTION = ICMP_OK_SSH_22_REFUSED
MACBOOK_REAL_EDGE = NOT_REACHED
MACBOOK_10_CHAT_NAV_ACCEPTANCE = PENDING
OFFICIAL_NAV_AUTO_RESTORE = UNVERIFIED
TOOLBAR_REAL_GEOMETRY = UNVERIFIED
```

## 本轮已用工程测试覆盖的行为

- 新版结构缺少旧 role 属性；Assistant 标题只作角色线索，身份来自消息容器。
- 反向滚动、负 `scrollTop`、`overflow-anchor: none` 仍能识别 scroller 并按屏幕位置计算漂移。
- 相同消息卸载后重新挂载不误报新回答；stop-button 从有到无才触发必要的 Recent。
- 切换会话后旧 generation 不发布。
- 旧版官方导航五类名结构仍识别。
- 无旧根节点时，带连续索引的右侧官方按钮仍识别；随机右侧按钮不算导航。
- 布局缺失 / `expectedPrompts=0` / 等待页面：时钟超过 61 秒仍 `waiting`，不 armed 重观察，不阻止额度维护；应用层到期 slice 可以发出历史请求。
- 真正 `launchAttempt` 期间才 `isMaintenanceBlocked()===true`，sentinel 无宿主请求后释放。
- API 89 / 官方 88 为 mismatch，不报 ready。
- 官方按钮存在而 expected=0（API 失败）时导航仍 `available`。
- 成功 ready、失败 sleep、取消、hidden、route reset、dispose 后无 heavy / heartbeat / timer 残留。
- 工具栏独立宿主；中文按钮、无文字图标、`span.contents`、Header 替换、连续 mount / recover / dispose 不产生第二个宿主；`right:88px` 已删除。
- 几何守卫拒绝与原生按钮相交的候选。jsdom 矩形不是真机遮挡证明。
- 复制活动分支、双方时间戳、提示词 SVG 操作、三环/轻刷新/last-good、普通新回答 Recent、无新增跨标签历史扫描：沿用现有测试。

## 真机仍未验证（需要已授权的 MacBook Edge）

本轮现场：主机 `MACMINI-NAS.local`。`192.168.31.82` ICMP 通，SSH 22 **Connection refused**。没有建立新的远程控制，没有复制 Cookie 或用户资料。因此没有读取真实 Edge DOM，也没有更新 `/Users/harsonru/Code/Codex/yada-official-only-test/gpt` 是否仍为当前加载目录。

待 Harson 在 **测试标签**（无未发送内容、未在生成）加载 4.1.5 后确认：

1. 短对话和 100～200 轮长对话正常打开后，不手动滚到顶部，官方导航是否自动出现；记录耗时和完整性依据（官方按钮索引 / 数量 / 是否与当前会话一致）。
2. 点最早、中间、最后位置的实际落点，不能只报按钮数量。
3. 现有多标签下额外请求和观察是否可接受。
4. 工具栏是否挡住分享/更多的可点击区域；宽窗、缩窄、缩放后是否仍在原生操作组左侧或下方靠右的已验证位置。
5. 弹窗是否仍完整显示，不被 Header 裁剪。
6. 无法在本轮观察到的真实回答完成，单独标记，不补造 PASS。

固定 10 个长对话与多标签性能（沿用，不在本轮执行）：

1. 安装 `ChatGPT-Yada-v4.1.5-official-only-UNVERIFIED.zip` 或该分支的 `gpt/dist_chrome`，不要安装 `main`。
2. 固定同一批 10 个真实长对话，每个只刷新一次；不要主动滚动。
3. 逐个记录第一次刷新是否出现 Navigator、是否需要第二次刷新、最终是否失败，以及大致出现时间。
4. 逐个记录是否出现由 Yada 引起的“页面没有响应”；目标为 0。
5. 同时保留 10～15 个 GPT 标签，确认没有明显额外卡顿；Navigator ready 后继续正常工作、滚动、输入。
6. 让 3 个标签同时生成回答，当前操作标签仍然顺畅；hidden streaming 完成后数据仍会同步。
7. 快速切换多个标签 3～5 分钟，之后确认「上次完整同步」最终可以回到最近时间。
8. 三环、提示词与复制全部回归。

记录表：

```text
第一次刷新成功：N/10
需要第二次刷新：N
最终失败：N
页面“无响应”：N
Navigator 平均出现时间：约 N 秒
```

导航：

1. 在 Edge 加载固定 `dist_chrome`，打开短对话：官方 Navigator 应正常出现。
2. 打开之前无 Navigator 的真实长对话。不滚动页面，保持 idle；预期 Yada 自动准备历史后官方 Navigator 出现，随后休眠。
3. 右侧只能有 ChatGPT 官方 Navigator；无 Yada Rail、绿色点或第二套刻度。
4. 自动准备期间正文不能自行明显上下跳。
5. 依次点第一轮、中间轮、最后一轮，以及最后 → 第一 → 中间 → 最后。
6. 准备期间滚轮/点击/按键：Yada 立即让权；停止操作、idle 后，在 recovery budget 内自动继续。

额度：

1. 顶栏显示 20px 三环；首次同步中明确显示“正在首次同步最近 7 天 ChatGPT 历史…”。
2. 同步完成后三组均显示“已用 X / 上限”，数字直接来自现有 `metric.used`；百分比仍显示剩余百分比。
3. 点击三环应出现约 312px 的精简详情卡，不得被 Header 裁成白条。
4. Escape、外部点击、route change 均可关闭详情。
5. 完整同步后立即 reload，不应再次进入“正在补齐”，数字继续显示。
6. 保持页面打开超过 10 分钟，不应再出现大约 10 分钟一次的规律卡顿；旧额度持续显示。hidden 不启动新的历史 slice。
7. 刷新失败不隐藏已用次数；显示上次完整同步时间与最近失败提示。手动刷新只表示完整修复已开始，不表示七天扫描已经结束。
8. 不点击三环时正常使用多个 GPT，确认没有热力图 SVG、Tooltip、小时 timer 或新增卡顿。
9. 点击三环，健康 Pro 状态应显示 168 + 24 + 24 个格子；当前时间若为 20:05，第一列小时应为 21。
10. 7×24 图左侧日期必须与各行 Tooltip 的历史使用日期一致；两张 24h 图保持原显示。Hover 任一格，Tooltip 必须只有一行：`9月18日 周五 20:00 使用12次`；不得显示模型、释放说明或第二行。
11. 确认没有 `0 / 1–2 / 3–5 / 6–10 / 11+`、少→多或其他图例。
12. 关闭详情后 SVG、共享 Tooltip、热力图 listener 与整点 timer 全部清理；重新打开读取最新 Ledger。
13. 详情保持打开跨过整点时只刷新一次；继续使用一次 Pro 后重新打开，格子数据应更新。
14. 标题右侧有刷新按钮，不在工具栏三环旁边。点一次应旋转且不可连点；结束后数字和热力图仍正常。连续快按不应产生多次刷新。
15. 历史仍失败时，「上次完整同步」不能被伪造成刚刚。关闭再打开，错误状态和动画不能残留。
16. 打开长对话后若官方导航迟迟不出现，额度到期维护仍应有机会执行；等待导航不得长期占用重任务。

提示词：

1. 未点击前不创建提示词面板。
2. 旧 v1 升级后首次视觉顺序保持；拖动 header 六点手柄排序，正文仍可选中。
3. 关闭/重新打开面板、刷新 ChatGPT、重开浏览器后顺序保持。
4. 编辑不改变排序；新增放顶部；删除保留其余顺序；复制不影响顺序。

复制全部：

1. 复制当前活动分支 Markdown 与真实时间戳仍正常。

本轮只使用 `ChatGPT-Yada-v4.1.5-official-only-UNVERIFIED.zip`，不要生成正式 Release 包，不要 merge main。

```text
MAC_MINI_ENGINEERING = COMPLETE_AFTER_GATE
MACBOOK_REAL_PERFORMANCE_ACCEPTANCE = PENDING
OFFICIAL_NAV_AUTO_RESTORE = UNVERIFIED
```
