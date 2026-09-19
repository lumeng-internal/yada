# ChatGPT Yada 验收

Mac mini 开发验证：

```bash
cd gpt
npm run check
npm run build
```

`npm run candidate` 仍可使用 Mac mini 已经登录 ChatGPT 的会议浏览器，自动加载当前 `dist_chrome`，写出 `artifacts/candidate/<git-sha>.json`。它只覆盖短对话 smoke、Popup 和回归。会议浏览器没有真实 100+ 对话，因此 **不能** 把 candidate 写成 `MACBOOK_NATIVE_ACCEPTANCE=PASS`。

返回值：

- **PASS**：代码、fixture、短对话会议浏览器 smoke、隐私和 ZIP 通过。仍不等于 MacBook 长对话原生导航验收。
- **FAIL**：代码存在真实问题。
- **SETUP_REQUIRED**：按中文提示补一项条件，例如会议浏览器未运行、ChatGPT 未登录、或缺少 100+ 轮真实对话。
- **BUSY**：会议浏览器正在执行会议任务，晚点重跑。不要杀掉会议任务。

不要为了拿 PASS 自动制造 ChatGPT 对话或消耗 Pro 额度。

原生导航的最终验收由 Harson 在 MacBook 使用日常 Microsoft Edge 和真实 100+ 对话完成。在那之前：

- `DEVELOPMENT_STATUS` 可以为 COMPLETE
- `MACBOOK_NATIVE_ACCEPTANCE` 必须为 PENDING
- 只提供 `ChatGPT-Yada-v4.0.0-native-nav-UNVERIFIED.zip`
- 不要生成或覆盖 `ChatGPT-Yada-v4.0.0-dist_chrome.zip`
