# ChatGPT Yada v2.1.1 测试清单

## 本地验证（Mac mini）

- [x] `npm run verify:copy`：复制内容、附件占位和独立真实时间戳原有回归。
- [x] `npm run verify:features`：Chrome 无头模式、本地 fixture，模拟 API/storage/React 虚拟器；非真实账号页面。
- [x] `npm run build`：严格 TypeScript、Vite content、单独 page bridge 构建。
- [x] `git diff --check`。
- [x] `claude/`、`gemini/` 对基线无变化，verify:features 自动检查。

## fixture 覆盖

- [x] 灰色只显示 User；750 字 User 摘要时绿色 ChatGPT 标题和 assistantPreview 仍可见。
- [x] 两个区块各 2 行，约一秒后各 5 行；未完成回复占位。
- [x] 两次真正 `location.reload()` 后分别恢复绿色、灰色偏好和提示词数据，保持 v1 存储键及既有 ID/时间戳。
- [x] Header 设置 transform/overflow 裁剪；独立 body-level modal 仍至少 500px 宽、300px 高，位于可视区，Shadow DOM 独立。
- [x] 提示词新增、正文搜索、编辑、删除、关闭重开、Escape、外部关闭、安全纯文本、明暗主题和新对话页。
- [x] 原生 contenteditable/textarea 输入，空框、选区替换、原生 undo、input 事件/模拟发送按钮更新。
- [x] 草稿变更和同文本节点重建导致选区失效时追加；编辑器暂时消失后等待并重新获取。
- [x] 连续两次点击只插入一次、不覆盖已有草稿、不自动发送。
- [x] 120 轮 API 与 6 轮 DOM 挂载窗口分离；输入附件不成为导航锚点。
- [x] 消息高度 210/970/345/1620/540/285px 交错，前/中/后准确目标跳转。
- [x] 执行真正移植的 page bridge 脚本；发现模拟 React ref、调用 scrollToIndex、触发异步窗口重建。
- [x] 已挂载目标直接定位；未挂载经桥接/窗口变化找到目标；桥接失败时单向窗口步进。
- [x] 同 ID 节点替换和 90px 位移后重取、有限校准及 Header 避让。
- [x] 冻结窗口触发停滞/边界探测后失败，记录 scrollTop 确认不反向抖动；相邻相似文本不冒充目标。
- [x] 滚轮、触摸、PageDown、Home、pointerdown、click 立即取消，取消后无继续校准；SPA pushState 下一帧取消。
- [x] 官方导航原选择器和几何兜底可隐藏 Yada、清除悬停和取消定位；display:none/移除后恢复同一 host/marks layer。
- [x] 历史重复 host 清理；活动中唯一 host/marks layer；销毁移除 prompt/rail/toolbar 宿主及监听。
- [x] full API 参数、分页真实 before 游标编码、重叠合并、活动分支和游标停滞拒绝。

## MacBook 真实页面复验待执行

- [ ] 重新加载 2.1.1 扩展并刷新 ChatGPT；长 User 的灰/绿悬停预览和各自展开。
- [ ] 普通/新对话页提示词弹窗完整可见；2.1.0 既有条目仍在；新增、搜索、编辑、删除及刷新持久化。
- [ ] ChatGPT 真实编辑器有效光标/选区、草稿变化、输入框重建、连续点击、发送按钮状态及 Cmd+Z 撤销；确认没有自动发送或引用卡片。
- [ ] 数百轮、消息高度差异大的真实对话：前/中/后点击、虚拟器桥接、Header 避让、目标短暂高亮；快速重复点击和用户滚动取消。
- [ ] 分支切换和分页完整轮数；复制全部与真实时间戳维持 2.1.0 行为。
- [ ] 官方导航出现/消失、右侧 Activity 开关、窗口缩放时只显示一条导航，恢复同一 Yada host。

GitHub Actions 未使用；本轮仅使用本地验证。真实页面复验是明确待办，未标为 PASS。
