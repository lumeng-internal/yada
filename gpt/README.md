# ChatGPT Yada

轻量 Chrome / Edge MV3 扩展，当前版本 v2.2.0。只包含「复制全部 + 对话导航 + 提示词库」，保留 Vite + TypeScript，无新增依赖。

## 使用

顶部工具条：`预览模式圆点 | 复制全部 | 提示词`。优先放在 ChatGPT header actions；找不到时使用小型固定工具条。深浅色跟随页面。

- **复制全部**：保留完整会话、当前活动分支、Markdown 和各条消息的真实时间戳。先请求完整 API，局部响应按真实 before 游标分页合并；不完整数据明确报错，不复制 DOM 局部快照。
- **右侧导航**：以官方 `convSearchResultHighlightRoot` 的直接子节点 `data-turn-id-container` 为数量、顺序、当前轮和位置权威源。跳过 `client-created-*`，从挂载的 user section 识别奇偶序列。正文卸载不影响导航。API 仅按 ID 优先、轮次顺序兜底补充预览；无 API 时仍可点击刻度，预览只显示「第 N 轮」。
- **点击跳转**：可用的官方 TOC 按钮优先原生 click；否则按容器 ID 定位，扣除实际 Header 遮挡与 16px 留白。超过 600px 直接滚动，短距离约 280ms 缓动。200/600/1200/2000ms 重新查询同一 ID，偏差超过 40px 校正。滚轮、触摸、滚动键和会话切换取消后续校正。状态为「定位中 / 定位成功 / 该轮暂时无法定位」。
- **官方导航让位**：全页面检测 `button[data-toc-item-index]` 与 `button[data-toc-active]`，检查按钮及祖先可见性。专用 MutationObserver 立即隐藏 Yada、清空预览、取消定位，下一帧复核。官方导航消失后恢复同一 host 和 marks layer，不修改官方 UI。
- **预览**：灰色只显示 Harson；绿色显示 Harson + ChatGPT。角色标题为绿色粗体，各自默认两行，悬停约一秒后各自最多五行。轮次与该轮 User 的本地时间同一行左右对齐，格式 `09月17日 周四 08:31:42`；缺失时间不显示。
- **提示词**：独立 body-level Shadow DOM 弹窗。顶部只有新增和关闭；卡片右上角为纯 SVG 复制、编辑、删除按钮，卡片正文点击无操作。复制完整正文后保持打开，图标约 1.3 秒变对勾；不写入 ChatGPT 输入框。少量条目自然缩短，最多 `min(72vh, 680px)`，长列表仅列表滚动。背景或 Escape 关闭。

## 数据与边界

提示词仍使用 `chrome.storage.local` 的 `chatgpt-yada:prompt-library:v1`，结构 `{version:1,prompts:[{id,title,content,createdAt,updatedAt}]}`。编辑保留 id、createdAt；预览偏好键保持 `chatgpt-yada:preview-assistant:v1`。

附件只读取 API 元数据和占位，不下载附件正文。仅匹配 ChatGPT，仅请求 storage 权限。已移除 React 私有对象扫描、virtualizer bridge、其公开资源声明和提示词输入框插入模块。

## 安装

下载 `ChatGPT-Yada-v2.2.0-dist_chrome.zip`，解压并在 Chrome / Edge 扩展管理页开启开发者模式，加载 `dist_chrome`。本机目录：

```text
/Volumes/AutomationData/10_Workspace/Codex/yada-gpt-optimization-20260916/gpt/dist_chrome
```

已安装时重新加载扩展，再刷新 ChatGPT 标签页。

## 本地验证与发布

```bash
npm run verify:copy
npm run verify:features
npm run build
git diff --check
```

`verify:features` 使用本机 Chrome 无头模式和 Node 内置 DevTools WebSocket，在临时隔离配置内运行本地 API/DOM/storage fixture，完成后清理。不安装 Playwright、不访问真实 ChatGPT。默认 Chrome 为 Mac 应用路径，可通过 `YADA_CHROME` 指定。

本轮按 Owner 明确指定以 MINOR 发布 2.2.0：导航模块替换和提示词交互调整，执行 `npm run release:minor`。只修改 gpt/，普通 push main，不 force push、不建 PR、不运行 CI 或 GitHub Actions。`HOSTED_CI = DISABLED_BY_OWNER_NO_QUOTA`（`NOT_USED_BY_POLICY`）。

仅移植 Loongphy 固定提交中自行声明 MIT 的 `chatgpt-always-toc.user.js`，保留 Toolkit 完整会话读取和 modal 的实际来源。文件映射和许可见 `THIRD_PARTY_NOTICES.md`。

**MacBook 真实页面仍需复验**：本地 fixture 不代表真实登录页面验收。详见 `docs/TEST_CHECKLIST.md`。
