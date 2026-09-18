# ChatGPT Yada

轻量 Chrome / Edge MV3 扩展，当前版本 **v4.0.0**。安装一次即可获得：

1. 完整长对话导航
2. 导航悬停预览
3. 复制全部
4. 每条 User / ChatGPT 消息真实时间戳
5. 本地提示词收藏库
6. GPT‑6 Pro / GPT‑5.6 Sol Pro 的本地额度账本
7. 浏览器工具栏动态三环额度图标
8. 点击插件图标查看紧凑额度详情

用户不再安装任何第二插件。页面上始终只显示一条 Yada 导航。

## 4.0.0 相对 3.1.1

3.1.1 把“ChatGPT 官方导航是否出现”当成产品成立前提，并自动唤出官方导航。该路线在真实 30+ 轮对话可用，但 **100+ 轮失败**。4.0.0 不再依赖官方导航：Yada 从完整对话 API 立即画出全部刻度。官方导航只在按钮数量与 `activeTurns` 完全一致时，作为 `navigateTo()` 内部快速路径。

## 使用

顶部工具条仍为：`预览模式圆点 | 复制全部 | 提示词`。额度不出现在 ChatGPT 顶栏，只出现在浏览器工具栏图标和 popup。

- **导航**：打开 N 轮对话立即生成 N 个刻度，不等待 DOM 或官方 TOC。
- **预览**：灰色只显示 Harson；绿色显示 Harson + ChatGPT。时间使用该轮 User 真实时间。
- **复制全部**：当前活动分支 Markdown，各自真实时间戳。
- **提示词**：本地 SVG 复制 / 编辑 / 删除。
- **额度**：本地预计剩余，不是官方余额。只统计个人 Chat，不统计 Work 和 Codex。

## 安装

需要 Chrome / Edge 152 或更高。

1. 下载 `ChatGPT-Yada-v4.0.0-dist_chrome.zip`，解压后在扩展管理页加载 `dist_chrome`。
2. 已安装时重新加载扩展，再刷新 ChatGPT 标签页。

本机目录：

```text
/Volumes/AutomationData/10_Workspace/Codex/yada-gpt-optimization-20260916/gpt/dist_chrome
```

## 数据与边界

`chrome.storage.local` 只保存提示词、预览偏好、额度事件元数据、backfill 进度、规则版本，以及导航核心需要的数字锚点。不保存提问/回复正文、附件、Token、Cookie、Authorization 或完整 API 原始响应。不接入 ECS / RDS / OSS / 外部统计。

## 本地验证

```bash
npm run verify
npm run acceptance:live
npm run build
git diff --check
```

不运行 GitHub CI。没有已登录的真实 ChatGPT 浏览器时，`LIVE_ACCEPTANCE_STATUS` 必须为 `PENDING`，不得写成 PASS。
