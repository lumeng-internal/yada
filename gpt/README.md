# ChatGPT Yada

轻量 Chrome / Edge MV3 扩展，当前版本 v2.1.0。只包含「复制全部 + 对话导航 + 提示词库」，保持 Vite + TypeScript，无新增生产依赖。

## 使用

顶部工具条：`预览模式圆点 | 复制全部 | 提示词`。优先放在 ChatGPT header actions；找不到时显示小型固定工具条。深浅色跟随页面。

- **复制全部**：每次从 `/backend-api/conversation/{id}` 获取完整活动分支，保留 User 与 final ChatGPT 消息、附件占位。各消息的真实 `create_time` 使用浏览器本地时区格式化，放在角色标题下；缺失或非法时间直接省略。API 失败时提示复制失败，不回退 DOM 局部内容。
- **右侧导航**：API 每轮一个灰色刻度，当前阅读轮高亮绿色。点击跳到 User；未挂载的消息通过比例定位、有限步进重扫和二次对齐定位。找不到时恢复原滚动位置；手动滚动或切换会话可取消跳转。Activity / 右侧面板改变内容区宽度时移动同一个 rail，不隐藏官方导航。
- **预览**：悬停默认显示 User 摘要，两行，约一秒后扩展到五行。圆点切换 User / User + ChatGPT，偏好本地保存。时间戳只写入复制 Markdown。
- **提示词**：手动新增、搜索标题/正文、编辑、删除。点击条目填入 ChatGPT 输入框，不发送。光标/选区在输入框内时插入该位置；否则保留草稿并用两个换行追加。点击外部或 Escape 关闭。新会话页面也可使用提示词。

```md
# User

2026-09-16 12:31:08

用户正文

# ChatGPT

2026-09-16 12:31:42

回复正文
```

附件只读取 API 元数据并保留 `[图片]`、`[PDF 文件] file.pdf`、`[粘贴内容]`、`[无文字消息]` 等占位，不下载附件正文。输入草稿、上传预览不进入导航。

## 数据与边界

完整轮数、内容、摘要、消息 ID 和时间来自 ChatGPT 会话 API；DOM 仅用于锚点绑定、滚动和输入框写入。不会把当前渲染子集当成完整对话。

提示词只存于 `chrome.storage.local`，键为 `chatgpt-yada:prompt-library:v1`，结构为 `{version:1,prompts:[{id,title,content,createdAt,updatedAt}]}`。预览偏好键为 `chatgpt-yada:preview-assistant:v1`。提示词不会由扩展发送到服务器；用户主动发送填入的草稿时才按 ChatGPT 的正常流程提交。

仅匹配 `https://chatgpt.com/*`，请求 `storage` 权限。无服务器、Token/额度、分类标签、导入导出、云同步、多平台、选择复制或复杂设置。

## 安装

在 Chrome / Edge 扩展管理页打开开发者模式，加载：

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
```

`verify:features` 使用本机 Chrome 无头模式和 Node 内置 DevTools WebSocket，在临时隔离浏览器配置中运行本地 DOM/API/storage fixture，结束后删除配置。不安装 Playwright，不访问真实 ChatGPT。默认 Chrome 为 Mac 应用路径；可通过 `YADA_CHROME` 指定可执行文件。

发布使用 `npm run release:minor -- --message "真实时间戳、对话导航与本地提示词库"`，由脚本统一更新版本并构建打包。此处新增完整功能模块，使用 MINOR，从 2.0.0 升级到 2.1.0。

产物：`dist_chrome/` 和 `ChatGPT-Yada-v2.1.0-dist_chrome.zip`。不运行 CI、不创建 GitHub Actions、不建 PR、不 push。`claude/`、`gemini/` 仅参考交互思路，导航实现为本地重写。

真实登录 ChatGPT 的 DOM、虚拟列表与编辑器可能变化，本地 fixture 验证不能替代真实账号页面验收。具体已验证项见 `docs/TEST_CHECKLIST.md`。
