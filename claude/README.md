# Claude Yada

当前正式版本：Claude Yada v1.1.1

Claude Yada 是一个给 Claude.ai 使用的 Chrome 插件。

它的重点是把当前 Claude 对话更方便地复制成 Markdown，并在页面右侧提供一条细细的导航 rail，帮助你在长对话里快速跳转、预览和选择要复制的轮次。

这个 README 用中文写给不熟悉代码的使用者。照着步骤做即可。

## 当前功能清单

- 通过 Claude Conversation Tree 复制当前活动分支的完整 Markdown，不受页面滚动和懒加载影响。
- 选择部分对话轮次后复制为 Markdown。
- 右侧 rail 显示整段对话的轮次位置。
- 点击 rail 节点可以跳到对应的 User 轮次。
- 鼠标悬停 rail 节点可以预览该轮内容。
- rail 支持白色预览模式和橙色预览模式。
- 选择模式下，可以单点选择、框选、取消选择、反选。
- User 图片消息会显示为 `[图片]`。
- 多张图片会显示为 `[图片] [图片]`。
- PASTED 文本卡片会显示为 `[粘贴内容]`。
- Markdown、PDF、CSV、Word、Excel 等文件卡片会显示对应文件摘要。
- 保留导出功能。
- 显示当前活动对话 Token 估算，包括缓存计时、5 小时会话用量和 7 天周用量。
- 支持深色模式下使用。

## 如何构建插件

先进入项目目录：

```bash
cd "/Users/harsonru/Code/Codex/AI-Markdown/Claude Yada/claude-nexus-main"
```

然后执行构建：

```bash
corepack yarn@1.22.22 build:chrome
```

构建成功后，会生成或更新 `dist_chrome` 文件夹。

## 如何加载插件

1. 打开 Chrome。
2. 在地址栏输入：

   ```text
   chrome://extensions/
   ```

3. 打开右上角的“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择这个文件夹：

   ```text
   /Users/harsonru/Code/Codex/AI-Markdown/Claude Yada/claude-nexus-main/dist_chrome
   ```

6. 打开或刷新 `https://claude.ai/`。

## 如何使用复制全部

1. 打开 Claude.ai 的一段对话。
2. 找到 Claude Yada 的复制按钮。
3. 点击“复制全部”。
4. 插件会从 Claude Conversation Tree 校验当前活动父链，再复制为 Markdown。
5. 如果 API 未返回完整父链，插件会拒绝写入剪贴板并显示“未取得完整对话数据，本次未复制。”
6. 你可以粘贴到备忘录、Markdown 编辑器或其它文档里。

复制格式会尽量保持：

```markdown
# User

你的问题

# Claude

Claude 的回答
```

## 如何使用选择复制

1. 打开 Claude.ai 的一段对话。
2. 打开 Claude Yada 的选择复制模式。
3. 在右侧 rail 上选择你想复制的轮次。
4. 可以单点选择，也可以按住鼠标拖动框选多个轮次。
5. 如果选反了，可以使用“反选”。
6. 点击“复制选中”。
7. 插件只会复制你选中的那些轮次。

## 如何使用右侧 rail

右侧 rail 是页面右边的一条细导航条。

- 每个小节点代表一轮 User 对话。
- 普通模式下，点击节点会跳到对应位置。
- 选择模式下，点击节点会选中或取消选中该轮。
- 鼠标悬停节点，会显示内容预览。
- 鼠标停留约 1 秒，预览会展开显示更多内容。

## 白色 / 橙色预览模式说明

Claude Yada 有两种 rail 预览模式：

- 白色模式：主要预览 User 内容，适合快速找自己问过什么。
- 橙色模式：同时预览 User 和 Claude 内容，适合确认这一轮问答是否是你要复制的内容。

选中的 rail 节点会使用 Claude 风格的橙色高亮。

## Counter 显示说明

Counter 会在 Claude 页面上显示当前使用情况，主要包括：

- 当前活动分支的 `≈ Token` 估算。
- 缓存计时。
- 5 小时会话用量。
- 7 天周用量。
- 用量条展示。

Token 估算在本地浏览器中使用内置 `o200k_base` Tokenizer 计算，并按消息 UUID 与规范化内容 Hash 增量缓存。它不是 Claude 后台的精确 Context：系统提示、Project Knowledge、后台 Web Search／Research、图片视觉 Token 和 PDF 内部解析 Token 无法完整读取；检测到非文本、未知内容或 Claude Compaction 标记时，Tooltip 会明确提示估算不完整。

## 当前不包含的功能

Claude Yada 当前不包含这些能力：

- 不读取 Artifact 文件内部内容。
- 不做图片 OCR，也就是不会识别图片里的文字。
- 不下载并解析真实附件文件内容。
- 不自动打开或解析远程文件链接。

如果 User 消息里有图片、PASTED 卡片或文件卡片，插件会在 rail 和复制摘要里显示占位说明，例如 `[图片]`、`[粘贴内容]`、`[Markdown 文件] xxx.md`。

## 常见问题

### 看不到插件

1. 打开 `chrome://extensions/`。
2. 确认 Claude Yada 已经启用。
3. 确认加载的是 `dist_chrome` 文件夹。
4. 回到 Claude.ai 页面并刷新。

### 按钮不显示

1. 先刷新 Claude.ai 页面。
2. 如果仍然没有，回到 `chrome://extensions/`。
3. 点击 Claude Yada 卡片上的刷新按钮。
4. 再刷新 Claude.ai 页面。

### 修改后没有生效

1. 重新执行：

   ```bash
   corepack yarn@1.22.22 build:chrome
   ```

2. 打开 `chrome://extensions/`。
3. 点击 Claude Yada 的刷新按钮。
4. 刷新 Claude.ai 页面。

### 页面上出现异常

1. 先刷新 Claude.ai 页面。
2. 如果还是异常，重新加载扩展。
3. 再打开 Claude.ai。
4. 如果问题仍然存在，记录触发问题的对话类型，例如纯图片、PASTED、文件、长对话或深色模式。

## 发布前检查

发布前请按 [发布前人工测试清单](docs/release-checklist.md) 逐项检查。
