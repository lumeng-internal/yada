# ChatGPT Yada

轻量 Chrome MV3 扩展，当前版本 **v4.0.0**。安装一次即可获得：

1. 完整长对话导航
2. 导航悬停预览
3. 复制全部
4. 每条 User / ChatGPT 消息真实时间戳
5. 本地提示词收藏库
6. GPT‑6 Pro / GPT‑5.6 Sol Pro 的本地额度账本
7. ChatGPT 网页顶部工具栏中的 Pro 额度三环
8. 浏览器扩展 Action 动态三环与 popup 作为第二入口

用户不再安装任何第二插件。页面上始终只显示一条 Yada 导航。

`gpt/` 使用 **AGPL-3.0**，因为额度核心移植自 [Vibe Bar](https://github.com/AstroQore/vibe-bar)。详见 `LICENSE` 与 `NOTICE.md`。

## 4.0.0

4.0.0 由 ConversationSync 画出全部刻度。导航不再使用 Luna 虚拟搜索，改为 Direct、官方 Prompt 按钮和持久消息槽位。必要时每篇对话最多一次使用空 `?message=` 让 ChatGPT 自己生成官方导航骨架。额度按 User turn 统计，规则与 Vibe Bar Chat Pro 核心对齐。

## 使用

顶部工具条为：`预览模式圆点 | Pro 额度三环 | 复制全部 | 提示词`。网页内三环是日常主要入口；浏览器扩展 Action 三环和 popup 仍作为第二入口，共用同一份本地额度账本。

- **导航**：打开 N 轮对话立即生成 N 个刻度。点击时优先复用 ChatGPT 已挂载消息或官方按钮 / 持久槽位。
- **预览**：灰色只显示 Harson；绿色显示 Harson + ChatGPT。时间使用该轮 User 真实时间。
- **复制全部**：当前活动分支 Markdown，各自真实时间戳。
- **提示词**：本地 SVG 复制 / 编辑 / 删除。
- **额度**：本地预计剩余，不是官方余额。只统计个人 Chat，不统计 Work 和 Codex。根据保存的 Chat 历史和本地记录估算，特殊重试可能存在误差。

## 安装

需要已登录 ChatGPT 的 Chrome / Edge。

当前 native-navigation 测试包：

1. 加载 `gpt/dist_chrome`，或解压 `ChatGPT-Yada-v4.0.0-native-nav-UNVERIFIED.zip` 后加载其中的 `dist_chrome`。
2. 已安装时重新加载扩展，再刷新 ChatGPT 标签页。

本机目录：

```text
/Volumes/AutomationData/10_Workspace/Codex/yada-gpt-optimization-20260916/gpt/dist_chrome
```

`ChatGPT-Yada-v4.0.0-dist_chrome.zip` 仍未生成。MacBook 真实 100+ 对话验收通过前不要把它当作正式发布包。

## 数据与边界

`chrome.storage.local` 只保存提示词、预览偏好、额度事件元数据（哈希 ID / 时间 / 模型 / 分类）。不保存提问/回复正文、附件、Token、Cookie、Authorization 或完整 API 原始响应。不接入 ECS / RDS / OSS / 外部统计。

## 本地验证

```bash
npm run check
npm run build
```

Mac mini 会议浏览器只能做短对话 smoke。100+ 轮原生导航以 MacBook Edge 验收为准，见 `QA.md`。不运行 GitHub CI。不启动第二个浏览器。

## 许可证

- `gpt/`：AGPL-3.0
- `claude/`、`gemini/`：仓库中的独立程序，不与 `gpt/` 构建或链接，保留各自原有许可证
