# ChatGPT Yada 验收

正常情况下只跑：

```bash
cd gpt
npm run candidate
```

它会使用 Mac mini 已经登录 ChatGPT 的会议浏览器，自动加载当前 `dist_chrome`，自动寻找真实对话样本，并写出 `artifacts/candidate/<git-sha>.json`。

返回值：

- **PASS**：候选版通过。代码、fixture、真实会议浏览器、真实 ChatGPT、隐私和 ZIP 全部通过。
- **FAIL**：代码存在真实问题。
- **SETUP_REQUIRED**：按中文提示补一项条件，例如会议浏览器未运行、ChatGPT 未登录、或缺少 100+ 轮真实对话。
- **BUSY**：会议浏览器正在执行会议任务，晚点重跑。不要杀掉会议任务。

不要为了拿 PASS 自动制造 ChatGPT 对话或消耗 Pro 额度。
