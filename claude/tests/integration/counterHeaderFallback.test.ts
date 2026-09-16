import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

type FakeNode = {
  name: string;
  nodeType: number;
  parentElement: FakeNode | null;
  children: FakeNode[];
  nextElementSibling: FakeNode | null;
  previousElementSibling: FakeNode | null;
  dataset: Record<string, string>;
  style: Record<string, unknown> & { setProperty: ReturnType<typeof vi.fn> };
  classList: { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>; toggle: ReturnType<typeof vi.fn> };
  textContent: string;
  appendChild(node: FakeNode): FakeNode;
  prepend(node: FakeNode): void;
  replaceChildren(...nodes: FakeNode[]): void;
  before(node: FakeNode): void;
  after(node: FakeNode): void;
  querySelectorAll(): FakeNode[];
  closest(): FakeNode | null;
};

const syncSiblings = (parent: FakeNode) => {
  parent.children.forEach((child, index) => {
    child.parentElement = parent;
    child.previousElementSibling = parent.children[index - 1] ?? null;
    child.nextElementSibling = parent.children[index + 1] ?? null;
  });
};

const detach = (node: FakeNode) => {
  const parent = node.parentElement;
  if (!parent) return;
  parent.children = parent.children.filter((child) => child !== node);
  node.parentElement = null;
  node.previousElementSibling = null;
  node.nextElementSibling = null;
  syncSiblings(parent);
};

const makeNode = (name: string): FakeNode => {
  const node: FakeNode = {
    name,
    nodeType: 1,
    parentElement: null,
    children: [],
    nextElementSibling: null,
    previousElementSibling: null,
    dataset: {},
    style: { setProperty: vi.fn() },
    classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() },
    textContent: '',
    appendChild(child) {
      detach(child);
      this.children.push(child);
      syncSiblings(this);
      return child;
    },
    prepend(child) {
      detach(child);
      this.children.unshift(child);
      syncSiblings(this);
    },
    replaceChildren(...children) {
      for (const child of [...this.children]) detach(child);
      for (const child of children) this.appendChild(child);
    },
    before(child) {
      const parent = this.parentElement;
      if (!parent) return;
      detach(child);
      parent.children.splice(parent.children.indexOf(this), 0, child);
      syncSiblings(parent);
    },
    after(child) {
      const parent = this.parentElement;
      if (!parent) return;
      detach(child);
      parent.children.splice(parent.children.indexOf(this) + 1, 0, child);
      syncSiblings(parent);
    },
    querySelectorAll: () => [],
    closest: () => null,
  };
  return node;
};

const append = (parent: FakeNode, ...children: FakeNode[]) => {
  for (const child of children) parent.appendChild(child);
};

let source = '';

beforeAll(async () => {
  source = await readFile(
    new URL('../../src/pages/content/counter/content/ui.js', import.meta.url),
    'utf8',
  );
});

const createHarness = () => {
  const body = makeNode('body');
  const composer = makeNode('composer');
  const usageLine = makeNode('usage');
  const headerContainer = makeNode('counter');
  const headerDisplay = makeNode('display');
  const lengthGroup = makeNode('length-group');
  const lengthDisplay = makeNode('length-value');
  const compactLengthDisplay = makeNode('length-value-compact');
  const cachedDisplay = makeNode('cache');
  lengthDisplay.textContent = '≈ 4,881 tokens';
  append(body, composer);
  append(composer, usageLine);

  let copyRoot: FakeNode | null = null;
  const observerCallbacks: Array<() => void> = [];
  const documentStub = {
    body,
    documentElement: { dataset: {} },
    contains: (node: FakeNode | null) => {
      let current = node;
      while (current) {
        if (current === body) return true;
        current = current.parentElement;
      }
      return false;
    },
    querySelector: (selector: string) => {
      if (selector === '#claude-yada-copy-button-root') return copyRoot;
      return null;
    },
  };
  const context = {
    globalThis: null as unknown,
    document: documentStub,
    window: { innerWidth: 1200 },
    Promise,
    MutationObserver: class {
      callback: () => void;
      constructor(callback: () => void) {
        this.callback = callback;
        observerCallbacks.push(callback);
      }
      observe() {}
      disconnect() {}
    },
    ClaudeCounter: {
      DOM: {
        COPY_BUTTON_ROOT: '#claude-yada-copy-button-root',
        MODEL_SELECTOR_DROPDOWN: '[data-testid="model-selector-dropdown"]',
      },
      COLORS: {
        PROGRESS_OUTLINE_DARK: '#000',
        PROGRESS_OUTLINE_LIGHT: '#000',
        PROGRESS_FILL_DARK: '#000',
        PROGRESS_FILL_LIGHT: '#000',
        PROGRESS_MARKER_DARK: '#000',
        PROGRESS_MARKER_LIGHT: '#000',
        RED_WARNING: '#000',
        BOLD_DARK: '#000',
        BOLD_LIGHT: '#000',
      },
    },
  };
  context.globalThis = context;
  vm.runInNewContext(source, context);

  const CounterUI = (context.ClaudeCounter as unknown as {
    ui: { CounterUI: new () => Record<string, unknown> };
  }).ui.CounterUI;
  const ui = new CounterUI() as Record<string, any>;
  Object.assign(ui, {
    headerContainer,
    headerDisplay,
    lengthGroup,
    lengthDisplay,
    compactLengthDisplay,
    cachedDisplay,
    usageLine,
    lengthBar: null,
    lengthTooltip: { textContent: '' },
    lastTotalTokens: 4881,
  });

  return {
    body,
    composer,
    usageLine,
    headerContainer,
    lengthDisplay,
    ui,
    observerCallbacks,
    setHeader(toolbar: FakeNode | null) {
      copyRoot = toolbar ? makeNode('copy-root') : null;
      if (toolbar && copyRoot) append(toolbar, copyRoot);
      return copyRoot;
    },
  };
};

describe('counter header relocation', () => {
  it('mounts immediately before the existing Copy host when the header action host exists', () => {
    const h = createHarness();
    const toolbar = makeNode('toolbar');
    const shareButton = makeNode('share');
    append(h.body, toolbar);
    append(toolbar, shareButton);
    const copyRoot = h.setHeader(toolbar);

    h.ui.attachHeader();

    expect(toolbar.children).toEqual([h.headerContainer, shareButton, copyRoot]);
    expect(h.headerContainer.dataset.counterMount).toBe('header');
  });

  it('falls back to the composer when the header action host is absent', () => {
    const h = createHarness();

    h.ui.attachHeader();

    expect(h.composer.children).toEqual([h.headerContainer, h.usageLine]);
    expect(h.headerContainer.dataset.counterMount).toBe('composer');
  });

  it('moves the same element from composer to header when the Copy host appears later', async () => {
    const h = createHarness();
    h.ui.attachHeader();
    h.ui._observeDom();
    const toolbar = makeNode('toolbar');
    append(h.body, toolbar);
    const copyRoot = h.setHeader(toolbar);

    h.observerCallbacks.at(-1)?.();
    await Promise.resolve();

    expect(toolbar.children).toEqual([h.headerContainer, copyRoot]);
    expect(h.composer.children).toEqual([h.usageLine]);
  });

  it('reattaches automatically when Claude recreates the header host', async () => {
    const h = createHarness();
    const firstToolbar = makeNode('toolbar-one');
    append(h.body, firstToolbar);
    h.setHeader(firstToolbar);
    h.ui.attachHeader();
    h.ui._observeDom();
    detach(firstToolbar);
    const nextToolbar = makeNode('toolbar-two');
    append(h.body, nextToolbar);
    const nextCopyRoot = h.setHeader(nextToolbar);

    h.observerCallbacks.at(-1)?.();
    await Promise.resolve();

    expect(nextToolbar.children).toEqual([h.headerContainer, nextCopyRoot]);
  });

  it('does not create or retain duplicate counters after repeated attachment', () => {
    const h = createHarness();
    const toolbar = makeNode('toolbar');
    append(h.body, toolbar);
    h.setHeader(toolbar);

    for (let index = 0; index < 10; index += 1) h.ui.attachHeader();

    expect(toolbar.children.filter((node) => node === h.headerContainer)).toHaveLength(1);
    expect(h.composer.children).toEqual([h.usageLine]);
  });

  it('keeps one counter through repeated route-style host replacements', () => {
    const h = createHarness();
    for (let index = 0; index < 10; index += 1) {
      const toolbar = makeNode(`toolbar-${index}`);
      append(h.body, toolbar);
      h.setHeader(toolbar);
      h.ui.attachHeader();
    }

    const mountedCounters = h.body.children
      .flatMap((node) => node.children)
      .filter((node) => node === h.headerContainer);
    expect(mountedCounters).toHaveLength(1);
  });

  it('leaves the 5-hour and weekly usage row in the composer', () => {
    const h = createHarness();
    const toolbar = makeNode('toolbar');
    append(h.body, toolbar);
    h.setHeader(toolbar);

    h.ui.attachHeader();

    expect(h.usageLine.parentElement).toBe(h.composer);
    expect(h.headerContainer.parentElement).toBe(toolbar);
  });

  it('preserves unavailable and stale presentation while moving the host', () => {
    const h = createHarness();
    const toolbar = makeNode('toolbar');
    append(h.body, toolbar);
    h.setHeader(toolbar);
    h.ui.setConversationUnavailable({ stale: true });

    h.ui.attachHeader();

    expect(h.headerContainer.dataset.counterState).toBe('stale');
    expect(h.lengthDisplay.textContent).toBe('≈ 4,881 tokens · stale');
    expect(h.headerContainer.parentElement).toBe(toolbar);
  });

  it('uses flex-safe responsive header styling without absolute positioning', async () => {
    const css = await readFile(
      new URL('../../src/pages/content/counter/styles.css', import.meta.url),
      'utf8',
    );

    expect(css).toContain('.cc-header[data-counter-mount="header"]');
    expect(css).toMatch(/max-width:\s*190px/);
    expect(css).toMatch(/flex:\s*0\s+1/);
    expect(css).toMatch(/@media\s*\(max-width:/);
    expect(css).toContain('@media (max-width: 1050px)');
    expect(css).toContain('.claude-yada-header-counter-value--compact');
    expect(source).toContain('formatCompactTokenCount');
    expect(css).not.toMatch(/\.cc-header[^}]*position:\s*(?:absolute|fixed)/s);
  });

  it('keeps attachment independent from token requests and metric computation', () => {
    const attachHeader = source.match(/\n\t\tattachHeader\(\) \{[\s\S]*?\n\t\t\}\n\n\t\tattachUsageLine/)?.[0] ?? '';

    expect(attachHeader).not.toContain('requestConversation');
    expect(attachHeader).not.toContain('computeConversationMetrics');
    expect(attachHeader).not.toContain('bridge.');
  });
});
