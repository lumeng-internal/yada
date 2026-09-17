# ChatGPT Yada v2.1.1

本轮为 2.1.0 四个真实缺陷的 PATCH 修复：绿色预览缺 ChatGPT、提示词面板被 Header 裁剪、长对话跳转卡顿抖动与错位、Yada 与官方导航重复显示。保留复制 Markdown 与真实时间戳实现、灰绿圆点及存储键、每轮一个刻度和 2.1.0 提示词数据。

## 实现

- 预览拆为两个独立标题/摘要区块，各自 2 行，悬停约一秒各自最多 5 行；绿色始终包含 ChatGPT，未回复有明确文案。
- 移植 MIT GPT Conversation Toolkit 的 modal、卡片列表、搜索、新增编辑器、空状态、明暗样式及打开/关闭结构。面板为唯一 body-level Shadow DOM host，移除旧 Header 内 popover 和样式。Yada 本地适配编辑、删除、原生输入/撤销、有效选区、变更草稿追加、编辑器等待重取和点击去重。
- TypeScript 移植 Toolkit 的虚拟列表窗口、ID/角色读取、索引校准、桥接优先挂载、窗口变化等待、单向步进、停滞/边界/nudge。页面桥接保留上游协议和 React 对象发现，并随包分开构建。按明确产品约束移除上游比例猜测、反向探测与弱匹配成功分支。
- 完整 API 读取采用上游实际 full 参数和 before 游标分页；重叠页去重、缺页/游标停滞失败，保留当前分支。复制格式化和时间处理没有重写。
- AI-MarkDone 最终校准逻辑：scrollIntoView(auto/start)、短暂稳定等待、同 ID 节点重取、替换检测、两次重校准上限、位置容差、用户接管停止、准确目标高亮。Yada 适配真实 Header 测量。
- AI-MarkDone 官方导航结构和选择器，加可见性/几何兜底；只隐藏恢复同一 Yada host，不删除或修改官方导航。

## 验证与边界

`verify:copy`、`verify:features`、严格 TypeScript/生产构建、`git diff --check` 通过。浏览器 fixture 使用 120 轮、6 轮挂载窗口、210–1620px 可变高度；包含窗口异步重建、节点替换、冻结窗口失败、用户事件取消、实际页面 reload。

**MacBook 真实页面复验待执行**。本机未登录真实 ChatGPT，未把 fixture 写成真实验收；上游私有 React/API 接口在真实网页是否适配，需要按 TEST_CHECKLIST 复验。

仅修改 gpt/；claude/、gemini/ 与 415f22eef9da98d30088c3e01b6d79bae30c2374 基线一致。不新增依赖、不安装大型测试框架、不建 PR、不创建或运行 GitHub Actions。按本次授权提交 `fix(gpt): port stable navigation and prompt library` 并普通推送 GitHub main，无 force push。

产物：`dist_chrome/`、`ChatGPT-Yada-v2.1.1-dist_chrome.zip`。许可与上游固定 SHA 见 THIRD_PARTY_NOTICES。
