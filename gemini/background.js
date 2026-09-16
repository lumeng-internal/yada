// ============================================================================
// Gemini Yada — background.js
// 职责：用 declarativeNetRequest 摘除 gemini.google.com/usage 的防嵌入响应头
// （X-Frame-Options / Content-Security-Policy），使 content.js 能用隐藏 iframe
// 兜底读取官方额度页。方案参考开源项目 gemini-usage-bar (MIT)。
// ============================================================================

const RULE_ID = 1;

const rules = [
  {
    id: RULE_ID,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      responseHeaders: [
        { header: 'x-frame-options', operation: 'remove' },
        { header: 'content-security-policy', operation: 'remove' },
      ],
    },
    condition: {
      urlFilter: 'gemini.google.com/usage',
      resourceTypes: ['sub_frame'],
    },
  },
];

function registerRules() {
  chrome.declarativeNetRequest.updateDynamicRules(
    { removeRuleIds: [RULE_ID], addRules: rules },
    () => {
      if (chrome.runtime.lastError) {
        console.error('[Gemini Yada] DNR 规则注册失败:', chrome.runtime.lastError);
      }
    }
  );
}

chrome.runtime.onInstalled.addListener(registerRules);
chrome.runtime.onStartup.addListener(registerRules);
registerRules();
