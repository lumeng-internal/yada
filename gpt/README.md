# ChatGPT Yada

轻量 Chrome / Edge MV3 扩展，当前版本 v3.1.1。ChatGPT Yada 3.1.1 是单一扩展。安装一次即可获得：

- 自动让官方导航出现
- 官方导航悬停预览
- 复制全部和时间戳
- 提示词收藏

保留 Vite + TypeScript，无新增生产依赖。需要 Chrome / Edge 152 或更高。用户不再单独安装 GPT Navigator Helper。

## 使用

顶部工具条：`预览模式圆点 | 导航状态 | 复制全部 | 提示词`。优先放在 ChatGPT header actions；找不到时使用小型固定工具条。深浅色跟随页面。

- **复制全部**：保留完整会话、当前活动分支、Markdown 和各条消息的真实时间戳。先请求完整 API，局部响应按真实 before 游标分页合并；不完整数据明确报错，不复制 DOM 局部快照。
- **真实时间戳**：每条 User / ChatGPT 消息使用各自的 `create_time`。缺失时省略，不拿当前时间冒充。
- **自动准备官方导航**：在符合条件的桌面对话页上，扩大当前会话首次历史请求，并临时暴露 ChatGPT 自己的分页触发点，让官方导航完整出现。会等待延迟出现或被替换的 sentinel，以及历史完整后才生成的官方导航。不创建 Yada 导航条，不滚动页面，不点击官方按钮。准备中显示 `导航准备中 36/128`；就绪后约 1.5 秒隐藏；未完整时保留并在 title 中说明原因。持续滚动时不会恢复，只有最后一次操作后再安静约 2.5 秒才会有限恢复。
- **官方导航预览**：鼠标悬停或键盘聚焦 ChatGPT 官方导航按钮时，在按钮左侧显示对应轮次。灰色只显示 Harson；绿色显示 Harson + ChatGPT。角色标题为绿色粗体，各自默认两行，悬停约一秒后各自最多五行。时间使用该轮 User 的本地时间，格式 `09月17日 周四 08:31:42`。同一对话继续新增消息后，官方刻度增加时会合并刷新预览数据；已能映射的普通悬停不重复请求。官方按钮点击、页面滚动和最终定位仍由 ChatGPT 官方导航负责。
- **提示词**：独立 body-level Shadow DOM 弹窗。顶部只有新增和关闭；卡片右上角为纯 SVG 复制、编辑、删除按钮，卡片正文点击无操作。复制完整正文后保持打开，图标约 1.3 秒变对勾；不写入 ChatGPT 输入框。少量条目自然缩短，最多 `min(72vh, 680px)`，长列表仅列表滚动。背景或 Escape 关闭。

## 安装

需要 Chrome / Edge 152 或更高。只需安装 ChatGPT Yada 一次：

1. 下载 `ChatGPT-Yada-v3.1.1-dist_chrome.zip`，解压并在 Chrome / Edge 扩展管理页开启开发者模式，加载 `dist_chrome`。
2. 已安装时重新加载扩展，再刷新 ChatGPT 标签页。

本机目录：

```text
/Volumes/AutomationData/10_Workspace/Codex/yada-gpt-optimization-20260916/gpt/dist_chrome
```

完整步骤见 `docs/OFFICIAL_NAVIGATION_SETUP.md`。GPT Navigator Helper 只作为设计研究来源，不是依赖，也不再需要单独安装。

## 数据与边界

提示词仍使用 `chrome.storage.local` 的 `chatgpt-yada:prompt-library:v1`，结构 `{version:1,prompts:[{id,title,content,createdAt,updatedAt}]}`。编辑保留 id、createdAt；预览偏好键保持 `chatgpt-yada:preview-assistant:v1`。

附件只读取 API 元数据和占位，不下载附件正文。仅匹配 ChatGPT，仅请求 storage 权限。MAIN world 页面脚本只拦截当前会话的同源历史 GET，只读取 `response.clone()` 的轻量分页状态，不跨环境传输或持久化聊天正文，也不读取 Cookie、Token、Authorization。禁止再引入自定义导航条、刻度、点击跳转、滚动定位或位置校正。

## 本地验证与发布

```bash
npm run verify:copy
npm run verify:features
npm run build
git diff --check
```

`verify:features` 使用本机 Chrome 无头模式和 Node 内置 DevTools WebSocket，在临时隔离配置内运行本地 API/DOM/storage fixture，完成后清理。不安装 Playwright、不访问真实 ChatGPT。默认 Chrome 为 Mac 应用路径，可通过 `YADA_CHROME` 指定。

本轮按 PATCH 发布 3.1.1：收口 sentinel、官方导航、请求世代和用户恢复时序。只修改 gpt/，推送到测试分支 `codex/gpt-native-navigation-v3`，不 push main、不 force push、不建 PR、不运行 CI 或 GitHub Actions。`HOSTED_CI = DISABLED_BY_OWNER_NO_QUOTA`（`NOT_USED_BY_POLICY`）。

**MacBook 真实页面仍需复验**：本地 fixture 不代表真实登录页面验收。详见 `docs/TEST_CHECKLIST.md`。
