/**
 * selectors.ts
 * Purpose: Centralized DOM selectors used across scripts.
 * Created: 2026-03-19
 */

// Content/Popup/Options React mount root id.
export const APP_ROOT_ID = '__root';
// Selector for locating the shared React mount root.
export const APP_ROOT_SELECTOR = `#${APP_ROOT_ID}`;

// Root host id for the injected export button app.
export const EXPORT_BUTTON_ROOT_ID = 'claude-nexus-export-button-root';
// Selector for checking whether export button host already exists.
export const EXPORT_BUTTON_ROOT_SELECTOR = `#${EXPORT_BUTTON_ROOT_ID}`;
// Root host id for the injected copy-all button app.
export const COPY_BUTTON_ROOT_ID = 'claude-yada-copy-button-root';
// Selector for checking whether copy-all button host already exists.
export const COPY_BUTTON_ROOT_SELECTOR = `#${COPY_BUTTON_ROOT_ID}`;

// Main sidebar navigation container.
export const SIDEBAR_NAV_SELECTOR = 'nav';
// Fallback sidebar container when nav is not available.
export const SIDEBAR_FALLBACK_CONTAINER_SELECTOR = 'div.flex-1.relative';

// Conversation anchors in sidebar list.
export const CONVERSATION_LINK_SELECTOR = 'a[href^="/chat/"]';

// Scrollable chat content container.
export const AUTOSCROLL_CONTAINER_SELECTOR = '[data-autoscroll-container="true"]';
// Wrapper attribute marking each rendered message block.
export const MESSAGE_RENDER_WRAPPER_SELECTOR = '[data-test-render-count]';
// User message block.
export const USER_MESSAGE_SELECTOR = '[data-testid="user-message"]';
// Assistant message block.
export const ASSISTANT_MESSAGE_SELECTOR = 'div.font-claude-response';
// Assistant action-bar copy button used for clipboard-based export.
export const ASSISTANT_COPY_BUTTON_SELECTOR = 'button[data-testid="action-bar-copy"]';
// Toolbar action area where export button is injected.
export const TOOLBAR_ACTIONS_SELECTOR = '[data-testid="wiggle-controls-actions"]';
// Code element inside pre blocks when extracting markdown.
export const CODE_BLOCK_CONTENT_SELECTOR = 'code';
