import { getConversationMessageCandidates, type ExportMessageCandidate } from './exportExtractors';

export type ConversationTurn = {
  id: string;
  order: number;
  userCandidate: ExportMessageCandidate;
  assistantCandidate?: ExportMessageCandidate;
  candidates: ExportMessageCandidate[];
  userPreviewText: string;
  assistantPreviewText: string;
  scrollTargetElement: HTMLElement;
  position: number;
};

const TURN_ID_ATTR = 'data-claude-yada-turn-id';
const USER_MESSAGE_SELECTOR = '[data-testid="user-message"]';
const FILE_THUMBNAIL_SELECTOR = '[data-testid="file-thumbnail"]';
const PREVIEW_LIMIT = 720;
const TEXT_WITH_ATTACHMENT_LIMIT = 160;
const NO_TEXT_USER_PREVIEW = '[无文字消息]';
const FILE_NAME_PATTERN = /[^\s"'<>()[\]{}]+\.([a-z0-9]{1,8})(?=$|[\s"'<>()[\]{},，。；;:：!?！？])/gi;
const NON_ATTACHMENT_IMAGE_PATTERN = /avatar|profile|logo|icon|emoji|用户头像|頭像|头像/i;
const ATTACHMENT_UI_TEXT_PATTERN = /^(image|file|attachment|uploaded|pasted|preview|download|open|pdf|csv|png|jpg|jpeg|webp|gif|heic|heif|txt|docx|xlsx|md|markdown|图片|圖片|截图|截圖|文件|附件|\d+\s*(images?|files?|张|張|个|個))$/i;
const IMAGE_FILE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'heic', 'heif'] as const;
const USER_TURN_WRAPPER_CLASS_TOKENS = ['mb-1', 'mt-6', 'group'] as const;
const ATTACHMENT_STRIP_CLASS_TOKENS = ['gap-2', 'mx-0.5', 'mb-3', 'flex', 'flex-wrap', 'justify-end'] as const;
const MIRROR_GRID_CLASS_PREFIX = 'grid-cols-[repeat(auto-fill';

type AttachmentSummaryEntry =
  | { kind: 'image'; key: string }
  | { kind: 'pasted'; key: string }
  | { kind: 'file'; fileName: string }
  | { kind: 'genericFile'; label?: string }
  | { kind: 'genericAttachment' };

type AttachmentSummary = {
  entries: AttachmentSummaryEntry[];
  fileNames: string[];
};

const normalizeText = (text: string): string => text.replace(/\s+/g, ' ').trim();

const truncateChars = (text: string, limit: number): string => {
  const chars = Array.from(text);
  if (chars.length <= limit) return chars.join('');
  return `${chars.slice(0, limit).join('')}…`;
};

const normalizePreview = (text: string): string => {
  const normalized = text
    .split(/\n+/)
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .join('\n');
  return truncateChars(normalized, PREVIEW_LIMIT);
};

const truncateText = (text: string, limit: number): string => {
  const chars = Array.from(normalizeText(text));
  if (chars.length <= limit) return chars.join('');
  return `${chars.slice(0, limit).join('')}…`;
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getElementDescriptor = (element: Element): string => {
  const values = [
    element.tagName,
    element.className,
    element.getAttribute('data-testid'),
    element.getAttribute('data-test-id'),
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.getAttribute('alt'),
    element.getAttribute('role'),
  ];
  return values
    .map((value) => (typeof value === 'string' ? value : ''))
    .join(' ')
    .toLowerCase();
};

const hasClassTokens = (element: Element, tokens: readonly string[]): boolean => {
  if (!(element instanceof HTMLElement)) return false;
  return tokens.every((token) => element.classList.contains(token));
};

const getElementTop = (element: Element): number => {
  const rect = element.getBoundingClientRect();
  return rect.top + window.scrollY;
};

const isVisibleBox = (element: Element, minWidth = 1, minHeight = 1): boolean => {
  if (!(element instanceof HTMLElement)) return false;
  const rect = element.getBoundingClientRect();
  return rect.width >= minWidth && rect.height >= minHeight;
};

const isHorizontallyInViewport = (element: Element): boolean => {
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  if (!viewportWidth) return true;

  const rect = element.getBoundingClientRect();
  return rect.right >= -1 && rect.left <= viewportWidth + 1;
};

const hasZeroSizedAncestorBeforeRoot = (element: Element, root: HTMLElement): boolean => {
  let current = element.parentElement;
  while (current && current !== root) {
    const rect = current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return true;
    current = current.parentElement;
  }
  return false;
};

const isInsideMirrorAttachmentGrid = (element: Element, root: HTMLElement): boolean => {
  let current = element.parentElement;
  while (current && current !== root) {
    if (
      current.classList.contains('grid') &&
      current.classList.contains('gap-3') &&
      Array.from(current.classList).some((className) => className.startsWith(MIRROR_GRID_CLASS_PREFIX))
    ) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
};

const isRenderableAttachmentNode = (element: Element, root: HTMLElement): boolean => {
  if (!(element instanceof HTMLElement)) return false;
  if (!root.contains(element)) return false;
  if (!isVisibleBox(element)) return false;
  if (!isHorizontallyInViewport(element)) return false;
  if (hasZeroSizedAncestorBeforeRoot(element, root)) return false;
  if (isInsideMirrorAttachmentGrid(element, root)) return false;
  return true;
};

const normalizeFileName = (name: string): string => {
  const trimmed = name.replace(/^["'([{<]+|[>"'\])}.,，。；;:：!?！？]+$/g, '').trim();
  if (!trimmed || trimmed.length > 120) return '';
  return trimmed;
};

const collectFileNamesFromText = (text: string, fileNames: Set<string>) => {
  if (!text || text.length > 500) return;

  for (const match of text.matchAll(FILE_NAME_PATTERN)) {
    const fileName = normalizeFileName(match[0]);
    if (fileName) fileNames.add(fileName);
  }
};

const safeDecodeURIComponent = (text: string): string => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

const getFileNameFromHref = (href: string): string => {
  if (!href || href.startsWith('data:') || href.startsWith('blob:')) return '';

  try {
    const url = new URL(href, window.location.href);
    const segment = url.pathname.split('/').filter(Boolean).pop() ?? '';
    return normalizeFileName(safeDecodeURIComponent(segment));
  } catch {
    const segment = href.split(/[/?#]/).filter(Boolean).pop() ?? '';
    return normalizeFileName(safeDecodeURIComponent(segment));
  }
};

const isLikelyContentImage = (image: HTMLImageElement): boolean => {
  const descriptor = getElementDescriptor(image);
  if (NON_ATTACHMENT_IMAGE_PATTERN.test(descriptor)) return false;

  const rect = image.getBoundingClientRect();
  const width = rect.width || image.naturalWidth;
  const height = rect.height || image.naturalHeight;
  if (width > 0 && height > 0 && width <= 28 && height <= 28) return false;

  const source = image.currentSrc || image.src || '';
  if (source.startsWith('chrome-extension://') || source.includes('/favicon')) return false;

  return true;
};

const isInsideAnyElement = (element: Element, containers: Element[]): boolean => {
  return containers.some((container) => container !== element && container.contains(element));
};

const getFileTypeLabel = (fileName: string): string => {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (extension === 'md' || extension === 'markdown') return 'Markdown 文件';
  if (extension === 'csv' || extension === 'tsv') return 'CSV 文件';
  if (extension === 'pdf') return 'PDF 文件';
  if (isImageFileName(fileName)) return '图片文件';
  if (extension === 'txt') return '文本文件';
  if (extension === 'doc' || extension === 'docx') return 'Word 文件';
  if (extension === 'xls' || extension === 'xlsx') return 'Excel 文件';
  if (extension === 'ppt' || extension === 'pptx') return 'PPT 文件';
  if (extension === 'zip') return 'ZIP 文件';
  return '文件';
};

const isImageFileName = (fileName: string): boolean => {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_FILE_EXTENSIONS.includes(extension as (typeof IMAGE_FILE_EXTENSIONS)[number]);
};

const collectFileNamesFromElement = (element: Element, fileNames: Set<string>) => {
  collectFileNamesFromText(element.getAttribute('data-testid') ?? '', fileNames);
  collectFileNamesFromText(element.getAttribute('data-test-id') ?? '', fileNames);
  collectFileNamesFromText(element.getAttribute('aria-label') ?? '', fileNames);
  collectFileNamesFromText(element.getAttribute('title') ?? '', fileNames);
  collectFileNamesFromText(element.getAttribute('alt') ?? '', fileNames);
  collectFileNamesFromText(element.getAttribute('download') ?? '', fileNames);

  if (element instanceof HTMLAnchorElement) {
    collectFileNamesFromText(getFileNameFromHref(element.href), fileNames);
  }

  if (element instanceof HTMLImageElement) {
    collectFileNamesFromText(getFileNameFromHref(element.currentSrc || element.src), fileNames);
  }

  for (const child of Array.from(element.querySelectorAll('[data-testid], [data-test-id], [aria-label], [title], [alt], [download], a[href], img[src]'))) {
    collectFileNamesFromText(child.getAttribute('data-testid') ?? '', fileNames);
    collectFileNamesFromText(child.getAttribute('data-test-id') ?? '', fileNames);
    collectFileNamesFromText(child.getAttribute('aria-label') ?? '', fileNames);
    collectFileNamesFromText(child.getAttribute('title') ?? '', fileNames);
    collectFileNamesFromText(child.getAttribute('alt') ?? '', fileNames);
    collectFileNamesFromText(child.getAttribute('download') ?? '', fileNames);

    if (child instanceof HTMLAnchorElement) {
      collectFileNamesFromText(getFileNameFromHref(child.href), fileNames);
    }

    if (child instanceof HTMLImageElement) {
      collectFileNamesFromText(getFileNameFromHref(child.currentSrc || child.src), fileNames);
    }
  }

  collectFileNamesFromText(element.textContent ?? '', fileNames);
};

const normalizeDedupeKey = (value: string): string => {
  return safeDecodeURIComponent(value)
    .split(/[?#]/)[0]
    .trim()
    .toLowerCase();
};

const getImageSourceKey = (image: HTMLImageElement): string => {
  const source = image.currentSrc || image.src || '';
  if (!source || source.startsWith('data:') || source.startsWith('blob:')) return '';

  try {
    const url = new URL(source, window.location.href);
    return normalizeDedupeKey(url.pathname);
  } catch {
    return normalizeDedupeKey(source);
  }
};

const getClosestImageCard = (image: HTMLImageElement, root: HTMLElement): Element => {
  let current: Element | null = image;
  while (current && current !== root.parentElement) {
    const testId = current.getAttribute('data-testid') ?? '';
    if (testId && [...testId.matchAll(FILE_NAME_PATTERN)].some((match) => isImageFileName(match[0]))) {
      return current;
    }

    if (current === root) break;
    current = current.parentElement;
  }

  return image;
};

const getThumbnailTextTokens = (thumbnail: Element): string[] => {
  return normalizeText(thumbnail.textContent ?? '')
    .split(/\s+/)
    .map((token) => token.replace(/^["'([{<.]+|[>"'\])}.,，。；;:：!?！？]+$/g, '').toLowerCase())
    .filter(Boolean);
};

const isPastedThumbnail = (thumbnail: Element): boolean => {
  const descriptor = [
    thumbnail.getAttribute('aria-label') ?? '',
    thumbnail.getAttribute('title') ?? '',
    ...Array.from(thumbnail.querySelectorAll('button[aria-label], [title]')).map((element) =>
      `${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('title') ?? ''}`,
    ),
  ].join(' ');

  if (/pasted text/i.test(descriptor)) return true;
  return getThumbnailTextTokens(thumbnail).includes('pasted') || /\bpasted\b/i.test(descriptor);
};

const getThumbnailPrimaryFileName = (thumbnail: Element): string => {
  const headingFileName = normalizeFileName(normalizeText(thumbnail.querySelector('h3')?.textContent ?? ''));
  if (headingFileName) return headingFileName;

  const fileNames = new Set<string>();
  collectFileNamesFromElement(thumbnail, fileNames);
  return [...fileNames][0] ?? '';
};

const getFileLabelFromTypeToken = (token: string): string => {
  const normalized = token.toLowerCase().replace(/^\./, '');
  const extension = normalized === 'markdown' ? 'md' : normalized;
  return getFileTypeLabel(`file.${extension}`);
};

const getThumbnailFileTypeLabel = (thumbnail: Element): string | undefined => {
  const fileTypeToken = getThumbnailTextTokens(thumbnail).find((token) =>
    ['md', 'markdown', 'pdf', 'csv', 'tsv', 'txt', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip'].includes(token),
  );
  return fileTypeToken ? getFileLabelFromTypeToken(fileTypeToken) : undefined;
};

const addUniqueImageEntry = (
  entries: AttachmentSummaryEntry[],
  seenKeys: Set<string>,
  keyCandidates: string[],
): boolean => {
  const key = keyCandidates.map(normalizeDedupeKey).find(Boolean);
  if (!key || seenKeys.has(key)) return false;

  seenKeys.add(key);
  entries.push({ kind: 'image', key });
  return true;
};

const addUniqueEntry = (
  entries: AttachmentSummaryEntry[],
  seenKeys: Set<string>,
  key: string,
  entry: AttachmentSummaryEntry,
): boolean => {
  const normalizedKey = normalizeDedupeKey(key);
  if (!normalizedKey || seenKeys.has(normalizedKey)) return false;

  seenKeys.add(normalizedKey);
  entries.push(entry);
  return true;
};

const extractUserAttachmentSummary = (candidate: ExportMessageCandidate): AttachmentSummary => {
  const root = candidate.wrapper;
  const entries: AttachmentSummaryEntry[] = [];
  const fileNames = new Set<string>();
  const seenAttachmentKeys = new Set<string>();
  const thumbnailElements = Array.from(root.querySelectorAll(FILE_THUMBNAIL_SELECTOR)).filter((thumbnail) =>
    isRenderableAttachmentNode(thumbnail, root),
  );

  for (const thumbnail of thumbnailElements) {
    if (isPastedThumbnail(thumbnail)) {
      addUniqueEntry(entries, seenAttachmentKeys, `pasted:${getElementTop(thumbnail)}`, {
        kind: 'pasted',
        key: `pasted:${getElementTop(thumbnail)}`,
      });
      continue;
    }

    const fileName = getThumbnailPrimaryFileName(thumbnail);
    if (fileName) {
      fileNames.add(fileName);
      if (isImageFileName(fileName)) {
        addUniqueImageEntry(entries, seenAttachmentKeys, [
          thumbnail.getAttribute('data-testid') ?? '',
          fileName,
        ]);
      } else {
        addUniqueEntry(entries, seenAttachmentKeys, `file:${fileName}`, { kind: 'file', fileName });
      }
      continue;
    }

    const label = getThumbnailFileTypeLabel(thumbnail);
    addUniqueEntry(entries, seenAttachmentKeys, `file:${label ?? getElementTop(thumbnail)}`, {
      kind: 'genericFile',
      label,
    });
  }

  const standaloneImages = Array.from(root.querySelectorAll('img'))
    .filter((image) => !isInsideAnyElement(image, thumbnailElements))
    .filter(isLikelyContentImage);

  for (const image of standaloneImages) {
    const imageCard = getClosestImageCard(image, root);
    const renderNode = imageCard instanceof HTMLElement && imageCard !== root ? imageCard : image;
    if (!isRenderableAttachmentNode(renderNode, root)) continue;

    const imageFileNames = new Set<string>();
    collectFileNamesFromElement(imageCard, imageFileNames);
    collectFileNamesFromElement(image, imageFileNames);
    const namedImages = [...imageFileNames].filter(isImageFileName);
    if (namedImages.length === 0) continue;

    const dataTestId = imageCard.getAttribute('data-testid') ?? image.getAttribute('data-testid') ?? '';
    const alt = image.getAttribute('alt') ?? '';
    const sourceKey = getImageSourceKey(image);
    const imageKey = addUniqueImageEntry(entries, seenAttachmentKeys, [
      dataTestId,
      alt,
      sourceKey,
      namedImages[0],
    ]);

    if (imageKey) {
      for (const fileName of namedImages) fileNames.add(fileName);
    }
  }

  return {
    entries,
    fileNames: [...fileNames],
  };
};

const formatAttachmentSummary = (summary: AttachmentSummary): string => {
  const parts = summary.entries.map((entry) => {
    if (entry.kind === 'image') return '[图片]';
    if (entry.kind === 'pasted') return '[粘贴内容]';
    if (entry.kind === 'file') return `[${getFileTypeLabel(entry.fileName)}] ${entry.fileName}`;
    if (entry.kind === 'genericFile') return `[${entry.label ?? '文件'}]`;
    return '[附件]';
  });

  return parts.join(' ');
};

const removeAttachmentFileNamesFromText = (text: string, fileNames: string[]): string => {
  let nextText = text;
  for (const fileName of fileNames) {
    nextText = nextText.replace(new RegExp(escapeRegExp(fileName), 'g'), ' ');
  }
  return normalizeText(nextText);
};

const extractUserTextForPreview = (candidate: ExportMessageCandidate, attachmentSummary: AttachmentSummary): string => {
  const userTextElement = candidate.element.matches(USER_MESSAGE_SELECTOR)
    ? candidate.element
    : candidate.wrapper.querySelector(USER_MESSAGE_SELECTOR);
  const rawText = normalizeText(userTextElement?.textContent ?? '');
  if (!rawText) return '';

  const withoutFileNames = removeAttachmentFileNamesFromText(rawText, attachmentSummary.fileNames);
  if (!withoutFileNames) return '';

  if (attachmentSummary.entries.length > 0 && ATTACHMENT_UI_TEXT_PATTERN.test(withoutFileNames)) return '';

  return withoutFileNames;
};

const buildUserPreviewText = (candidate: ExportMessageCandidate): string => {
  const attachmentSummary = extractUserAttachmentSummary(candidate);
  const attachmentSummaryText = formatAttachmentSummary(attachmentSummary);
  const userText = extractUserTextForPreview(candidate, attachmentSummary);

  if (userText && attachmentSummaryText) {
    return normalizePreview(`${truncateText(userText, TEXT_WITH_ATTACHMENT_LIMIT)} · ${attachmentSummaryText}`);
  }
  if (userText) return normalizePreview(userText);
  if (attachmentSummaryText) return normalizePreview(attachmentSummaryText);
  return NO_TEXT_USER_PREVIEW;
};

const buildAssistantPreviewText = (candidate: ExportMessageCandidate): string => {
  const markdownElement =
    candidate.element.matches('.standard-markdown') ? candidate.element : candidate.element.querySelector('.standard-markdown');
  const responseElement =
    candidate.element.matches('.font-claude-response') ? candidate.element : candidate.element.querySelector('.font-claude-response');
  return normalizePreview((markdownElement ?? responseElement ?? candidate.element).textContent ?? '');
};

const valueHasImageFileName = (value: string): boolean => {
  const fileNames = new Set<string>();
  collectFileNamesFromText(value, fileNames);
  return [...fileNames].some(isImageFileName);
};

const hasAttachmentStrip = (wrapper: HTMLElement): boolean => {
  return Array.from(wrapper.querySelectorAll('*')).some((element) =>
    hasClassTokens(element, ATTACHMENT_STRIP_CLASS_TOKENS) && isRenderableAttachmentNode(element, wrapper),
  );
};

const hasImageDataTestId = (wrapper: HTMLElement): boolean => {
  return Array.from(wrapper.querySelectorAll('[data-testid]')).some((element) => {
    const testId = element.getAttribute('data-testid') ?? '';
    return valueHasImageFileName(testId) && isRenderableAttachmentNode(element, wrapper);
  });
};

const hasFileThumbnail = (wrapper: HTMLElement): boolean => {
  return Array.from(wrapper.querySelectorAll(FILE_THUMBNAIL_SELECTOR)).some((element) =>
    isRenderableAttachmentNode(element, wrapper),
  );
};

const isLikelyUserTurnWrapper = (element: Element | null): element is HTMLElement => {
  if (!(element instanceof HTMLElement)) return false;
  if (!hasClassTokens(element, USER_TURN_WRAPPER_CLASS_TOKENS)) return false;
  if (!isVisibleBox(element, 100, 20)) return false;

  return Boolean(
    element.querySelector(USER_MESSAGE_SELECTOR) ||
      hasAttachmentStrip(element) ||
      hasImageDataTestId(element) ||
      hasFileThumbnail(element),
  );
};

const collectUserTurnWrappers = (root: ParentNode = document): HTMLElement[] => {
  const candidates: HTMLElement[] = [];

  if (root instanceof HTMLElement && hasClassTokens(root, USER_TURN_WRAPPER_CLASS_TOKENS)) {
    candidates.push(root);
  }

  candidates.push(...Array.from(root.querySelectorAll('.mb-1.mt-6.group')).filter((element): element is HTMLElement =>
    element instanceof HTMLElement,
  ));

  const likelyWrappers = [...new Set(candidates)].filter(isLikelyUserTurnWrapper);
  return likelyWrappers.filter((wrapper) => !likelyWrappers.some((other) => other !== wrapper && other.contains(wrapper)));
};

const findClosestUserTurnWrapper = (element: Element): HTMLElement | null => {
  const wrapper = element.closest('.mb-1.mt-6.group');
  return isLikelyUserTurnWrapper(wrapper) ? wrapper : null;
};

const getUserCandidateElement = (wrapper: HTMLElement, fallback?: Element): Element => {
  if (fallback?.matches(USER_MESSAGE_SELECTOR)) return fallback;

  const userMessage = wrapper.querySelector(USER_MESSAGE_SELECTOR);
  if (userMessage) return userMessage;

  return wrapper;
};

const getConversationTurnCandidates = (root?: ParentNode): ExportMessageCandidate[] => {
  const baseCandidates = getConversationMessageCandidates(root);
  const userCandidatesByWrapper = new Map<HTMLElement, ExportMessageCandidate>();
  const candidates: ExportMessageCandidate[] = [];

  for (const candidate of baseCandidates) {
    if (candidate.role !== 'user') {
      candidates.push(candidate);
      continue;
    }

    const wrapper = findClosestUserTurnWrapper(candidate.element) ?? findClosestUserTurnWrapper(candidate.wrapper) ?? candidate.wrapper;
    const userCandidate: ExportMessageCandidate = {
      ...candidate,
      element: getUserCandidateElement(wrapper, candidate.element),
      wrapper,
      position: getElementTop(wrapper),
    };
    userCandidatesByWrapper.set(wrapper, userCandidate);
  }

  collectUserTurnWrappers(root).forEach((wrapper, index) => {
    if (userCandidatesByWrapper.has(wrapper)) return;

    userCandidatesByWrapper.set(wrapper, {
      id: `user-wrapper-${index}`,
      role: 'user',
      element: getUserCandidateElement(wrapper),
      wrapper,
      position: getElementTop(wrapper),
    });
  });

  return [...candidates, ...userCandidatesByWrapper.values()]
    .sort((a, b) => a.position - b.position)
    .map((candidate, index) =>
      candidate.id.startsWith('user-wrapper-') ? { ...candidate, id: `user-wrapper-${index}` } : candidate,
    );
};

const getExistingTurnId = (candidate: ExportMessageCandidate): string | null => {
  const id = candidate.wrapper.getAttribute(TURN_ID_ATTR);
  return id || null;
};

const setTurnId = (candidate: ExportMessageCandidate, id: string) => {
  candidate.wrapper.setAttribute(TURN_ID_ATTR, id);
};

const buildTurnId = (candidate: ExportMessageCandidate, order: number): string => {
  const existing = getExistingTurnId(candidate);
  if (existing) return existing;

  const renderCount = candidate.wrapper.getAttribute('data-test-render-count') || '';
  const id = renderCount ? `turn-${renderCount}-${order}` : `turn-${order}-${candidate.id}`;
  setTurnId(candidate, id);
  return id;
};

const createTurn = (userCandidate: ExportMessageCandidate, order: number): ConversationTurn => {
  const id = buildTurnId(userCandidate, order);
  return {
    id,
    order,
    userCandidate,
    candidates: [userCandidate],
    userPreviewText: buildUserPreviewText(userCandidate),
    assistantPreviewText: '',
    scrollTargetElement: userCandidate.wrapper,
    position: userCandidate.position,
  };
};

const attachAssistant = (turn: ConversationTurn, assistantCandidate: ExportMessageCandidate) => {
  if (turn.assistantCandidate) return;

  setTurnId(assistantCandidate, turn.id);
  turn.assistantCandidate = assistantCandidate;
  turn.candidates = [turn.userCandidate, assistantCandidate];
  turn.assistantPreviewText = buildAssistantPreviewText(assistantCandidate);
};

export const getConversationTurns = (root?: ParentNode): ConversationTurn[] => {
  const candidates = getConversationTurnCandidates(root);
  const turns: ConversationTurn[] = [];
  let currentTurn: ConversationTurn | null = null;

  for (const candidate of candidates) {
    if (candidate.role === 'user') {
      if (currentTurn) turns.push(currentTurn);
      currentTurn = createTurn(candidate, turns.length);
      continue;
    }

    if (currentTurn && !currentTurn.assistantCandidate) {
      attachAssistant(currentTurn, candidate);
    }
  }

  if (currentTurn) turns.push(currentTurn);
  return turns.map((turn, order) => ({ ...turn, order }));
};

export const getCandidatesFromTurns = (turns: ConversationTurn[]): ExportMessageCandidate[] => {
  return turns.flatMap((turn) => turn.candidates).sort((a, b) => a.position - b.position);
};
