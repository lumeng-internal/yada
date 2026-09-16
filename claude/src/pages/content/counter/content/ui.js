(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	function formatSeconds(totalSeconds) {
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes}:${String(seconds).padStart(2, '0')}`;
	}

	function formatCompactTokenCount(totalTokens) {
		if (!Number.isFinite(totalTokens)) return '';
		if (totalTokens < 1000) return `≈ ${totalTokens.toLocaleString()}`;
		const compact = (totalTokens / 1000).toFixed(1).replace(/\.0$/, '');
		return `≈ ${compact}k`;
	}

	const TOKEN_TOOLTIP_TEXT =
		"当前活动对话 Token 估算。\n数据只在本地浏览器处理，统计 Conversation Tree 的当前活动分支。\n使用本地 o200k_base Tokenizer；不等同于 Claude 后台精确 Context。\n不包含无法读取的系统提示、Project Knowledge、后台 Web Search 和 Research。\n图片、PDF 与其他非文本内容可能无法完整计入。\nClaude Context Compaction 后，估算可能失准。\n200k 进度条仅作视觉参考。";

	function tokenTooltipText({ nonTextBlockCount = 0, unknownBlockCount = 0, compacted = false, branchComplete = true, stale = false } = {}) {
		const notes = [TOKEN_TOOLTIP_TEXT];
		if (nonTextBlockCount > 0) notes.push(`检测到 ${nonTextBlockCount} 个非文本内容块，未编造其 Token。`);
		if (unknownBlockCount > 0) notes.push(`检测到 ${unknownBlockCount} 个未知内容块，估算可能不完整。`);
		if (!branchComplete) notes.push('当前活动父链不完整，结果不可视为完整估算。');
		if (compacted) notes.push('检测到 Claude Compaction 标记，旧父链总量不代表当前后台 Context。');
		if (stale) notes.push('Conversation API 当前不可用，显示的是上一次成功结果。');
		return notes.join('\n');
	}

	function parseResetTimestamp(value) {
		if (!value) return null;
		const timestamp = Date.parse(value);
		return Number.isFinite(timestamp) ? timestamp : null;
	}

	function formatClock(date) {
		return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
	}

	function isSameLocalDate(a, b) {
		return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
	}

	function isTomorrowLocalDate(date, now) {
		const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
		return isSameLocalDate(date, tomorrow);
	}

	function formatSessionResetTime(timestampMs) {
		if (!Number.isFinite(timestampMs)) return '恢复时间未知';
		const now = new Date();
		const resetAt = new Date(timestampMs);
		const clock = formatClock(resetAt);
		if (isSameLocalDate(resetAt, now)) return `${clock}恢复`;
		if (isTomorrowLocalDate(resetAt, now)) return `明天 ${clock}恢复`;
		return `${resetAt.getMonth() + 1}月${resetAt.getDate()}日 ${clock}恢复`;
	}

	function formatWeeklyResetTime(timestampMs) {
		if (!Number.isFinite(timestampMs)) return '恢复时间未知';
		const resetAt = new Date(timestampMs);
		return `${resetAt.getMonth() + 1}月${resetAt.getDate()}日 ${formatClock(resetAt)}恢复`;
	}

	function setupTooltip(element, tooltip, { topOffset = 10 } = {}) {
		if (!element || !tooltip) return;
		if (element.hasAttribute('data-tooltip-setup')) return;
		element.setAttribute('data-tooltip-setup', 'true');
		element.classList.add('cc-tooltipTrigger');

		let pressTimer;
		let hideTimer;

		const show = () => {
			const rect = element.getBoundingClientRect();
			tooltip.style.opacity = '1';
			const tipRect = tooltip.getBoundingClientRect();

			let left = rect.left + rect.width / 2;
			if (left + tipRect.width / 2 > window.innerWidth) left = window.innerWidth - tipRect.width / 2 - 10;
			if (left - tipRect.width / 2 < 0) left = tipRect.width / 2 + 10;

			let top = rect.top - tipRect.height - topOffset;
			if (top < 10) top = rect.bottom + 10;

			tooltip.style.left = `${left}px`;
			tooltip.style.top = `${top}px`;
			tooltip.style.transform = 'translateX(-50%)';
		};

		const hide = () => {
			tooltip.style.opacity = '0';
			clearTimeout(hideTimer);
		};

		element.addEventListener('pointerdown', (e) => {
			if (e.pointerType === 'touch' || e.pointerType === 'pen') {
				pressTimer = setTimeout(() => {
					show();
					hideTimer = setTimeout(hide, 3000);
				}, 500);
			}
		});

		element.addEventListener('pointerup', () => clearTimeout(pressTimer));
		element.addEventListener('pointercancel', () => {
			clearTimeout(pressTimer);
			hide();
		});

		element.addEventListener('pointerenter', (e) => {
			if (e.pointerType === 'mouse') show();
		});

		element.addEventListener('pointerleave', (e) => {
			if (e.pointerType === 'mouse') hide();
		});
	}

	function makeTooltip(text) {
		const tip = document.createElement('div');
		tip.className = 'bg-bg-500 text-text-000 cc-tooltip';
		tip.textContent = text;
		document.body.appendChild(tip);
		return tip;
	}

	class CounterUI {
		constructor({ onUsageRefresh } = {}) {
			this.onUsageRefresh = onUsageRefresh || null;

			this.headerContainer = null;
			this.headerDisplay = null;
			this.lengthGroup = null;
			this.lengthDisplay = null;
			this.compactLengthDisplay = null;
			this.cachedDisplay = null;
			this.lengthBar = null;
			this.lengthTooltip = null;
			this.lastCachedUntilMs = null;
			this.pendingCache = false;
			this.lastTotalTokens = null;

			this.usageLine = null;
			this.sessionUsageSpan = null;
			this.weeklyUsageSpan = null;
			this.sessionBar = null;
			this.sessionBarFill = null;
			this.weeklyBar = null;
			this.weeklyBarFill = null;
			this.sessionResetMs = null;
			this.weeklyResetMs = null;
			this.sessionMarker = null;
			this.weeklyMarker = null;
			this.sessionWindowStartMs = null;
			this.weeklyWindowStartMs = null;
			this.sessionUsagePct = null;
			this.weeklyUsagePct = null;
			this.refreshingUsage = false;

			this.domObserver = null;
		}

		getProgressChrome() {
			const root = document.documentElement;
			const modeDark = root.dataset?.mode === 'dark';
			const modeLight = root.dataset?.mode === 'light';
			const isDark = modeDark && !modeLight;

			return {
				strokeColor: isDark ? CC.COLORS.PROGRESS_OUTLINE_DARK : CC.COLORS.PROGRESS_OUTLINE_LIGHT,
				fillColor: isDark ? CC.COLORS.PROGRESS_FILL_DARK : CC.COLORS.PROGRESS_FILL_LIGHT,
				markerColor: isDark ? CC.COLORS.PROGRESS_MARKER_DARK : CC.COLORS.PROGRESS_MARKER_LIGHT,
				boldColor: isDark ? CC.COLORS.BOLD_DARK : CC.COLORS.BOLD_LIGHT
			};
		}

		refreshProgressChrome() {
			const { strokeColor, fillColor, markerColor } = this.getProgressChrome();

			const applyBarChrome = (bar, { fillWarn } = {}) => {
				if (!bar) return;
				bar.style.setProperty('--cc-stroke', strokeColor);
				bar.style.setProperty('--cc-fill', fillColor);
				bar.style.setProperty('--cc-fill-warn', fillWarn ?? fillColor);
				bar.style.setProperty('--cc-marker', markerColor);
			};

			applyBarChrome(this.lengthBar, { fillWarn: fillColor });
			applyBarChrome(this.sessionBar, { fillWarn: CC.COLORS.RED_WARNING });
			applyBarChrome(this.weeklyBar, { fillWarn: CC.COLORS.RED_WARNING });
		}

		initialize() {
			// Header container (tokens + cache timer)
			this.headerContainer = document.createElement('div');
			this.headerContainer.className = 'text-text-500 text-xs !px-1 cc-header';
			this.headerContainer.dataset.claudeYadaTokenCounter = 'true';

			this.headerDisplay = document.createElement('span');
			this.headerDisplay.className = 'cc-headerItem';

			this.lengthGroup = document.createElement('span');
			this.lengthGroup.className = 'claude-yada-header-counter-content';
			this.lengthDisplay = document.createElement('span');
			this.lengthDisplay.className = 'claude-yada-header-counter-value';
			this.compactLengthDisplay = document.createElement('span');
			this.compactLengthDisplay.className =
				'claude-yada-header-counter-value claude-yada-header-counter-value--compact';
			this.cachedDisplay = document.createElement('span');
			this.cacheTimeSpan = null; // reference to inner time span

			this.lengthGroup.appendChild(this.lengthDisplay);
			this.headerDisplay.appendChild(this.lengthGroup);

			// Usage line (session + weekly)
			this._initUsageLine();

			this._setupTooltips();
			this._observeDom();
			this._observeTheme();
		}

		_observeTheme() {
			// Watch for theme changes (data-mode attribute on <html>)
			const observer = new MutationObserver(() => this.refreshProgressChrome());
			observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] });
		}

		_observeDom() {
			// Track pending reattach attempts independently.
			// The Counter follows the existing Copy host, so this observer does not
			// introduce a second Claude-header detector.
			let usageReattachPending = false;
			let headerReattachPending = false;

			this.domObserver = new MutationObserver(() => {
				const usageMissing = this.usageLine && !document.contains(this.usageLine);
				const copyRoot = document.querySelector(CC.DOM.COPY_BUTTON_ROOT);
				const headerMissing = !document.contains(this.headerContainer);
				const headerTargetChanged = copyRoot?.parentElement && (
					this.headerContainer.parentElement !== copyRoot.parentElement ||
					this.headerContainer.previousElementSibling !== null
				);
				const headerTargetGone = !copyRoot &&
					this.headerContainer.dataset.counterMount === 'header';

				if (usageMissing && !usageReattachPending) {
					usageReattachPending = true;
					CC.waitForElement(CC.DOM.MODEL_SELECTOR_DROPDOWN, 60000).then((el) => {
						usageReattachPending = false;
						if (el) this.attachUsageLine();
					});
				}

				if ((headerMissing || headerTargetChanged || headerTargetGone) && !headerReattachPending) {
					headerReattachPending = true;
					Promise.resolve().then(() => {
						headerReattachPending = false;
						this.attachHeader();
					});
				}
			});
			this.domObserver.observe(document.body, { childList: true, subtree: true });
		}

		_initUsageLine() {
			this.usageLine = document.createElement('div');
			this.usageLine.className =
				'text-text-400 text-[11px] cc-usageRow cc-hidden flex flex-row items-center gap-3 w-full';

			this.sessionUsageSpan = document.createElement('span');
			this.sessionUsageSpan.className = 'cc-usageText';

			this.sessionBar = document.createElement('div');
			this.sessionBar.className = 'cc-bar cc-bar--usage';
			this.sessionBarFill = document.createElement('div');
			this.sessionBarFill.className = 'cc-bar__fill';
			this.sessionMarker = document.createElement('div');
			this.sessionMarker.className = 'cc-bar__marker cc-hidden';
			this.sessionMarker.style.left = '0%';
			this.sessionBar.appendChild(this.sessionBarFill);
			this.sessionBar.appendChild(this.sessionMarker);

			this.weeklyUsageSpan = document.createElement('span');
			this.weeklyUsageSpan.className = 'cc-usageText';

			this.weeklyBar = document.createElement('div');
			this.weeklyBar.className = 'cc-bar cc-bar--usage';
			this.weeklyBarFill = document.createElement('div');
			this.weeklyBarFill.className = 'cc-bar__fill';
			this.weeklyMarker = document.createElement('div');
			this.weeklyMarker.className = 'cc-bar__marker cc-hidden';
			this.weeklyMarker.style.left = '0%';
			this.weeklyBar.appendChild(this.weeklyBarFill);
			this.weeklyBar.appendChild(this.weeklyMarker);

			this.sessionGroup = document.createElement('div');
			this.sessionGroup.className = 'cc-usageGroup';
			this.sessionGroup.appendChild(this.sessionUsageSpan);
			this.sessionGroup.appendChild(this.sessionBar);

			this.weeklyGroup = document.createElement('div');
			this.weeklyGroup.className = 'cc-usageGroup cc-usageGroup--weekly';
			this.weeklyGroup.appendChild(this.weeklyBar);
			this.weeklyGroup.appendChild(this.weeklyUsageSpan);

			this.usageLine.appendChild(this.sessionGroup);
			this.usageLine.appendChild(this.weeklyGroup);

			this.refreshProgressChrome();

			this.usageLine.addEventListener('click', async () => {
				if (!this.onUsageRefresh || this.refreshingUsage) return;
				this.refreshingUsage = true;
				this.usageLine.classList.add('cc-usageRow--dim');
				try {
					await this.onUsageRefresh();
				} finally {
					this.usageLine.classList.remove('cc-usageRow--dim');
					this.refreshingUsage = false;
				}
			});
		}

		_setupTooltips() {
			this.lengthTooltip = makeTooltip(tokenTooltipText());
			setupTooltip(
				this.lengthGroup,
				this.lengthTooltip,
				{ topOffset: 8 }
			);

			setupTooltip(
				this.cachedDisplay,
				makeTooltip("Messages sent while cached are significantly cheaper."),
				{ topOffset: 8 }
			);

			setupTooltip(
				this.sessionGroup,
				makeTooltip("5-hour session window.\nThe bar shows your usage.\nThe line marks where you are in the window."),
				{ topOffset: 8 }
			);

			setupTooltip(
				this.weeklyGroup,
				makeTooltip("7-day usage window.\nThe bar shows your usage.\nThe line marks where you are in the window."),
				{ topOffset: 8 }
			);
		}

		attach() {
			this.attachUsageLine();
			this.attachHeader();
			this.refreshProgressChrome();
		}

		attachHeader() {
			const copyRoot = document.querySelector(CC.DOM.COPY_BUTTON_ROOT);
			if (copyRoot?.parentElement) {
				if (
					this.headerContainer.parentElement !== copyRoot.parentElement ||
					this.headerContainer.previousElementSibling !== null
				) {
					copyRoot.parentElement.prepend(this.headerContainer);
				}
				this.headerContainer.dataset.counterMount = 'header';
			} else {
				// The existing composer Usage row is the bounded fallback while the
				// shared toolbar host is absent or being rebuilt.
				if (!this.usageLine || !document.contains(this.usageLine)) return;
				if (
					this.headerContainer.parentElement !== this.usageLine.parentElement ||
					this.headerContainer.nextElementSibling !== this.usageLine
				) {
					this.usageLine.before(this.headerContainer);
				}
				this.headerContainer.dataset.counterMount = 'composer';
			}
			this._renderHeader();
			this.refreshProgressChrome();
		}

		attachUsageLine() {
			if (!this.usageLine) return;
			const modelSelector = document.querySelector(CC.DOM.MODEL_SELECTOR_DROPDOWN);
			if (!modelSelector) return;
			const gridContainer = modelSelector.closest('[data-testid="chat-input-grid-container"]');
			const gridArea = modelSelector.closest('[data-testid="chat-input-grid-area"]');
			const findToolbarRow = (el, stopAt) => {
				let cur = el;
				while (cur && cur !== document.body) {
					if (stopAt && cur === stopAt) break;
					if (cur !== el && cur.nodeType === 1) {
						const style = window.getComputedStyle(cur);
						if (style.display === 'flex' && style.flexDirection === 'row') {
							const buttons = cur.querySelectorAll('button').length;
							if (buttons > 1) return cur;
						}
					}
					cur = cur.parentElement;
				}
				return null;
			};

			const toolbarRow =
				(gridContainer ? findToolbarRow(modelSelector, gridArea || gridContainer) : null) ||
				findToolbarRow(modelSelector) ||
				modelSelector.parentElement?.parentElement?.parentElement;
			if (!toolbarRow) return;
			if (toolbarRow.nextElementSibling !== this.usageLine) {
				toolbarRow.after(this.usageLine);
			}
			this.attachHeader();
			this.refreshProgressChrome();
		}

		setPendingCache(pending) {
			this.pendingCache = pending;
			if (this.cacheTimeSpan) {
				if (pending) {
					this.cacheTimeSpan.style.color = '';
				} else {
					const { boldColor } = this.getProgressChrome();
					this.cacheTimeSpan.style.color = boldColor;
				}
			}
		}

		setConversationMetrics({
			totalTokens,
			cachedUntil,
			nonTextBlockCount = 0,
			unknownBlockCount = 0,
			compacted = false,
			branchComplete = true,
			estimateIncomplete = false
		} = {}) {
			this.pendingCache = false;

			if (typeof totalTokens !== 'number') {
				this.lastTotalTokens = null;
				this.lengthDisplay.textContent = '';
				this.compactLengthDisplay.textContent = '';
				this.cachedDisplay.textContent = '';
				this.lastCachedUntilMs = null;
				this._renderHeader();
				return;
			}

			this.lastTotalTokens = totalTokens;
			this.headerContainer.dataset.counterState = estimateIncomplete ? 'estimate-incomplete' : 'ready';
			this.headerContainer.dataset.tokenTotal = String(totalTokens);
			this.headerContainer.dataset.nonTextBlockCount = String(nonTextBlockCount);
			const pct = Math.max(0, Math.min(100, (totalTokens / CC.CONST.CONTEXT_LIMIT_TOKENS) * 100));
			this.lengthDisplay.textContent = `≈ ${totalTokens.toLocaleString()} tokens`;
			this.compactLengthDisplay.textContent = formatCompactTokenCount(totalTokens);
			if (this.lengthTooltip) {
				this.lengthTooltip.textContent = tokenTooltipText({
					nonTextBlockCount,
					unknownBlockCount,
					compacted,
					branchComplete
				});
			}

			this.lengthDisplay.style.opacity = compacted ? '0.65' : '';
			const bar = document.createElement('div');
			bar.className = 'cc-bar cc-bar--mini';
			this.lengthBar = bar;
			const fill = document.createElement('div');
			fill.className = 'cc-bar__fill';
			fill.style.width = `${pct}%`;
			bar.appendChild(fill);
			this.refreshProgressChrome();

			const barContainer = document.createElement('span');
			barContainer.className = 'claude-yada-header-counter-track inline-flex items-center';
			barContainer.appendChild(bar);

			this.lengthGroup.replaceChildren(this.lengthDisplay, this.compactLengthDisplay, barContainer);

			// Cache timer
			const now = Date.now();
			if (typeof cachedUntil === 'number' && cachedUntil > now) {
				this.lastCachedUntilMs = cachedUntil;
				const secondsLeft = Math.max(0, Math.ceil((cachedUntil - now) / 1000));
				const { boldColor } = this.getProgressChrome();
				this.cacheTimeSpan = Object.assign(document.createElement('span'), {
					className: 'cc-cacheTime',
					textContent: formatSeconds(secondsLeft)
				});
				this.cacheTimeSpan.style.color = boldColor;
				this.cachedDisplay.replaceChildren(document.createTextNode('cached for\u00A0'), this.cacheTimeSpan);
			} else {
				this.lastCachedUntilMs = null;
				this.cacheTimeSpan = null;
				this.cachedDisplay.textContent = '';
			}

			this._renderHeader();
		}

		setConversationUnavailable({ stale = false } = {}) {
			this.pendingCache = false;
			this.headerContainer.dataset.counterState = stale && typeof this.lastTotalTokens === 'number' ? 'stale' : 'error';
			if (stale && typeof this.lastTotalTokens === 'number') {
				this.lengthDisplay.textContent = `≈ ${this.lastTotalTokens.toLocaleString()} tokens · stale`;
				this.compactLengthDisplay.textContent = `${formatCompactTokenCount(this.lastTotalTokens)} · stale`;
			} else {
				this.lastTotalTokens = null;
				this.lengthDisplay.textContent = 'Token 暂不可用';
				this.compactLengthDisplay.textContent = 'Token 暂不可用';
				this.lengthBar = null;
				this.lengthGroup.replaceChildren(this.lengthDisplay, this.compactLengthDisplay);
			}
			this.cachedDisplay.textContent = '';
			this.lastCachedUntilMs = null;
			if (this.lengthTooltip) this.lengthTooltip.textContent = tokenTooltipText({ stale });
			this._renderHeader();
		}

		_renderHeader() {
			this.headerContainer.replaceChildren();

			const hasTokens = !!this.lengthDisplay.textContent;
			const hasCache = !!this.cachedDisplay.textContent;

			if (!hasTokens) return;

			if (hasCache) {
				const gap = this.lengthBar ? '\u00A0\u00A0' : '\u00A0';
				this.headerDisplay.replaceChildren(
					this.lengthGroup,
					document.createTextNode(gap),
					this.cachedDisplay
				);
			} else {
				this.headerDisplay.replaceChildren(this.lengthGroup);
			}

			this.headerContainer.appendChild(this.headerDisplay);
		}

		setUsage(usage) {
			this.refreshProgressChrome();
			const session = usage?.five_hour || null;
			const weekly = usage?.seven_day || null;
			const hasAnyUsage =
				!!(session && typeof session.utilization === 'number') || !!(weekly && typeof weekly.utilization === 'number');
			this.usageLine?.classList.toggle('cc-hidden', !hasAnyUsage);

			if (session && typeof session.utilization === 'number') {
				const rawPct = session.utilization;
				const pct = Math.round(rawPct * 10) / 10;
				this.sessionUsagePct = pct;
				this.sessionResetMs = parseResetTimestamp(session.resets_at);
				this.sessionWindowStartMs = this.sessionResetMs ? this.sessionResetMs - 5 * 60 * 60 * 1000 : null;
				this.sessionUsageSpan.textContent = `5小时：${pct}% · ${formatSessionResetTime(this.sessionResetMs)}`;

				const width = Math.max(0, Math.min(100, rawPct));
				this.sessionBarFill.style.width = `${width}%`;
				this.sessionBarFill.classList.toggle('cc-warn', width >= 90);
				this.sessionBarFill.classList.toggle('cc-full', width >= 99.5);
			} else {
				this.sessionUsageSpan.textContent = '';
				this.sessionBarFill.style.width = '0%';
				this.sessionBarFill.classList.remove('cc-warn', 'cc-full');
				this.sessionResetMs = null;
				this.sessionWindowStartMs = null;
				this.sessionUsagePct = null;
			}

			const hasWeekly = weekly && typeof weekly.utilization === 'number';
			this.weeklyGroup?.classList.toggle('cc-hidden', !hasWeekly);
			this.sessionGroup?.classList.toggle('cc-usageGroup--single', !hasWeekly);

			if (hasWeekly) {
				this.weeklyUsageSpan.classList.remove('cc-hidden');
				this.weeklyBar.classList.remove('cc-hidden');

				const rawPct = weekly.utilization;
				const pct = Math.round(rawPct * 10) / 10;
				this.weeklyUsagePct = pct;
				this.weeklyResetMs = parseResetTimestamp(weekly.resets_at);
				this.weeklyWindowStartMs = this.weeklyResetMs ? this.weeklyResetMs - 7 * 24 * 60 * 60 * 1000 : null;
				this.weeklyUsageSpan.textContent = `周额度：${pct}% · ${formatWeeklyResetTime(this.weeklyResetMs)}`;

				const width = Math.max(0, Math.min(100, rawPct));
				this.weeklyBarFill.style.width = `${width}%`;
				this.weeklyBarFill.classList.toggle('cc-warn', width >= 90);
				this.weeklyBarFill.classList.toggle('cc-full', width >= 99.5);
			} else {
				this.weeklyUsageSpan.classList.add('cc-hidden');
				this.weeklyBar.classList.add('cc-hidden');
				this.weeklyResetMs = null;
				this.weeklyWindowStartMs = null;
				this.weeklyUsagePct = null;
				this.weeklyBarFill.classList.remove('cc-warn', 'cc-full');
			}

			this._updateMarkers();
		}

		_updateMarkers() {
			const now = Date.now();

			if (this.sessionMarker && this.sessionWindowStartMs && this.sessionResetMs) {
				const total = this.sessionResetMs - this.sessionWindowStartMs;
				const elapsed = Math.max(0, Math.min(total, now - this.sessionWindowStartMs));
				const ratio = total > 0 ? elapsed / total : 0;
				const pct = Math.max(0, Math.min(100, ratio * 100));
				this.sessionMarker.classList.remove('cc-hidden');
				this.sessionMarker.style.left = `${pct}%`;
			} else if (this.sessionMarker) {
				this.sessionMarker.classList.add('cc-hidden');
			}

			if (this.weeklyMarker && this.weeklyWindowStartMs && this.weeklyResetMs) {
				const total = this.weeklyResetMs - this.weeklyWindowStartMs;
				const elapsed = Math.max(0, Math.min(total, now - this.weeklyWindowStartMs));
				const ratio = total > 0 ? elapsed / total : 0;
				const pct = Math.max(0, Math.min(100, ratio * 100));
				this.weeklyMarker.classList.remove('cc-hidden');
				this.weeklyMarker.style.left = `${pct}%`;
			} else if (this.weeklyMarker) {
				this.weeklyMarker.classList.add('cc-hidden');
			}
		}

		tick() {
			// Cache countdown
			const now = Date.now();
			if (this.lastCachedUntilMs && this.lastCachedUntilMs > now) {
				const secondsLeft = Math.max(0, Math.ceil((this.lastCachedUntilMs - now) / 1000));
				if (this.cacheTimeSpan) {
					this.cacheTimeSpan.textContent = formatSeconds(secondsLeft);
				}
			} else if (this.lastCachedUntilMs && this.lastCachedUntilMs <= now) {
				this.lastCachedUntilMs = null;
				this.cacheTimeSpan = null;
				this.pendingCache = false;
				this.cachedDisplay.textContent = '';
				this._renderHeader();
			}

			// Reset labels use browser-local time, so refresh them as the day changes.
			if (this.sessionUsagePct !== null && this.sessionUsageSpan?.textContent) {
				this.sessionUsageSpan.textContent = `5小时：${this.sessionUsagePct}% · ${formatSessionResetTime(this.sessionResetMs)}`;
			}

			if (this.weeklyUsagePct !== null && this.weeklyUsageSpan?.textContent) {
				this.weeklyUsageSpan.textContent = `周额度：${this.weeklyUsagePct}% · ${formatWeeklyResetTime(this.weeklyResetMs)}`;
			}

			this._updateMarkers();
		}
	}

	CC.ui = {
		CounterUI
	};
})();
