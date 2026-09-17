# ChatGPT Yada v2.2.0 测试清单

## Mac mini 本地验证

以下本地验证已于 2026-09-17 在 Mac mini 执行通过；浏览器报告包含 13 组验收。不能当作真实 ChatGPT 页面验收。

- [x] `npm run verify:copy`：完整复制、附件占位、独立真实时间戳与缺失/无效时间回归。
- [x] `npm run verify:features`：Chrome 无头模式，官方骨架 DOM，本地 API/storage；无 React 私有对象 fixture。
- [x] `npm run build`：严格 TypeScript 和 Vite。
- [x] `git diff --check`。
- [x] package、lock、manifest、dist manifest、ZIP manifest 均为 2.2.0；ZIP/dist 文件名集合和文件内容逐一相同。
- [x] 所有修改限定 gpt/；claude/、gemini/ 与 a4bc0c56908df1e2643e1adb76c897f119891df2 一致。

## fixture 验收覆盖

- [x] 120 轮骨架/6 轮挂载；直接子节点、幻影排除、奇偶观测及首轮索引 0。
- [x] 精确 userMessageId/turnDomId 优先、API 顺序补充；无 API 只显示轮次，导航完整。
- [x] 前/中/后与相同正文的不同容器 ID 准确定位；长距离直接跳、短距离 rAF。
- [x] 官方按钮骨架索引、改为轮次索引以及只有 data-toc-active 时的顺序调用。
- [x] 200/600/1200/2000ms 替换容器后重新查询目标和校正。
- [x] wheel、touchstart、全部指定滚动键、SPA 路由切换取消后续校正。
- [x] 官方导航 body 插入后一个浏览器帧且 <100ms 隐藏；清预览和取消定位。
- [x] hidden、aria-hidden、visibility、视区外、移除后的恢复；同一 host/marks/marker。
- [x] API 等待/失败可导航；路由退出清空；API 返回不重建刻度。
- [x] 灰色 Harson、绿色 Harson+ChatGPT，绿色粗体，长正文各自 2/5 行不裁掉另一角色。
- [x] 同行左右对齐与本地 `09月17日 周四 08:31:42`，无时间不伪造。
- [x] 无搜索/页脚，顶部只有新增/关闭，每卡三个 30px SVG-only 按钮，正确 aria-label/title。
- [x] 卡片无操作；复制完整正文（含空白）保持打开、短暂对勾后还原，Clipboard 失败走 textarea 兜底。
- [x] 新增、编辑、删除，原 ID/createdAt 保留，updatedAt 更新；不影响其他条目或输入草稿。
- [x] 1–2 条自然高度；多条仅列表滚动，顶部与编辑区域固定，背景滚轮不穿透。
- [x] 明暗主题、Escape、遮罩关闭、宿主销毁；真实浏览器 reload 保留偏好和 v1 提示词。
- [x] 完整 API 参数、分页 before 游标、重叠合并、当前分支与不完整分页拒绝。

## MacBook 真实页面仍需复验

- [ ] 重载 2.2.0 扩展并刷新 ChatGPT；真实长对话骨架轮数、重复提问、前中后跳转、Header 避让与用户取消。
- [ ] 官方导航真实出现后 ≤100ms 让位；消失后恢复同一导航，右侧 Activity、缩放与会话/分支切换。
- [ ] 灰绿模式、Harson/ChatGPT 绿色标题、2/5 行展开、User 本地轮次时间与缺失时间。
- [ ] 提示词既有数据、三个纯图标、完整复制/对勾、编辑/删除、新增、自然高度与长列表滚动；确认不写入输入框。
- [ ] 真实账号复制全部、分页完整性、活动分支和逐消息时间戳。

HOSTED_CI = DISABLED_BY_OWNER_NO_QUOTA（NOT_USED_BY_POLICY）。未运行 CI、未创建 PR、未创建或调用 GitHub Actions。
