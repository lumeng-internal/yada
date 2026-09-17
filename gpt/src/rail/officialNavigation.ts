/* Copyright (c) 2025 BenkoZhao. Adapted from AI-MarkDone ChatGPTOfficialNavigation.ts.
 * MIT; see THIRD_PARTY_NOTICES.md. */
export const CHATGPT_OFFICIAL_NAV_ROOT_SELECTOR = [
    `main [class$="_convSearchResultHighlightRoot"]`,
    `main [class*="_convSearchResultHighlightRoot "]`,
].join(',');

export const CHATGPT_OFFICIAL_NAV_FIXED_CHILD_SELECTOR = [
    'fixed',
    'inset-e-4',
    'top-1/2',
    'z-20',
    '-translate-y-1/2',
];

export const CHATGPT_OFFICIAL_NAV_FIXED_CHILD_CSS_SELECTOR = CHATGPT_OFFICIAL_NAV_FIXED_CHILD_SELECTOR
    .map((token) => `[class~="${token}"]`)
    .join('');

export type ChatGPTOfficialNavigationSnapshot = Readonly<{
    ready: boolean;
    expectedTurnCount: number;
}>;

function isOfficialFixedChild(element: Element): element is HTMLElement {
    return element instanceof HTMLElement
        && CHATGPT_OFFICIAL_NAV_FIXED_CHILD_SELECTOR.every((token) => element.classList.contains(token))
        && !element.closest('[data-aimd-role], [data-yada-root]') && visible(element);
}

/** Read the host-owned full-conversation navigation skeleton without labels. */
export function readChatGPTOfficialNavigation(): ChatGPTOfficialNavigationSnapshot {
    const roots = Array.from(document.querySelectorAll<HTMLElement>(CHATGPT_OFFICIAL_NAV_ROOT_SELECTOR));
    for (const root of roots) {
        const fixedChild = Array.from(root.children).find(isOfficialFixedChild);
        if (!fixedChild) continue;
        const expectedTurnCount = [...fixedChild.querySelectorAll<HTMLButtonElement>('button')].filter(visible).length;
        if (expectedTurnCount > 0) {
            return Object.freeze({ ready: true, expectedTurnCount });
        }
    }
    // Geometry fallback when application CSS module names change. Require a narrow,
    // fixed, right-side vertical sequence of multiple tiny navigation buttons.
    for (const candidate of document.querySelectorAll<HTMLElement>('main nav, main [role="navigation"], main [class~="fixed"], main [style*="fixed"], main div:has(> button), main div:has(> div > button)')) {
        if (candidate.closest('[data-yada-root], [data-aimd-role], header, aside') || !visible(candidate)) continue;
        const style = getComputedStyle(candidate), rect = candidate.getBoundingClientRect();
        if (style.position !== 'fixed' || rect.width > 96 || rect.width < 4 || rect.height < 36
            || rect.left < innerWidth * .7 || rect.right > innerWidth + 2
            || Math.abs((rect.top + rect.bottom) / 2 - innerHeight / 2) > innerHeight * .3) continue;
        const buttons = [...candidate.querySelectorAll<HTMLButtonElement>('button')].filter(visible);
        if (buttons.length < 3) continue;
        const boxes = buttons.map(button => button.getBoundingClientRect());
        if (boxes.every((box, i) => box.width <= 80 && box.height <= 40 && (i === 0
            || box.top >= boxes[i - 1].bottom - 2 && Math.abs(box.right - boxes[0].right) < 16))) {
            return Object.freeze({ ready: true, expectedTurnCount: buttons.length });
        }
    }
    return Object.freeze({ ready: false, expectedTurnCount: 0 });
}

function visible(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    if (!element.isConnected || rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= innerHeight
        || rect.right <= 0 || rect.left >= innerWidth) return false;
    let current: HTMLElement | null = element;
    while (current) {
        const style = getComputedStyle(current);
        if (current.hidden || current.getAttribute('aria-hidden') === 'true' || style.display === 'none'
            || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
        current = current.parentElement;
    }
    return true;
}
