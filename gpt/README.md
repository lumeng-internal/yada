# ChatGPT Yada

轻量 Chrome / Edge MV3 扩展，当前版本 v2.1.1。只包含「复制全部 + 对话导航 + 提示词库」，保留 Vite + TypeScript，无新增生产依赖。

## 使用

顶部工具条：`预览模式圆点 | 复制全部 | 提示词`。优先放在 ChatGPT header actions；找不到时显示小型固定工具条。深浅色跟随页面。

- **复制全部**：保留 2.1.0 Markdown 和独立真实时间戳格式。完整会话先请求 `include_full_conversation=true`；局部响应按上游实际 `before` 游标、`include_has_versions=true`、`num_turns=100` 继续读取并合并，保留当前活动分支。缺失、停滞或不完整数据报错，不复制 DOM 局部内容。
- **右侧导航**：API 每轮一个刻度，当前阅读轮高亮绿色。点击定位 User；优先稳定消息 ID，再通过 GPT Conversation Toolkit 页面虚拟列表桥接挂载。桥接不可用时按当前挂载窗口向目标单向移动，带停滞检测、边界探测和轻微 nudge。只接受准确 ID；找不到明确提示，不上下反复试探或跳到附近轮次冒充成功。
- **稳定定位**：采用 AI-MarkDone 的短暂稳定测量、同 ID 节点重取和最多两次重新校准。实时测量页面 Header 遮挡；成功后短暂高亮。状态为「定位中 / 定位成功 / 该轮暂时无法定位」。滚轮、触摸、方向键、翻页键、点击或切换会话取消跳转。
- **官方导航**：官方导航存在且可见时，隐藏 Yada、清除预览、取消跳转。官方导航消失后恢复原来的同一个 Yada host 和 marks layer，不修改官方 UI。
- **预览**：灰色仅 User；绿色同时显示独立的 User 和 ChatGPT 标题、摘要。双方各两行，悬停约一秒各扩展至最多五行。无回复时显示「该轮暂无 ChatGPT 回复」。圆点按钮、灰绿状态和本地偏好键保持不变。
- **提示词**：采用 GPT Conversation Toolkit 的完整 modal 界面，独立宿主直接挂到 body，并以 Shadow DOM 隔离。只有搜索、列表、新增、编辑、删除、点击填入。普通对话和新对话均可打开，点击外部或 Escape 关闭。打开前有效光标/选区且草稿未变化时使用原位置；草稿变化或选区失效时保留草稿、两个换行后追加。不自动发送，使用浏览器原生输入以保留撤销能力。

附件只读取 API 元数据并保留 `[图片]`、`[PDF 文件] file.pdf`、`[粘贴内容]`、`[无文字消息]` 等占位，不下载附件正文。输入草稿、上传预览不进入导航。

## 数据与边界

完整轮数、内容、摘要、消息 ID 和时间来自 ChatGPT 会话 API；DOM 仅用于当前挂载窗口、最终滚动及输入框写入。

提示词只存于 `chrome.storage.local`：`chatgpt-yada:prompt-library:v1`，结构保持 `{version:1,prompts:[{id,title,content,createdAt,updatedAt}]}`，不丢失 2.1.0 数据。预览偏好键保持 `chatgpt-yada:preview-assistant:v1`。

仅匹配 `https://chatgpt.com/*`，请求 `storage` 权限。页面桥接是随扩展打包的本地脚本，仅暴露虚拟列表滚动协议；不下载远程脚本。无云同步、分类、标签、导入导出、设置中心或多平台支持。

## 安装

从 `ChatGPT-Yada-v2.1.1-dist_chrome.zip` 解压，在 Chrome / Edge 扩展管理页开启开发者模式，加载解压后的 `dist_chrome`。本机路径：

```text
/Volumes/AutomationData/10_Workspace/Codex/yada-gpt-optimization-20260916/gpt/dist_chrome
```

已安装时先重新加载扩展，再刷新 ChatGPT 标签页。

## 本地验证与发布

```bash
npm ci
npm run verify:copy
npm run verify:features
npm run build
git diff --check
```

`verify:features` 使用本机 Chrome 无头模式和 Node 内置 DevTools WebSocket，在临时隔离浏览器配置中运行本地 API/DOM/storage fixture。消息高度为 210–1620px，包含真实打包桥接脚本对模拟 React 虚拟器的调用、窗口重建、节点替换、用户取消及页面真实 reload。结束后删除临时配置。不安装 Playwright，不访问真实 ChatGPT。默认 Chrome 为 Mac 应用路径，可通过 `YADA_CHROME` 指定。

本轮是 2.1.0 四个实际使用缺陷的 PATCH 修复，通过 `npm run release:patch` 发布到 2.1.1。源码、manifest、构建和 ZIP 版本一致。仅修改 `gpt/`，未修改 Claude/Gemini。按用户本次授权直接提交并推送 main；不 force push、不建 PR、不运行 CI 或 GitHub Actions。

上游源码路径、固定 commit 和完整 MIT 许可证见 `THIRD_PARTY_NOTICES.md`。Open Prompt Manager 无明确复制许可，未复制其代码。

**MacBook 真实页面复验待执行**：本地 fixture 通过不代表真实登录 ChatGPT 验收。清单见 `docs/TEST_CHECKLIST.md`。
