# Test Checklist: v2.1.0

## 本地自动验证

- [x] `npm run verify:copy`：活动分支、旧分支排除、图片占位、多段回复、Clipboard API 与结尾换行。
- [x] 独立 User / ChatGPT 时间；缺失、null、NaN、Infinity、超范围或非数字时间不伪造。
- [x] `npm run verify:features`：本机 Chrome 隔离配置，本地 API/DOM/storage fixture，10 组验证。
- [x] 120 个 API 轮次、仅 6 个挂载轮次；输入草稿和上传占位不进入锚点。
- [x] 内部滚动容器、40% 阅读线与全局轮次；重复文本和已回收节点不可信匹配。
- [x] 历史重复 rail 清理，单 host / 单 marks layer；内容区从 1000px 缩到 700px 再恢复时复用同一 host。
- [x] 虚拟长会话前、中、后渐进跳转及二次对齐；滚动不重建刻度；取消与失败恢复。
- [x] 悬停 User 预览、延时展开、User + ChatGPT、本地预览偏好、深色适配。
- [x] contenteditable / textarea：空输入、保留草稿追加、保存的光标、选区替换、原生 undo。
- [x] 提示词新增、正文搜索、编辑、删除、关闭后重新读取、纯文本渲染、Escape / 外部关闭；未自动发送。
- [x] 切换会话复用 host；dispose 移除 UI 和观察器后不继续请求。
- [x] `npm run build`：严格 TypeScript 检查与 Vite 生产构建。

## 发布检查

- [x] `npm run release:minor` 从 2.0.0 发布到 2.1.0。
- [x] package、package-lock、manifest、README、CHANGELOG、dist manifest 和 ZIP manifest 版本一致。
- [x] ZIP 完整性通过，manifest/content.js 与 dist 逐字节相同。
- [x] UTC 与 America/New_York 时区复验复制时间格式通过。
- [x] `git diff --check` 通过，仅 gpt/ 变化，生产/开发依赖集合未变。

生产依赖未增加。无 GitHub Actions、远程工作流、PR 或 push；claude/、gemini/ 保持只读。

## 尚未执行的真实环境验收

- [ ] 在已登录 ChatGPT 页面加载 2.1.0 扩展并检查真实长会话前、中、后定位。
- [ ] 真实官方 Activity / 导航开关的布局适配。
- [ ] 真实 ProseMirror 编辑器与 chrome.storage.local 在扩展刷新后的联动。

本地 fixture 使用存储 API 形状兼容的本地存储替身与模拟会话响应。它验证扩展交互逻辑，不能证明当前线上 ChatGPT DOM 或真实账号网络行为。此版本没有已复现而未修复的本地验证故障；线上验收保留为未验证。
