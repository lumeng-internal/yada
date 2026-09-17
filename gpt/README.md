# ChatGPT Yada

轻量 Chrome / Edge MV3 扩展，当前版本 v3.0.1。只包含「复制全部 + 真实时间戳 + 提示词库 + ChatGPT 官方导航悬停预览」，保留 Vite + TypeScript，无新增依赖。需要 Chrome / Edge 152 或更高。

3.0.1 已补上同一对话继续新增消息后的预览刷新。正式进入 main 前，仍需 MacBook 使用 GPT Navigator Helper 原版完成真实长对话验收。

## 使用

顶部工具条：`预览模式圆点 | 复制全部 | 提示词`。优先放在 ChatGPT header actions；找不到时使用小型固定工具条。深浅色跟随页面。

- **复制全部**：保留完整会话、当前活动分支、Markdown 和各条消息的真实时间戳。先请求完整 API，局部响应按真实 before 游标分页合并；不完整数据明确报错，不复制 DOM 局部快照。
- **真实时间戳**：每条 User / ChatGPT 消息使用各自的 `create_time`。缺失时省略，不拿当前时间冒充。
- **官方导航预览**：鼠标悬停或键盘聚焦 ChatGPT 官方导航按钮时，在按钮左侧显示对应轮次。灰色只显示 Harson；绿色显示 Harson + ChatGPT。角色标题为绿色粗体，各自默认两行，悬停约一秒后各自最多五行。时间使用该轮 User 的本地时间，格式 `09月17日 周四 08:31:42`。同一对话继续新增消息后，官方刻度增加时会合并刷新预览数据；已能映射的普通悬停不重复请求。Yada 不创建自己的导航条，不滚动页面，不点击官方按钮，也不加载更早记录。
- **提示词**：独立 body-level Shadow DOM 弹窗。顶部只有新增和关闭；卡片右上角为纯 SVG 复制、编辑、删除按钮，卡片正文点击无操作。复制完整正文后保持打开，图标约 1.3 秒变对勾；不写入 ChatGPT 输入框。少量条目自然缩短，最多 `min(72vh, 680px)`，长列表仅列表滚动。背景或 Escape 关闭。

复制、时间戳和提示词不依赖官方导航，也不依赖 GPT Navigator Helper。没有官方导航时，只是没有悬停预览。

## 安装

需要 Chrome / Edge 152 或更高，并且必须分开安装两步：

1. 下载 `ChatGPT-Yada-v3.0.1-dist_chrome.zip`，解压并在 Chrome / Edge 扩展管理页开启开发者模式，加载 `dist_chrome`。
2. 从 Chrome 应用商店单独安装 [GPT Navigator Helper](https://chromewebstore.google.com/detail/gpt-navigator-helper/bpbajpcoifjncefjgbnnafkcgmjdcdli)。源码和问题反馈见 [GitHub](https://github.com/sssstf0rest/GPT-Navigator-Helper)。它独立安装，没有被打包进 Yada，Yada 也没有复制它的源码。

本机目录：

```text
/Volumes/AutomationData/10_Workspace/Codex/yada-gpt-optimization-20260916/gpt/dist_chrome
```

已安装时重新加载扩展，再刷新 ChatGPT 标签页。完整步骤见 `docs/OFFICIAL_NAVIGATION_SETUP.md`。

## 数据与边界

提示词仍使用 `chrome.storage.local` 的 `chatgpt-yada:prompt-library:v1`，结构 `{version:1,prompts:[{id,title,content,createdAt,updatedAt}]}`。编辑保留 id、createdAt；预览偏好键保持 `chatgpt-yada:preview-assistant:v1`。

附件只读取 API 元数据和占位，不下载附件正文。仅匹配 ChatGPT，仅请求 storage 权限。官方导航能否出现，仍由 ChatGPT 页面和 GPT Navigator Helper 决定。禁止再引入自定义分页、导航条、跳转、`window.fetch` 劫持或 `IntersectionObserver` 包装。

## 本地验证与发布

```bash
npm run verify:copy
npm run verify:features
npm run build
git diff --check
```

`verify:features` 使用本机 Chrome 无头模式和 Node 内置 DevTools WebSocket，在临时隔离配置内运行本地 API/DOM/storage fixture，完成后清理。不安装 Playwright、不访问真实 ChatGPT。默认 Chrome 为 Mac 应用路径，可通过 `YADA_CHROME` 指定。

本轮按 PATCH 发布 3.0.1：同一对话新增消息后刷新官方导航悬停预览，并限制请求合并。只修改 gpt/，推送到测试分支 `codex/gpt-native-navigation-v3`，不 push main、不 force push、不建 PR、不运行 CI 或 GitHub Actions。`HOSTED_CI = DISABLED_BY_OWNER_NO_QUOTA`（`NOT_USED_BY_POLICY`）。

**MacBook 真实页面仍需复验**：本地 fixture 不代表真实登录页面验收。详见 `docs/TEST_CHECKLIST.md`。
