# Claude 文件卡片 / Artifact 复制能力调研

日期：2026-05-18

本阶段只做调研，不做正式实现。没有修改复制逻辑、导出逻辑、`exportExtractors`、`exportFormatters`、`manifest`、Counter 或 Timeline。

## 当前代码现状

当前复制和导出共用 `src/pages/content/services/exportExtractors.ts`：

- 用户消息通过 `data-testid="user-message"` 提取纯文本。
- Claude 回复通过 `div.font-claude-response` 定位。
- 每条消息外层通过 `data-test-render-count` 之类的 wrapper 排序。
- Claude 回复优先点击原生复制按钮 `button[data-testid="action-bar-copy"]` 读剪贴板，失败才从 DOM 转 Markdown。
- 当前 `ExportMessage` 只有 `role` 和 `content` 两个字段，没有附件字段。
- 当前 `useExport.ts` 只下载单个 `.md` 或 `.json` 文本文件，没有 ZIP 能力。

结论：现在的复制 / 导出适合普通对话文本，但没有专门识别 Claude 文件卡片、Artifact、附件下载链接或附件内容。

## 逐项问题结论

1. Claude 文件卡片在 DOM 里可能长什么样？

   需要现场 DOM 确认。根据 Claude 常见 UI 推测，可能是一个按钮、链接或卡片区域，里面包含文件图标、文件名、类型标签、大小、下载按钮。可优先搜索这些线索：`a[download]`、`a[href]`、`button[aria-label*="Download"]`、`[data-testid*="file"]`、`[data-testid*="artifact"]`、文本里的 `.md` / `.csv` / `.txt` / `.json` 后缀。

2. 文件名在哪里？

   可能在卡片可见文本、`aria-label`、`title`、`download` 属性，或下载链接 URL 的路径 / 查询参数里。最稳的顺序应是：`download` 属性 > 可见文件名文本 > `aria-label/title` > URL 推断。

3. 文件类型在哪里？

   可能来自文件名后缀、卡片上的类型标签、下载响应的 `Content-Type`，或 Artifact 元数据。后续实现时不要只相信后缀，最好同时记录后缀和 MIME 类型。

4. Download 按钮有没有 href？

   不确定，需要现场确认。如果是 `<a href="...">`，content script 可以直接读到 `href`。如果是 `<button>`，可能只是触发 Claude 前端内部 fetch，此时 DOM 里未必有真实下载 URL。

5. Download 按钮点击后是否触发 fetch？

   很可能会触发 fetch 或打开已签名下载 URL。当前 Counter 已经有 injected bridge 思路，但本阶段不改。后续如果要捕获下载响应，可能需要页面环境注入脚本监听 fetch，或在用户点击导出时由 content script 主动 fetch 可见 URL。

6. 文件内容是否已经存在 DOM 里？

   分三种情况：

   - 普通代码块或已展开 Artifact 源码：内容可能已经在 DOM 里。
   - 文件卡片但未展开：DOM 里可能只有文件名和下载入口。
   - React 内部状态 / API 数据：内容可能在页面 JS 内存或网络响应里，但不直接出现在 DOM。

7. content script 能不能拿到文件名？

   大概率可以。只要文件名显示在卡片上、`aria-label`、`title`、`download` 或 URL 中，content script 都能读取。风险是 Claude 改版后选择器失效。

8. content script 能不能拿到文件内容？

   不一定。能拿到的前提是：

   - 内容已经在 DOM 中；或
   - 有可 fetch 的下载 URL；或
   - 可以通过页面环境 bridge 监听 / 调用同源 API。

   如果下载按钮只触发受保护内部流程，且响应不暴露给 content script，则不能稳定拿到内容。

9. md / txt / csv / json 文本文件是否可能内联到复制 Markdown？

   可以，但建议先限制条件：

   - 只处理 `.md`、`.txt`、`.csv`、`.json`。
   - 内容必须能安全读到。
   - 设置大小上限，比如单文件 200KB 或总附件 1MB，避免复制超大内容卡死。
   - Markdown 中用文件标题 + fenced code block 包起来。

   示例格式：

   ````md
   ## 附件：data.csv

   ```csv
   ...
   ```
   ````

10. 二进制文件如何处理？

   不适合内联到 Markdown。保底做法是在 Markdown 里写文件名、类型、大小、下载提示。导出 ZIP 时再把二进制文件放进 `attachments/`。

11. 导出时是否适合做 ZIP？

   适合，但应放在增强阶段。当前导出只下载单个文本文件；ZIP 路线需要新增 ZIP 生成能力。考虑项目规则“不新增生产依赖，除非绝对必要”，后续可优先评估浏览器原生能力和小型 ZIP 实现，再决定是否引入 JSZip 这类依赖。

12. 是否需要借鉴 GitHub 上已有 Claude artifact downloader / exporter 项目？

   建议借鉴，但只借鉴思路，不直接搬代码。原因是 Claude 页面 DOM 和导出格式都可能变，现成项目可以帮助判断常见数据来源、文件命名、ZIP 结构和异常处理。

13. 推荐后续参考的 GitHub 项目

   - [ashwanthkumar/claude-artifacts-downloader](https://github.com/ashwanthkumar/claude-artifacts-downloader)
     用途：Chrome 插件，把 Claude conversation artifacts 打包成 ZIP。
     值得参考：按钮注入、ZIP 打包、文件命名、重复文件处理。风险：仓库很小，README 说它从 Chrome local storage 取聊天数据并用正则提取 artifact，可能已经不适配新版 Claude。

   - [osteele/claude-chat-viewer](https://github.com/osteele/claude-chat-viewer)
     用途：读取 Claude 官方 JSON/ZIP 导出，在浏览器里查看会话，支持 artifacts 和下载 artifact ZIP。
     值得参考：Claude 官方导出格式、artifact 内容结构、文件扩展名 / MIME 类型处理、纯前端隐私模式。

   - [revivalstack/ai-chat-exporter](https://github.com/revivalstack/ai-chat-exporter)
     用途：Tampermonkey 脚本，支持 ChatGPT、Claude、Copilot、Gemini、Grok 导出 Markdown/JSON。
     值得参考：Claude DOM 选择器适配、Markdown 格式化、代码块处理。风险：重点是聊天导出，不一定覆盖文件下载内容。

   - [Superkikim/nexus-ai-chat-importer](https://github.com/Superkikim/nexus-ai-chat-importer)
     用途：导入 Claude 官方导出到 Obsidian，说明支持 attachments 和 artifacts with versioning。
     值得参考：Claude 官方导出 ZIP 中附件、artifact、版本信息的组织方式。风险：它处理的是官方导出文件，不是 claude.ai 当前页面 DOM。

## 后续实现路线

### 路线 A：保底版

目标：先把文件卡片作为“附件引用”复制出来，不读取文件内容。

输出内容：

- 文件名
- 文件类型
- 文件大小，如果 DOM 里能看到
- 下载提示
- 如果有 href，附下载链接

优点：风险最低，不需要 ZIP，不需要 fetch，不容易破坏现有复制/导出。

建议实现位置：

- 新增 `attachmentExtractors.ts` 或在 `exportExtractors.ts` 内增加小函数。
- `ExportMessage` 可临时在 Markdown 文本里拼接附件说明，不急着扩展复杂数据结构。

### 路线 B：增强版

目标：能读取 `.md` / `.txt` / `.csv` / `.json` 时，把内容内联到 Markdown。

策略：

- 先从 DOM 读已展开内容。
- 再尝试 fetch 明确可见的下载 URL。
- 只允许文本类型。
- 设置大小上限。
- 失败时回退到路线 A。

优点：复制出来的 Markdown 更完整。

风险：fetch 权限、登录态、CORS、Claude 内部下载机制都可能影响成功率。

### 路线 C：导出 ZIP

目标：导出 `conversation.md` + `attachments/` 文件夹。

ZIP 结构建议：

```text
conversation.md
attachments/
  turn-003-data.csv
  turn-005-report.md
  turn-006-image.png
manifest.json
```

`manifest.json` 可记录：

- 原始文件名
- 推断类型
- 所属第几轮对话
- 是否成功下载
- 失败原因

优点：最完整，适合二进制文件和多个附件。

风险：需要 ZIP 生成能力，可能增加依赖或实现成本；也需要更严格的失败处理，避免一个附件失败导致整个导出失败。

## 建议下一步

1. 在真实 Claude 页面打开包含文件卡片 / Artifact 的对话。
2. 用 Chrome DevTools 检查文件卡片 DOM，记录 2-3 个样本。
3. 确认下载按钮是 `<a href>` 还是 `<button>`。
4. 确认点击下载时 Network 里请求的 URL、响应类型和文件名来源。
5. 先做路线 A，因为它不需要读文件内容，最不容易破坏现在已经完成的复制体验。
