// ============================================================================
// Gemini Yada v1.6.0 — content.js
// 功能一：右侧轮次导航条（高亮当前位置 / 邻近缩放 / 点击跳转 / 轮次计数 /
//         白橙双模式 / 悬停预览(2行→驻留5行) / 复制全部）
// 功能二：选择复制（框选或点选轮次 → 高亮 → 全选/反选/复制选中）
//
// DOM 选择器参考自开源项目 gemini-voyager (MIT, Nagi-ovo/gemini-voyager)，
// 采用多重兜底策略以抵抗 Gemini 改版。
// ============================================================================

(function () {
  'use strict';
  if (window.self !== window.top) return;
  if (window.__GEMINI_YADA__) return;
  window.__GEMINI_YADA__ = true;

  // ==========================================================================
  // 0. 配置与文案（集中管理，方便后续交给 Codex 改）
  // ==========================================================================
  const CONFIG = {
    previewLinesCollapsed: 2,    // 预览默认行数
    previewLinesExpanded: 5,     // 驻留后展开行数
    previewDwellMs: 1200,        // 驻留多久展开（毫秒）
    rebuildDebounceMs: 400,      // DOM 变化后重建导航条的去抖时间
    scrollSpyAnchor: 0.45,       // 以视口 45% 高度处作为"当前位置"参考线
    markerMaxHeight: 460,        // 导航条最大高度（超出则压缩间距）
    usagebarMargin: 0,           // 额度条优先注入输入框内部，失败时才用固定兜底
  };

  const T = {
    copyAll: '复制全部',
    copyAllTip: '复制全部当前对话消息',
    copied: (n) => `已复制 ${n} 轮`,
    nothingToCopy: '没有可复制的消息',
    copyFailed: '复制失败',
    modeWhiteTip: '预览模式：只展示 User（点击切换为 User + Gemini）',
    modeOrangeTip: '预览模式：展示 User + Gemini（点击切换为只展示 User）',
    modeWhiteToast: '预览已切换为只展示 User',
    modeOrangeToast: '预览已切换为 User + Gemini',
    selectMode: '选择复制',
    selectModeTip: '进入选择复制模式（点选或框选轮次）',
    selecting: (n) => `选择中 · 已选 ${n} 轮`,
    selectAll: '全选',
    deselectAll: '取消全选',
    invertSel: '反选',
    copySelected: '复制选中',
    exitSelect: '退出选择',
    selectFirst: '请先选择轮次',
    userLabel: 'User',
    modelLabel: 'Gemini',
    turn: (i, total) => `${i} / ${total}`,
  };

  // ==========================================================================
  // 1. Gemini DOM 选择器（多重兜底，来自 gemini-voyager 实战验证）
  // ==========================================================================
  const USER_TURN_SELECTORS = [
    '.user-query-bubble-with-background',
    '.user-query-bubble-container',
    '.user-query-container',
    'user-query-content .user-query-bubble-with-background',
    'user-query-content',
    'user-query',
    'div[aria-label="User message"]',
    'article[data-author="user"]',
    'article[data-turn="user"]',
    '[data-message-author-role="user"]',
  ];

  const MODEL_TURN_SELECTORS = [
    '[aria-label="Gemini response"]',
    '[data-message-author-role="assistant"]',
    '[data-message-author-role="model"]',
    'article[data-author="assistant"]',
    'model-response',
    '.model-response',
    'response-container',
    '.presented-response-container',
  ];

  // 模型"思考过程"容器——提取正文时必须排除
  const THOUGHTS_SELECTOR = 'model-thoughts, .thoughts-container, .thoughts-content';

  // ==========================================================================
  // 2. 工具函数
  // ==========================================================================
  function debounce(fn, ms) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function normText(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
  }

  // 按选择器列表逐个尝试，返回第一个有结果的（去除互为子孙的重复元素）
  function queryTurns(selectors) {
    for (const sel of selectors) {
      let els;
      try { els = Array.from(document.querySelectorAll(sel)); } catch { continue; }
      els = els.filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
      if (els.length === 0) continue;
      // 过滤掉是其他命中元素后代的元素（只留顶层）
      const top = els.filter((el) => !els.some((o) => o !== el && o.contains(el)));
      if (top.length > 0) return top;
    }
    return [];
  }

  // 沿父链向上找真正的滚动容器（参考 voyager 的实现）
  function findScrollContainer(el) {
    let p = el;
    while (p && p !== document.body) {
      const st = getComputedStyle(p);
      if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && p.scrollHeight > p.clientHeight) {
        return p;
      }
      p = p.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  // 提取某元素的"正文文本"，排除思考过程区块
  function extractText(rootEl) {
    if (!rootEl) return '';
    const clone = rootEl.cloneNode(true);
    clone.querySelectorAll(THOUGHTS_SELECTOR).forEach((n) => n.remove());
    // 排除我们自己注入的任何 UI
    clone.querySelectorAll('[class^="gy-"], [id^="gy-"]').forEach((n) => n.remove());
    return (clone.innerText || clone.textContent || '').trim();
  }

  // ==========================================================================
  // 3. 轮次模型：把页面解析成 [{user, model, userEl, modelEl}, ...]
  // ==========================================================================
  let turns = []; // { index, userEl, modelEl, userText, modelText }

  function buildTurns() {
    const userEls = queryTurns(USER_TURN_SELECTORS);
    const modelEls = queryTurns(MODEL_TURN_SELECTORS);

    // 按文档顺序合并，再把每个 user 与其后第一个 model 配对
    const all = [...userEls.map((el) => ({ el, role: 'user' })),
                 ...modelEls.map((el) => ({ el, role: 'model' }))]
      .sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);

    const result = [];
    let current = null;
    for (const item of all) {
      if (item.role === 'user') {
        if (current) result.push(current);
        current = { userEl: item.el, modelEl: null };
      } else if (current && !current.modelEl) {
        current.modelEl = item.el;
      } else if (!current) {
        // 对话以模型消息开头（少见），单独成轮
        result.push({ userEl: null, modelEl: item.el });
      }
    }
    if (current) result.push(current);

    turns = result.map((t, i) => ({
      index: i + 1,
      userEl: t.userEl,
      modelEl: t.modelEl,
      get userText() { return extractText(t.userEl); },
      get modelText() { return extractText(t.modelEl); },
    }));
    return turns;
  }

  function turnToMarkdown(t) {
    const parts = [`## 第 ${t.index} 轮`];
    const u = t.userText, m = t.modelText;
    if (u) parts.push(`**${T.userLabel}:**\n\n${u}`);
    if (m) parts.push(`**${T.modelLabel}:**\n\n${m}`);
    return parts.join('\n\n');
  }

  // ==========================================================================
  // 4. 状态
  // ==========================================================================
  let showModel = false;        // false=预览只显示 User；true=预览显示 User + Gemini（导航数量不变）
  let activeIndex = 1;          // 滚动监听得出的"当前所在轮次"
  let selectMode = false;
  let selected = new Set();     // 已选轮次 index 集合
  let scrollContainer = null;
  let scrollEventTarget = null;
  let scrollSpyFrame = 0;
  let resizeBound = false;

  chrome.storage?.local.get({ gyShowModel: false }, (r) => {
    showModel = !!r.gyShowModel;
    rebuild();
  });

  // ==========================================================================
  // 5. Toast 提示
  // ==========================================================================
  let toastTimer = null;
  let tooltipEl = null;

  function showTooltip(anchor, text) {
    if (!anchor || !text) return;
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.id = 'gy-tooltip';
      document.body.appendChild(tooltipEl);
    }
    tooltipEl.textContent = text;
    tooltipEl.classList.add('gy-show');
    const r = anchor.getBoundingClientRect();
    const tip = tooltipEl.getBoundingClientRect();
    let left = r.left + r.width / 2;
    left = Math.max(tip.width / 2 + 10, Math.min(window.innerWidth - tip.width / 2 - 10, left));
    let top = r.bottom + 8;
    if (top + tip.height > window.innerHeight - 10) top = r.top - tip.height - 8;
    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${Math.max(10, top)}px`;
  }

  function hideTooltip() {
    tooltipEl?.classList.remove('gy-show');
  }

  function bindTooltip(el, getText) {
    if (!el) return;
    el.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') showTooltip(el, typeof getText === 'function' ? getText() : getText);
    });
    el.addEventListener('pointerleave', hideTooltip);
    el.addEventListener('focus', () => showTooltip(el, typeof getText === 'function' ? getText() : getText));
    el.addEventListener('blur', hideTooltip);
  }

  function toast(msg) {
    let el = document.getElementById('gy-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'gy-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('gy-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('gy-show'), 1800);
  }

  async function copyText(text, okMsg) {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMsg);
    } catch {
      // 兜底：execCommand
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        toast(okMsg);
      } catch {
        toast(T.copyFailed);
      }
    }
  }

  // ==========================================================================
  // 6. 右侧导航条
  // ==========================================================================
  let rail = null;

  function getOrCreateRail() {
    if (rail && rail.isConnected) return rail;
    rail = document.getElementById('gy-rail');
    if (!rail) {
      rail = document.createElement('div');
      rail.id = 'gy-rail';
      document.body.appendChild(rail);
    }
    rail.querySelector('#gy-preview')?.remove();
    if (!rail.querySelector('#gy-counter') || !rail.querySelector('#gy-markers')) {
      rail.innerHTML = `
        <div class="gy-counter" id="gy-counter" title="当前轮 / 总轮数（双击生成诊断报告）">- / -</div>
        <div class="gy-markers" id="gy-markers"></div>
      `;
    }
    // —— 双击轮次计数：生成诊断报告并复制到剪贴板（给小白用户的零门槛排障）——
    rail.querySelector('#gy-counter')?.addEventListener('dblclick', runDiagnostics);
    return rail;
  }

  let previewEl = null;
  function getOrCreatePreview() {
    if (previewEl && previewEl.isConnected) return previewEl;
    previewEl = document.getElementById('gy-preview');
    if (!previewEl || previewEl.parentElement !== document.body) {
      previewEl?.remove();
      previewEl = document.createElement('div');
      previewEl.id = 'gy-preview';
      previewEl.className = 'gy-preview';
      document.body.appendChild(previewEl);
    }
    return previewEl;
  }

  // —— 右上方工具条：复制全部 / 选择复制（对齐 Claude-Yada 的顶部布局）——
  let topbar = null;
  function getOrCreateTopbar() {
    if (topbar && topbar.isConnected) return topbar;
    topbar = document.createElement('div');
    topbar.id = 'gy-topbar';
    topbar.innerHTML = `
      <button class="gy-tb-btn gy-mode-toggle" id="gy-mode-btn" aria-label="切换预览模式"><span class="gy-mode-dot"></span></button>
      <button class="gy-tb-btn" id="gy-copyall-btn">⧉ ${T.copyAll}</button>
      <button class="gy-tb-btn" id="gy-select-btn">▣ ${T.selectMode}</button>
    `;
    document.body.appendChild(topbar);
    const modeBtn = topbar.querySelector('#gy-mode-btn');
    const copyBtn = topbar.querySelector('#gy-copyall-btn');
    const selectBtn = topbar.querySelector('#gy-select-btn');
    bindTooltip(modeBtn, () => showModel ? T.modeOrangeTip : T.modeWhiteTip);
    bindTooltip(copyBtn, T.copyAllTip);
    bindTooltip(selectBtn, T.selectModeTip);
    modeBtn.addEventListener('click', () => {
      showModel = !showModel;
      chrome.storage?.local.set({ gyShowModel: showModel });
      toast(showModel ? T.modeOrangeToast : T.modeWhiteToast);
      renderMarkers();
    });
    copyBtn.addEventListener('click', () => {
      buildTurns();
      if (!turns.length) return toast(T.nothingToCopy);
      const md = turns.map(turnToMarkdown).join('\n\n---\n\n');
      copyText(md, T.copied(turns.length));
    });
    selectBtn.addEventListener('click', () => {
      selectMode ? exitSelectMode() : enterSelectMode();
    });
    return topbar;
  }

  // —— 对话框下方的额度条：5小时 + 周额度，自定义恢复时间格式（对齐 Claude-Yada）——
  let usagebar = null;
  function getOrCreateUsagebar() {
    if (usagebar && usagebar.isConnected) return usagebar;
    usagebar = document.createElement('div');
    usagebar.id = 'gy-usagebar';
    usagebar.title = '点击手动刷新额度';
    usagebar.innerHTML = `
      <span class="gy-ub-text" id="gy-ub-cur-text">5小时：--%</span>
      <div class="gy-ub-track"><div class="gy-ub-bar" id="gy-ub-cur-bar"></div></div>
      <div class="gy-ub-track"><div class="gy-ub-bar gy-ub-bar-wk" id="gy-ub-wk-bar"></div></div>
      <span class="gy-ub-text" id="gy-ub-wk-text">周额度：--%</span>
    `;
    document.body.appendChild(usagebar);
    usagebar.addEventListener('click', refreshUsage);
    placeUsagebar();
    return usagebar;
  }

  function visibleRect(el) {
    if (!el || !(el instanceof Element)) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 120 || r.height < 20) return null;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) return null;
    return r;
  }

  function findComposerHost() {
    const selectors = [
      'rich-textarea',
      '.ql-editor',
      'textarea',
      '[contenteditable="true"]',
      '[aria-label*="Ask Gemini" i]',
      '[aria-label*="Enter a prompt" i]',
      '[aria-label*="问问" i]',
      '[aria-label*="提示" i]',
    ];
    const inputs = selectors.flatMap((sel) => {
      try { return Array.from(document.querySelectorAll(sel)); } catch { return []; }
    }).filter((el, idx, arr) => arr.indexOf(el) === idx && visibleRect(el));

    let best = null;
    for (const input of inputs) {
      let p = input;
      for (let depth = 0; p && p !== document.body && depth < 9; depth++, p = p.parentElement) {
        const r = visibleRect(p);
        if (!r) continue;
        const nearBottom = r.top > window.innerHeight * 0.45;
        const composerSized = r.width > 420 && r.height >= 52 && r.height <= 240;
        const isKnownComposer =
          p.tagName?.toLowerCase() === 'input-area-v2' ||
          /\b(input-area|text-input-field|input-box-shadow)\b/.test(String(p.className || ''));
        if (nearBottom && composerSized && isKnownComposer) {
          if (!best || r.width * r.height > best.rect.width * best.rect.height) best = { el: p, rect: r };
        }
      }
    }
    return best;
  }

  function placeUsagebar() {
    if (!usagebar || !usagebar.isConnected) return;
    const host = findComposerHost();
    if (!host) {
      if (usagebar.parentElement !== document.body) document.body.appendChild(usagebar);
      usagebar.classList.add('gy-usagebar-fallback');
      usagebar.classList.remove('gy-usagebar-inside');
      Object.assign(usagebar.style, { left: '', top: '', width: '', right: '', bottom: '' });
      return;
    }
    if (usagebar.parentElement !== host.el) host.el.appendChild(usagebar);
    host.el.classList.add('gy-composer-host');
    if (getComputedStyle(host.el).position === 'static') host.el.style.position = 'relative';
    usagebar.classList.add('gy-usagebar-inside');
    usagebar.classList.remove('gy-usagebar-fallback');
    Object.assign(usagebar.style, { left: '', top: '', width: '', right: '', bottom: '' });
  }

  function compactReset(raw) {
    return formatReset(raw).replace(/恢复/g, '');
  }

  // —— 预览卡片（悬停 2 行，驻留 1.2s 展开 5 行）——
  let dwellTimer = null;

  function positionPreview(markerEl, clientY) {
    const pv = getOrCreatePreview();
    if (!pv || !markerEl) return;
    const rect = markerEl.getBoundingClientRect();
    const markerCenterY = rect.top + rect.height / 2;
    const anchorY = Number.isFinite(clientY) ? clientY : markerCenterY;
    const measured = pv.getBoundingClientRect();
    const height = measured.height || 120;
    const width = measured.width || 342;
    const gap = 10;
    const top = Math.max(8, Math.min(anchorY - height / 2, window.innerHeight - height - 8));
    const left = Math.max(10, rect.left - width - gap);
    pv.style.top = `${top}px`;
    pv.style.left = `${left}px`;
    pv.style.right = 'auto';
  }

  function showPreview(markerEl, turn, clientY) {
    const pv = getOrCreatePreview();
    if (!pv) return;
    const userText = normText(turn.userText).slice(0, 600);
    const modelText = normText(turn.modelText).slice(0, 900);
    const body = showModel && modelText
      ? `<div class="gy-pv-section gy-pv-section-model">
           <span class="gy-pv-inline-role gy-pv-model">${T.modelLabel}</span>
           <span class="gy-pv-text gy-pv-model-text" style="-webkit-line-clamp:${CONFIG.previewLinesCollapsed}">${escapeHtml(modelText)}</span>
         </div>
         <div class="gy-pv-section">
           <span class="gy-pv-inline-role">${T.userLabel}</span>
           <span class="gy-pv-text gy-pv-user-text" style="-webkit-line-clamp:1">${escapeHtml(userText || '（空）')}</span>
         </div>`
      : `<div class="gy-pv-section">
           <span class="gy-pv-inline-role">${T.userLabel}</span>
           <span class="gy-pv-text gy-pv-user-text" style="-webkit-line-clamp:${CONFIG.previewLinesCollapsed}">${escapeHtml(userText || '（空）')}</span>
         </div>`;
    pv.innerHTML = `
      <div class="gy-pv-head">
        <span class="gy-pv-role">${showModel && modelText ? 'User + Gemini' : T.userLabel}</span>
        <span class="gy-pv-turn">第 ${turn.index} 轮</span>
      </div>
      <div class="gy-pv-body ${showModel && modelText ? 'gy-pv-duo' : 'gy-pv-single'}">${body}</div>
    `;
    pv.style.top = '8px';
    pv.style.left = '-9999px';
    pv.style.right = 'auto';
    pv.classList.add('gy-show');
    positionPreview(markerEl, clientY);
    clearTimeout(dwellTimer);
    dwellTimer = setTimeout(() => {
      const modelBody = pv.querySelector('.gy-pv-model-text');
      const userBody = pv.querySelector('.gy-pv-user-text');
      if (modelBody || userBody) {
        if (modelBody) modelBody.style.webkitLineClamp = String(CONFIG.previewLinesExpanded);
        if (userBody) userBody.style.webkitLineClamp = showModel && modelText ? '2' : String(CONFIG.previewLinesExpanded);
        requestAnimationFrame(() => positionPreview(markerEl, clientY));
      }
    }, CONFIG.previewDwellMs);
  }

  function hidePreview() {
    clearTimeout(dwellTimer);
    document.getElementById('gy-preview')?.classList.remove('gy-show');
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // —— 渲染标记 ——
  function renderMarkers() {
    const wrap = document.getElementById('gy-markers');
    if (!wrap) return;
    wrap.innerHTML = '';
    rail.classList.toggle('gy-orange', showModel);
    const modeBtn = document.getElementById('gy-mode-btn');
    if (modeBtn) {
      modeBtn.title = showModel ? T.modeOrangeTip : T.modeWhiteTip;
      modeBtn.classList.toggle('gy-tb-on', showModel);
    }

    for (const t of turns) {
      const m = document.createElement('button');
      m.type = 'button';
      m.className = 'gy-marker';
      m.dataset.turn = String(t.index);
      if (t.index === activeIndex) m.classList.add('gy-active');
      m.innerHTML = `<span class="gy-marker-index">${t.index}</span><span class="gy-marker-bar"></span>`;

      // 邻近缩放（dock 效果）：悬停时自己放大，左右邻居半放大
      m.addEventListener('mouseenter', (e) => {
        document.querySelectorAll('#gy-markers .gy-marker').forEach((x) => {
          x.classList.remove('gy-hover', 'gy-near', 'gy-near-2');
        });
        m.classList.add('gy-hover');
        if (m.previousElementSibling) m.previousElementSibling.classList.add('gy-near');
        if (m.nextElementSibling) m.nextElementSibling.classList.add('gy-near');
        if (m.previousElementSibling?.previousElementSibling) m.previousElementSibling.previousElementSibling.classList.add('gy-near-2');
        if (m.nextElementSibling?.nextElementSibling) m.nextElementSibling.nextElementSibling.classList.add('gy-near-2');
        showPreview(m, t, e.clientY);
      });
      m.addEventListener('mousemove', (e) => {
        if (m.classList.contains('gy-hover')) positionPreview(m, e.clientY);
      });
      m.addEventListener('mouseleave', () => {
        document.querySelectorAll('#gy-markers .gy-marker').forEach((x) => {
          x.classList.remove('gy-hover', 'gy-near', 'gy-near-2');
        });
        hidePreview();
      });
      m.addEventListener('click', () => jumpTo(t.userEl || t.modelEl));
      wrap.appendChild(m);
    }

    updateCounter();
  }

  function updateCounter() {
    const c = document.getElementById('gy-counter');
    if (c) c.textContent = T.turn(activeIndex, turns.length);
  }

  function jumpTo(el) {
    if (!el) return;
    const sc = scrollContainer || findScrollContainer(el);
    const cRect = sc.getBoundingClientRect ? sc.getBoundingClientRect() : { top: 0 };
    const r = el.getBoundingClientRect();
    const target = r.top - (cRect.top || 0) + sc.scrollTop - 80;
    sc.scrollTo ? sc.scrollTo({ top: target, behavior: 'smooth' }) : (sc.scrollTop = target);
    el.classList.add('gy-jump-flash');
    setTimeout(() => el.classList.remove('gy-jump-flash'), 1200);
  }

  // —— 滚动监听：判断当前所在轮次。用 rAF 跟随滚动帧，避免 debounce 导致停顿后才更新。
  function updateScrollSpyNow() {
    if (!turns.length || !scrollContainer) return;
    const anchorY = window.innerHeight * CONFIG.scrollSpyAnchor;
    let best = 1, bestDist = Infinity;
    for (const t of turns) {
      const el = t.userEl || t.modelEl;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const d = Math.abs(r.top - anchorY);
      if (r.top <= anchorY && d < bestDist) { bestDist = d; best = t.index; }
    }
    // 若全部都在参考线下方，取第一轮
    if (bestDist === Infinity) {
      let minTop = Infinity;
      for (const t of turns) {
        const el = t.userEl || t.modelEl;
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.top < minTop) { minTop = r.top; best = t.index; }
      }
    }
    if (best !== activeIndex) {
      activeIndex = best;
      document.querySelectorAll('#gy-markers .gy-marker').forEach((m) => {
        m.classList.toggle('gy-active', Number(m.dataset.turn) === activeIndex);
      });
      updateCounter();
    }
  }

  function onScroll() {
    if (scrollSpyFrame) return;
    scrollSpyFrame = requestAnimationFrame(() => {
      scrollSpyFrame = 0;
      updateScrollSpyNow();
    });
  }

  function bindScroll() {
    const first = turns[0] && (turns[0].userEl || turns[0].modelEl);
    const next = first ? findScrollContainer(first) : null;
    if (next && next !== scrollContainer) {
      scrollEventTarget?.removeEventListener?.('scroll', onScroll);
      scrollContainer = next;
      scrollEventTarget = scrollContainer === document.scrollingElement ? window : scrollContainer;
      scrollEventTarget.addEventListener('scroll', onScroll, { passive: true });
    }
    if (!resizeBound) {
      resizeBound = true;
      window.addEventListener('resize', () => {
        placeUsagebar();
        onScroll();
      }, { passive: true });
    }
  }

  // ==========================================================================
  // 7. 选择复制模式（点选 + 框选）
  // ==========================================================================
  let selectBar = null;
  let marquee = null;
  let marqueeStart = null;

  function enterSelectMode() {
    selectMode = true;
    selected.clear();
    buildTurns();
    document.body.classList.add('gy-selecting');
    document.getElementById('gy-select-btn')?.classList.add('gy-tb-on');

    if (!selectBar) {
      selectBar = document.createElement('div');
      selectBar.id = 'gy-selectbar';
      selectBar.innerHTML = `
        <span class="gy-sb-count" id="gy-sb-count"></span>
        <button class="gy-sb-btn" id="gy-sb-all">${T.selectAll}</button>
        <button class="gy-sb-btn" id="gy-sb-invert">${T.invertSel}</button>
        <button class="gy-sb-btn gy-sb-primary" id="gy-sb-copy">${T.copySelected}</button>
        <button class="gy-sb-btn" id="gy-sb-exit">${T.exitSelect}</button>
      `;
      document.body.appendChild(selectBar);
      selectBar.querySelector('#gy-sb-all').addEventListener('click', () => {
        const allSelected = selected.size === turns.length;
        selected = allSelected ? new Set() : new Set(turns.map((t) => t.index));
        selectBar.querySelector('#gy-sb-all').textContent = allSelected ? T.selectAll : T.deselectAll;
        paintSelection();
      });
      selectBar.querySelector('#gy-sb-invert').addEventListener('click', () => {
        const next = new Set();
        for (const t of turns) if (!selected.has(t.index)) next.add(t.index);
        selected = next;
        paintSelection();
      });
      selectBar.querySelector('#gy-sb-copy').addEventListener('click', () => {
        if (!selected.size) return toast(T.selectFirst);
        const picked = turns.filter((t) => selected.has(t.index));
        const md = picked.map(turnToMarkdown).join('\n\n---\n\n');
        copyText(md, T.copied(picked.length));
      });
      selectBar.querySelector('#gy-sb-exit').addEventListener('click', exitSelectMode);
    }
    selectBar.classList.add('gy-show');
    paintSelection();

    document.addEventListener('mousedown', onMarqueeDown, true);
    document.addEventListener('click', onTurnClick, true);
  }

  function exitSelectMode() {
    selectMode = false;
    document.body.classList.remove('gy-selecting');
    document.getElementById('gy-select-btn')?.classList.remove('gy-tb-on');
    selectBar?.classList.remove('gy-show');
    clearSelectionPaint();
    selected.clear();
    document.removeEventListener('mousedown', onMarqueeDown, true);
    document.removeEventListener('click', onTurnClick, true);
    removeMarquee();
  }

  function turnRegionEls(t) {
    return [t.userEl, t.modelEl].filter(Boolean);
  }

  function paintSelection() {
    clearSelectionPaint();
    for (const t of turns) {
      if (selected.has(t.index)) {
        turnRegionEls(t).forEach((el) => el.classList.add('gy-selected'));
      }
    }
    const cnt = document.getElementById('gy-sb-count');
    if (cnt) cnt.textContent = T.selecting(selected.size);
  }

  function clearSelectionPaint() {
    document.querySelectorAll('.gy-selected').forEach((el) => el.classList.remove('gy-selected'));
    document.querySelectorAll('.gy-preselect').forEach((el) => el.classList.remove('gy-preselect'));
  }

  function findTurnByEventTarget(target) {
    for (const t of turns) {
      for (const el of turnRegionEls(t)) {
        if (el.contains(target)) return t;
      }
    }
    return null;
  }

  // 点选：单击某轮的任意区域即切换选中
  let suppressClick = false;
  function onTurnClick(e) {
    if (!selectMode) return;
    if (selectBar?.contains(e.target) || rail?.contains(e.target)) return;
    if (suppressClick) { suppressClick = false; e.preventDefault(); e.stopPropagation(); return; }
    const t = findTurnByEventTarget(e.target);
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    selected.has(t.index) ? selected.delete(t.index) : selected.add(t.index);
    paintSelection();
  }

  // 框选：按住拖出矩形，与矩形相交的轮次切换选中
  function onMarqueeDown(e) {
    if (!selectMode || e.button !== 0) return;
    if (selectBar?.contains(e.target) || rail?.contains(e.target)) return;
    marqueeStart = { x: e.clientX, y: e.clientY };
    document.addEventListener('mousemove', onMarqueeMove, true);
    document.addEventListener('mouseup', onMarqueeUp, true);
  }

  function onMarqueeMove(e) {
    if (!marqueeStart) return;
    const dx = Math.abs(e.clientX - marqueeStart.x);
    const dy = Math.abs(e.clientY - marqueeStart.y);
    if (!marquee && dx < 6 && dy < 6) return; // 移动太小视为点击
    if (!marquee) {
      marquee = document.createElement('div');
      marquee.id = 'gy-marquee';
      document.body.appendChild(marquee);
    }
    const x = Math.min(e.clientX, marqueeStart.x);
    const y = Math.min(e.clientY, marqueeStart.y);
    const w = Math.abs(e.clientX - marqueeStart.x);
    const h = Math.abs(e.clientY - marqueeStart.y);
    Object.assign(marquee.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });

    // 实时预览：与框相交的轮次加 preselect 高亮
    const rect = { left: x, top: y, right: x + w, bottom: y + h };
    document.querySelectorAll('.gy-preselect').forEach((el) => el.classList.remove('gy-preselect'));
    for (const t of turns) {
      for (const el of turnRegionEls(t)) {
        const r = el.getBoundingClientRect();
        const hit = !(r.right < rect.left || r.left > rect.right || r.bottom < rect.top || r.top > rect.bottom);
        if (hit) { turnRegionEls(t).forEach((x2) => x2.classList.add('gy-preselect')); break; }
      }
    }
    e.preventDefault();
  }

  function onMarqueeUp(e) {
    document.removeEventListener('mousemove', onMarqueeMove, true);
    document.removeEventListener('mouseup', onMarqueeUp, true);
    if (marquee) {
      // 把预选的轮次正式加入选中集合
      const pre = new Set();
      document.querySelectorAll('.gy-preselect').forEach((el) => {
        const t = findTurnByEventTarget(el);
        if (t) pre.add(t.index);
      });
      pre.forEach((i) => selected.add(i));
      paintSelection();
      suppressClick = true; // 防止 mouseup 后的 click 误触发点选
      removeMarquee();
      e.preventDefault();
      e.stopPropagation();
    }
    marqueeStart = null;
  }

  function removeMarquee() {
    marquee?.remove();
    marquee = null;
    document.querySelectorAll('.gy-preselect').forEach((el) => el.classList.remove('gy-preselect'));
  }

  // ==========================================================================
  // 9. 额度监控（移植自开源项目 gemini-usage-bar，做了中文界面兼容增强）
  //    策略一：fetch 官方 /usage 页面解析；策略二：隐藏 iframe 兜底（需 background.js
  //    摘除防嵌入响应头）。每次 Gemini 生成结束 + 每 5 分钟自动刷新。
  // ==========================================================================
  let usageData = null;       // { currentPercent, currentReset, weeklyPercent, weeklyReset }
  let usageIframe = null;
  let usagePoll = null;
  let isGenerating = false;
  let lastUsageError = '';    // 供诊断报告使用

  // 解析一个额度区块：兼容英文 "63% used" 与中文 "已使用 63%" 等多语言文案
  function parseUsageBlock(el) {
    if (!el) return null;
    const texts = Array.from(el.querySelectorAll('p, div, span'))
      .map((n) => normText(n.textContent))
      .filter(Boolean);
    let pct = null;
    let reset = '';
    for (const t of texts) {
      if (pct === null) {
        const m = t.match(/(\d{1,3})\s*%/);
        if (m) pct = Math.min(100, parseInt(m[1], 10));
      }
      if (!reset && /resets|reset|重置|恢复|恢復|刷新于|更新于/i.test(t) && t.length < 100) {
        reset = t;
      }
    }
    if (pct === null) return null;
    return { pct, reset: reset || '重置时间未知' };
  }

  function parseUsageDoc(doc) {
    if (!doc) return null;
    const cur = doc.querySelector('[data-test-id="gxu-currently"], .gxu-currently');
    const wk = doc.querySelector('[data-test-id="gxu-weekly"], .gxu-weekly');
    const c = parseUsageBlock(cur);
    const w = parseUsageBlock(wk);
    if (!c && !w) return null;
    return {
      currentPercent: c ? c.pct : 0,
      currentReset: c ? c.reset : '—',
      weeklyPercent: w ? w.pct : 0,
      weeklyReset: w ? w.reset : '—',
    };
  }

  function usageColor(p) {
    if (p < 50) return 'var(--gy-grad)';
    if (p < 80) return 'var(--gy-warn)';
    return 'var(--gy-danger)';
  }

  // 把官方重置文案（中英文）转为 Claude-Yada 风格：
  // 当天 → "15:10恢复"；次日 → "明天 15:10恢复"；更远 → "6月10日 18:00恢复"
  // 规则提取自 Claude-Yada assets/ui.js 的时间格式化函数
  function formatReset(raw) {
    if (!raw) return '恢复时间未知';
    const s = normText(raw);
    // 取时间：兼容 "3:00 PM" / "15:10" / "下午3:00"
    let hh = null, mm = null;
    const ampm = s.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    const h24 = s.match(/(\d{1,2}):(\d{2})/);
    const zhPm = /下午|晚上/.test(s);
    if (ampm) {
      hh = parseInt(ampm[1], 10) % 12 + (/pm/i.test(ampm[3]) ? 12 : 0);
      mm = ampm[2];
    } else if (h24) {
      hh = parseInt(h24[1], 10);
      if (zhPm && hh < 12) hh += 12;
      mm = h24[2];
    }
    const timeStr = hh !== null ? `${String(hh).padStart(2, '0')}:${mm}` : '';
    // 取日期：兼容 "6月10日" / "Jun 10" / "June 10"
    let dateStr = '';
    const zhDate = s.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
    const enDate = s.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})\b/i);
    if (zhDate) {
      dateStr = `${parseInt(zhDate[1], 10)}月${parseInt(zhDate[2], 10)}日`;
    } else if (enDate) {
      const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
      dateStr = `${months[enDate[1].slice(0, 3).toLowerCase()]}月${parseInt(enDate[2], 10)}日`;
    }
    const isTomorrow = /tomorrow|明天|明日/i.test(s);
    if (isTomorrow && timeStr) return `明天 ${timeStr}恢复`;
    if (dateStr && timeStr) return `${dateStr} ${timeStr}恢复`;
    if (dateStr) return `${dateStr}恢复`;
    if (timeStr) return `${timeStr}恢复`;
    return s.length < 40 ? s : '恢复时间未知';
  }

  function renderUsage() {
    if (!usageData) return;
    getOrCreateUsagebar();
    const ct = document.getElementById('gy-ub-cur-text');
    const cb = document.getElementById('gy-ub-cur-bar');
    const wt = document.getElementById('gy-ub-wk-text');
    const wb = document.getElementById('gy-ub-wk-bar');
    if (ct) ct.textContent = `5h ${usageData.currentPercent}% · ${compactReset(usageData.currentReset)}`;
    if (cb) {
      cb.style.width = `${usageData.currentPercent}%`;
      cb.style.background = usageColor(usageData.currentPercent);
    }
    if (wt) wt.textContent = `周 ${usageData.weeklyPercent}% · ${compactReset(usageData.weeklyReset)}`;
    if (wb) {
      wb.style.width = `${usageData.weeklyPercent}%`;
      wb.style.background = usageColor(usageData.weeklyPercent);
    }
    // 鼠标悬停可看官方原文，便于核对
    if (usagebar) usagebar.title = `官方原文 — 当前：${usageData.currentReset} | 每周：${usageData.weeklyReset}（点击刷新）`;
  }

  function setUsageAuthWarning() {
    getOrCreateUsagebar();
    const ct = document.getElementById('gy-ub-cur-text');
    if (ct) ct.innerHTML =
      '🔑 <a href="https://gemini.google.com/usage" target="_blank" style="text-decoration:underline;color:inherit">需登录，点此打开额度页</a>';
    lastUsageError = 'AUTH: /usage 页面要求登录';
  }

  async function refreshUsage() {
    getOrCreateUsagebar();
    const ct0 = document.getElementById('gy-ub-cur-text');
    if (ct0 && !usageData) ct0.textContent = '5小时：加载中…';
    if (usagePoll) { clearInterval(usagePoll); usagePoll = null; }

    // 策略一：直接 fetch HTML 解析
    try {
      const resp = await fetch('https://gemini.google.com/usage?t=' + Date.now(), { credentials: 'include' });
      if (resp.ok) {
        const html = await resp.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const data = parseUsageDoc(doc);
        if (data) {
          usageData = data;
          lastUsageError = '';
          renderUsage();
          return;
        }
        lastUsageError = 'FETCH-OK 但未解析到额度区块（页面可能需客户端渲染或选择器已变）';
      } else {
        lastUsageError = `FETCH 状态码 ${resp.status}`;
      }
    } catch (e) {
      lastUsageError = 'FETCH 异常: ' + (e && e.message);
    }

    // 策略二：隐藏 iframe 渲染后轮询
    if (!usageIframe || !usageIframe.isConnected) {
      usageIframe = document.createElement('iframe');
      usageIframe.id = 'gy-usage-iframe';
      Object.assign(usageIframe.style, {
        position: 'absolute', width: '0', height: '0',
        border: 'none', visibility: 'hidden', pointerEvents: 'none',
      });
      document.body.appendChild(usageIframe);
    }
    usageIframe.src = 'https://gemini.google.com/usage?t=' + Date.now();

    let attempts = 0;
    usagePoll = setInterval(() => {
      attempts++;
      try {
        const idoc = usageIframe.contentDocument || usageIframe.contentWindow?.document;
        if (idoc) {
          if (idoc.title && /sign in|登录|登入/i.test(idoc.title)) {
            setUsageAuthWarning();
            clearInterval(usagePoll); usagePoll = null;
            return;
          }
          const data = parseUsageDoc(idoc);
          if (data) {
            usageData = data;
            lastUsageError = '';
            renderUsage();
            clearInterval(usagePoll); usagePoll = null;
            return;
          }
        }
      } catch (e) {
        // 跨域异常 → 多半被重定向去登录页
        setUsageAuthWarning();
        clearInterval(usagePoll); usagePoll = null;
        return;
      }
      if (attempts >= 30) { // 15 秒超时
        lastUsageError = lastUsageError || 'IFRAME 15 秒内未解析到额度区块';
        const ctErr = document.getElementById('gy-ub-cur-text');
        if (ctErr && !usageData) ctErr.textContent = '⚠ 额度获取失败（双击轮次计数可生成诊断报告）';
        clearInterval(usagePoll); usagePoll = null;
      }
    }, 500);
  }

  // 监测"生成中 → 空闲"翻转：生成结束 1 秒后刷新额度
  function checkGenerationState() {
    const stopBtn =
      document.querySelector('button[aria-label*="Stop" i]') ||
      document.querySelector('button[aria-label*="停止"]') ||
      document.querySelector('mat-icon[fonticon="stop"]') ||
      document.querySelector('gem-icon[name="stop"]') ||
      document.querySelector('div[class*="generating" i]');
    const generating = !!stopBtn;
    if (generating && !isGenerating) {
      isGenerating = true;
    } else if (!generating && isGenerating) {
      isGenerating = false;
      setTimeout(refreshUsage, 1000);
      rebuild(); // 新一轮对话完成，同步重建导航条
    }
  }

  // ==========================================================================
  // 10. 内置诊断器（零门槛排障）：双击轮次计数 → 自动检测全部选择器与额度解析，
  //     生成报告并复制到剪贴板，用户直接粘贴给 AI 即可定位问题。
  // ==========================================================================
  async function runDiagnostics() {
    toast('正在生成诊断报告…');
    const lines = [];
    lines.push('===== Gemini Yada 诊断报告 v1.6.0 =====');
    lines.push(`时间: ${new Date().toLocaleString()}`);
    lines.push(`页面: ${location.href}`);
    lines.push(`浏览器语言: ${navigator.language} | 界面语言猜测: ${document.documentElement.lang || '未知'}`);
    lines.push('');

    lines.push('--- 用户轮次选择器命中情况 ---');
    for (const sel of USER_TURN_SELECTORS) {
      let n = 0;
      try { n = document.querySelectorAll(sel).length; } catch { n = -1; }
      lines.push(`${n > 0 ? '✅' : '❌'} [${n}] ${sel}`);
    }
    lines.push('');
    lines.push('--- 模型回答选择器命中情况 ---');
    for (const sel of MODEL_TURN_SELECTORS) {
      let n = 0;
      try { n = document.querySelectorAll(sel).length; } catch { n = -1; }
      lines.push(`${n > 0 ? '✅' : '❌'} [${n}] ${sel}`);
    }
    lines.push('');

    buildTurns();
    lines.push(`--- 轮次解析结果: 共 ${turns.length} 轮 ---`);
    for (const t of turns.slice(0, 3)) {
      lines.push(`第${t.index}轮 user: ${normText(t.userText).slice(0, 40)}…`);
      lines.push(`第${t.index}轮 model: ${normText(t.modelText).slice(0, 40)}…`);
    }
    const sc = turns[0] ? findScrollContainer(turns[0].userEl || turns[0].modelEl) : null;
    lines.push(`滚动容器: ${sc ? `<${sc.tagName?.toLowerCase()}> class="${String(sc.className).slice(0, 60)}"` : '未找到'}`);
    lines.push('');

    lines.push('--- 额度页 /usage 解析 ---');
    try {
      const resp = await fetch('https://gemini.google.com/usage?t=' + Date.now(), { credentials: 'include' });
      lines.push(`fetch 状态码: ${resp.status}`);
      const html = await resp.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const hasCur = !!doc.querySelector('[data-test-id="gxu-currently"], .gxu-currently');
      const hasWk = !!doc.querySelector('[data-test-id="gxu-weekly"], .gxu-weekly');
      lines.push(`gxu-currently 区块: ${hasCur ? '✅ 存在' : '❌ 不存在'} | gxu-weekly 区块: ${hasWk ? '✅ 存在' : '❌ 不存在'}`);
      const data = parseUsageDoc(doc);
      lines.push(`解析结果: ${data ? JSON.stringify(data) : '❌ 解析失败'}`);
      if (!data) {
        // 把页面里所有含 % 的短文本列出来，供人工定位新结构
        const pctTexts = Array.from(doc.querySelectorAll('p, div, span, h1, h2, h3'))
          .map((n) => normText(n.textContent))
          .filter((t) => /\d{1,3}\s*%/.test(t) && t.length < 80);
        lines.push(`页面含 % 的文本（前8条）: ${JSON.stringify([...new Set(pctTexts)].slice(0, 8))}`);
        // 列出疑似额度容器的 data-test-id
        const ids = Array.from(doc.querySelectorAll('[data-test-id]'))
          .map((n) => n.getAttribute('data-test-id'));
        lines.push(`页面所有 data-test-id（去重前20）: ${JSON.stringify([...new Set(ids)].slice(0, 20))}`);
      }
    } catch (e) {
      lines.push(`fetch 异常: ${e && e.message}`);
    }
    lines.push(`运行期最近一次额度错误: ${lastUsageError || '无'}`);
    lines.push(`当前缓存额度数据: ${usageData ? JSON.stringify(usageData) : '无'}`);
    lines.push('===== 报告结束（请整段粘贴给 AI）=====');

    await copyText(lines.join('\n'), '✅ 诊断报告已复制，直接粘贴给我即可');
  }

  // ==========================================================================
  // 11. 重建与生命周期（SPA 路由切换 / DOM 变化）
  // ==========================================================================
  const rebuild = debounce(() => {
    buildTurns();
    getOrCreateRail();
    getOrCreatePreview();
    getOrCreateTopbar();
    getOrCreateUsagebar();
    placeUsagebar();
    bindScroll();
    renderMarkers();
    updateScrollSpyNow();
    if (selectMode) paintSelection();
  }, CONFIG.rebuildDebounceMs);

  function init() {
    getOrCreateRail();
    getOrCreatePreview();
    getOrCreateTopbar();
    getOrCreateUsagebar();
    rebuild();

    const isOurs = (node) => {
      if (!node || node.nodeType !== 1) return false;
      const el = /** @type {HTMLElement} */ (node);
      return (el.id && el.id.startsWith('gy-')) ||
             (typeof el.className === 'string' && el.className.startsWith('gy-')) ||
             !!el.closest?.('#gy-rail, #gy-preview, #gy-selectbar, #gy-toast, #gy-marquee, #gy-tooltip');
    };
    const mo = new MutationObserver((muts) => {
      checkGenerationState(); // 监测生成开始/结束（廉价操作，每批变动都查）
      // 忽略完全由我们自己 UI 引起的变动，防止自我触发死循环
      const relevant = muts.some((m) => {
        if (isOurs(m.target)) return false;
        const added = Array.from(m.addedNodes || []);
        const removed = Array.from(m.removedNodes || []);
        const nodes = added.concat(removed);
        if (nodes.length === 0) return true; // 属性变化等
        return nodes.some((n) => !isOurs(n));
      });
      if (relevant) rebuild();
    });
    mo.observe(document.body, { childList: true, subtree: true });

    // 额度：首次拉取 + 每 5 分钟兜底刷新（覆盖在其他设备消耗额度的情况）
    setTimeout(refreshUsage, 1500);
    setInterval(refreshUsage, 5 * 60 * 1000);

    // SPA 路由切换检测
    let lastPath = location.pathname;
    setInterval(() => {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        if (selectMode) exitSelectMode();
        activeIndex = 1;
        rebuild();
      }
    }, 800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
