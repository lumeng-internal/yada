import { combineTextAndAttachments, extractDomAttachments, noTextPlaceholder } from "./attachmentSummary";
import {
  countComposerElements,
  filterComposerDraftTurns,
  isComposerDraftTurn,
  isInsideComposer
} from "./composerGuard";
import type { YadaConversationAudit, YadaDomAnchorScanDebug, YadaRenderedAnchorDebug, YadaTurn } from "./types";

const ROLE_SELECTOR = '[data-message-author-role="user"], [data-message-author-role="assistant"]';
const USER_ROLE_SELECTOR = '[data-message-author-role="user"]';
const ASSISTANT_ROLE_SELECTOR = '[data-message-author-role="assistant"]';
const TURN_ROOT_SELECTOR = [
  '[data-testid^="conversation-turn-"]',
  '[data-testid*="conversation-turn" i]',
  "[data-turn-id-container]",
  "[data-turn-id]",
  "article[data-turn]",
  "section[data-turn]",
  "[data-turn]"
].join(", ");
const MESSAGE_ID_SELECTOR = "[data-message-id]";
export type RenderedTurnAnchor = {
  indexHint: number | null;
  turnId: string | null;
  messageId: string | null;
  userMessageId: string | null;
  assistantMessageId: string | null;
  userTextFingerprint: string;
  assistantTextFingerprint: string;
  jumpAnchor: HTMLElement;
  userAnchor: HTMLElement | null;
  assistantRoot: HTMLElement | null;
  groupEls: HTMLElement[];
  top: number;
  bottom: number;
  source: string;
};

type DomMessage = {
  role: "user" | "assistant";
  messageId?: string;
  markdown: string;
  preview: string;
  attachments: YadaTurn["attachments"];
  anchorElement: HTMLElement;
  turnRoot: HTMLElement;
};

type AnchorScanResult = {
  anchors: RenderedTurnAnchor[];
  debug: YadaDomAnchorScanDebug;
};

type ScanStats = {
  selectorStats: Record<string, number>;
  rejectedReasons: string[];
  rawDomCandidateCount: number;
  skippedComposerCandidateCount: number;
};

let lastAnchorScanDebug: YadaDomAnchorScanDebug = emptyAnchorScanDebug();
let lastConversationAudit: YadaConversationAudit = emptyConversationAudit();

export function collectDomConversationTurns(): YadaTurn[] {
  try {
    const { anchors, debug } = collectRenderedChatGptTurnAnchorsWithDebug();
    lastAnchorScanDebug = debug;
    const turns = filterComposerDraftTurns(anchors.map((anchor, index) => makeDomTurnFromAnchor(anchor, index)));
    lastConversationAudit = makeConversationAudit(turns, debug);
    return turns;
  } catch (error) {
    lastAnchorScanDebug = makeAnchorScanErrorDebug("collect-dom-turns", error);
    lastConversationAudit = makeConversationAudit([], lastAnchorScanDebug);
    logDomCollectorError("collect-dom-turns", error);
    return [];
  }
}

export function collectRenderedChatGptTurnAnchors(): RenderedTurnAnchor[] {
  try {
    const { anchors, debug } = collectRenderedChatGptTurnAnchorsWithDebug();
    lastAnchorScanDebug = debug;
    lastConversationAudit = makeConversationAudit([], debug);
    return anchors;
  } catch (error) {
    lastAnchorScanDebug = makeAnchorScanErrorDebug("collect-rendered-anchors", error);
    lastConversationAudit = makeConversationAudit([], lastAnchorScanDebug);
    logDomCollectorError("collect-rendered-anchors", error);
    return [];
  }
}

export function getLastDomAnchorScanDebug(): YadaDomAnchorScanDebug {
  return lastAnchorScanDebug;
}

export function getLastConversationAudit(turns: readonly YadaTurn[] = []): YadaConversationAudit {
  if (turns.length === 0) return {
    ...lastConversationAudit,
    composerElementCount: countComposerElements()
  };
  return makeConversationAudit(turns, lastAnchorScanDebug);
}

export function bindDomAnchorsToTurns(turns: readonly YadaTurn[], domTurns = collectDomConversationTurns()): YadaTurn[] {
  if (turns.length === 0) return [];

  const debug = { ...lastAnchorScanDebug };
  let bindByMessageIdCount = 0;
  let bindByTurnDomIdCount = 0;
  let bindByFingerprintCount = 0;
  let bindByFullIndexCount = 0;
  let bindByEstimatedIndexCount = 0;

  const anchorsByMessageId = new Map<string, YadaTurn>();
  const anchorsByTurnDomId = new Map<string, YadaTurn>();
  const userAnchorsByFingerprint = buildUniqueFingerprintMap(domTurns, "user");
  const assistantAnchorsByFingerprint = buildUniqueFingerprintMap(domTurns, "assistant");

  for (const turn of domTurns) {
    if (turn.userMessageId) anchorsByMessageId.set(turn.userMessageId, turn);
    if (turn.assistantMessageId) anchorsByMessageId.set(turn.assistantMessageId, turn);
    if (turn.turnDomId) anchorsByTurnDomId.set(turn.turnDomId, turn);
    if (turn.id) anchorsByTurnDomId.set(turn.id, turn);
  }

  const canUseIndexFallback = domTurns.length === turns.length;
  const bound = turns.map((turn, index) => {
    const globalIndex = index;
    const displayNumber = globalIndex + 1;
    const userFingerprint = turn.userTextFingerprint ?? createTextFingerprint(turn.userMarkdown || turn.userPreview);
    const assistantFingerprint = turn.assistantTextFingerprint ?? createTextFingerprint(turn.assistantMarkdown || turn.assistantPreview);
    const existingAnchor = isTrustedAnchorBinding(turn) && isUsableAnchor(turn.anchorElement) ? turn : null;
    let source = existingAnchor ? (turn.anchorMappingReason ?? "existing") : "";
    let match: YadaTurn | null = existingAnchor;

    if (!match && turn.userMessageId && anchorsByMessageId.has(turn.userMessageId)) {
      match = anchorsByMessageId.get(turn.userMessageId) ?? null;
      source = "message-id:user";
      bindByMessageIdCount += 1;
    }
    if (!match && turn.assistantMessageId && anchorsByMessageId.has(turn.assistantMessageId)) {
      match = anchorsByMessageId.get(turn.assistantMessageId) ?? null;
      source = "message-id:assistant";
      bindByMessageIdCount += 1;
    }
    if (!match && turn.turnDomId && anchorsByTurnDomId.has(turn.turnDomId)) {
      match = anchorsByTurnDomId.get(turn.turnDomId) ?? null;
      source = "turn-dom-id";
      bindByTurnDomIdCount += 1;
    }

    if (!match && userFingerprint && userAnchorsByFingerprint.has(userFingerprint)) {
      match = userAnchorsByFingerprint.get(userFingerprint) ?? null;
      source = "fingerprint:user";
      bindByFingerprintCount += 1;
    }
    if (!match && assistantFingerprint && assistantAnchorsByFingerprint.has(assistantFingerprint)) {
      match = assistantAnchorsByFingerprint.get(assistantFingerprint) ?? null;
      source = "fingerprint:assistant";
      bindByFingerprintCount += 1;
    }

    if (!match && canUseIndexFallback) {
      match = domTurns[index] ?? null;
      source = "full-dom-index";
      bindByFullIndexCount += match ? 1 : 0;
    }

    if (match && isComposerDraftTurn(match)) {
      source = "composer";
      match = null;
    }

    if (!match?.anchorElement || !isUsableAnchor(match.anchorElement)) {
      return {
        ...turn,
        index: globalIndex,
        globalIndex,
        displayNumber,
        renderedLocalIndex: null,
        anchorElement: undefined,
        userAnchorElement: null,
        assistantAnchorElement: null,
        groupElements: undefined,
        userTextFingerprint: userFingerprint,
        assistantTextFingerprint: assistantFingerprint,
        anchorMappingReason: "unmapped",
        anchorMappingTrusted: false
      };
    }

    return {
      ...turn,
      index: globalIndex,
      globalIndex,
      displayNumber,
      renderedLocalIndex: match.renderedLocalIndex ?? null,
      anchorElement: match.anchorElement,
      userAnchorElement: match.userAnchorElement ?? match.anchorElement,
      assistantAnchorElement: match.assistantAnchorElement ?? null,
      groupElements: match.groupElements?.filter(isUsableAnchor),
      turnDomId: match.turnDomId ?? turn.turnDomId ?? null,
      userTextFingerprint: userFingerprint,
      assistantTextFingerprint: assistantFingerprint,
      anchorSource: match.anchorSource ?? source,
      anchorMappingReason: source,
      anchorMappingTrusted: source !== "unmapped" && !source.startsWith("estimated")
    };
  });

  const filteredBound = filterComposerDraftTurns(bound);
  const visibleAnchors = filteredBound
    .filter((turn) => isUsableAnchor(turn.anchorElement))
    .map((turn) => makeRenderedAnchorDebug(turn));

  lastAnchorScanDebug = {
    ...debug,
    fullTurnsLength: filteredBound.length,
    visibleIndexes: visibleAnchors
      .filter((anchor) => anchor.mappingTrusted && anchor.globalIndex !== null)
      .map((anchor) => anchor.globalIndex as number),
    visibleRenderedAnchors: visibleAnchors,
    bindByMessageIdCount,
    bindByFingerprintCount,
    bindByTurnDomIdCount,
    bindByFullIndexCount,
    bindByEstimatedIndexCount
  };
  lastConversationAudit = makeConversationAudit(filteredBound, lastAnchorScanDebug);

  return filteredBound;
}

export function createTextFingerprint(value: string): string {
  return normalizeInlineText(value)
    .replace(/[#*_>`~\[\]().,:;!?，。！？：；、]/g, "")
    .slice(0, 180)
    .toLowerCase();
}

function collectRenderedChatGptTurnAnchorsWithDebug(): AnchorScanResult {
  const stats: ScanStats = { selectorStats: {}, rejectedReasons: [], rawDomCandidateCount: 0, skippedComposerCandidateCount: 0 };
  const anchors: RenderedTurnAnchor[] = [];
  const seen = new Set<HTMLElement>();
  const root = getConversationRoot();

  collectAnchorsFromRoleNodes(root, stats).forEach((anchor) => pushAnchor(anchors, seen, anchor, stats));
  if (anchors.length === 0) {
    collectAnchorsFromWrappers(root, stats).forEach((anchor) => pushAnchor(anchors, seen, anchor, stats));
  }

  anchors.sort((a, b) => a.top - b.top);
  anchors.forEach((anchor, index) => {
    anchor.indexHint = anchor.indexHint ?? index;
  });

  const debug: YadaDomAnchorScanDebug = {
    candidateCount: stats.selectorStats.candidates ?? 0,
    acceptedCount: anchors.length,
    rejectedCount: stats.rejectedReasons.length,
    fullTurnsLength: 0,
    selectorStats: {
      ...stats.selectorStats,
      rawDomCandidateCount: stats.rawDomCandidateCount,
      skippedComposerCandidateCount: stats.skippedComposerCandidateCount,
      composerElementCount: countComposerElements(root)
    },
    firstAccepted: anchors[0] ? summarizeAnchor(anchors[0]) : null,
    firstRejectedReasons: stats.rejectedReasons.slice(0, 8),
    visibleIndexes: anchors.map((anchor, index) => anchor.indexHint ?? index),
    visibleRenderedAnchors: anchors.map((anchor, index) => makeRenderedAnchorDebugFromAnchor(anchor, index)),
    bindByMessageIdCount: 0,
    bindByFingerprintCount: 0,
    bindByTurnDomIdCount: 0,
    bindByFullIndexCount: 0,
    bindByEstimatedIndexCount: 0
  };
  lastConversationAudit = makeConversationAudit([], debug);

  return { anchors, debug };
}

function collectAnchorsFromRoleNodes(root: HTMLElement, stats: ScanStats): RenderedTurnAnchor[] {
  const nodes = rejectComposerCandidates(queryAllSafe(root, ROLE_SELECTOR, "role-nodes", stats), "role-node", stats)
    .filter(isUsableElement);
  const anchors: RenderedTurnAnchor[] = [];
  let pendingUser: DomMessage | null = null;

  for (const node of nodes) {
    const role = safeGetAttribute(node, "data-message-author-role") === "assistant" ? "assistant" : "user";
    const message = extractDomMessage(node, role);
    if (!message.markdown) continue;

    if (role === "user") {
      if (pendingUser) anchors.push(makeAnchorFromMessages(pendingUser, null, anchors.length, "role-pair:user-only"));
      pendingUser = message;
      continue;
    }

    if (!pendingUser) continue;
    anchors.push(makeAnchorFromMessages(pendingUser, message, anchors.length, "role-pair"));
    pendingUser = null;
  }

  if (pendingUser) anchors.push(makeAnchorFromMessages(pendingUser, null, anchors.length, "role-pair:tail-user"));
  return anchors;
}

function collectAnchorsFromWrappers(root: HTMLElement, stats: ScanStats): RenderedTurnAnchor[] {
  const wrappers = rejectComposerCandidates(queryAllSafe(root, TURN_ROOT_SELECTOR, "turn-wrappers", stats), "turn-wrapper", stats)
    .filter(isUsableElement)
    .filter((node) => !isInsideExcludedArea(node));
  const anchors: RenderedTurnAnchor[] = [];
  let pendingUser: DomMessage | null = null;

  for (const wrapper of wrappers) {
    const userNode = findUserNode(wrapper);
    const assistantNode = findAssistantNode(wrapper);

    if (userNode) {
      if (pendingUser) anchors.push(makeAnchorFromMessages(pendingUser, null, anchors.length, "wrapper:user-only"));
      pendingUser = extractDomMessage(userNode, "user");
      if (assistantNode) {
        anchors.push(makeAnchorFromMessages(pendingUser, extractDomMessage(assistantNode, "assistant"), anchors.length, "wrapper:paired"));
        pendingUser = null;
      }
      continue;
    }

    if (assistantNode && pendingUser) {
      anchors.push(makeAnchorFromMessages(pendingUser, extractDomMessage(assistantNode, "assistant"), anchors.length, "wrapper:assistant-next"));
      pendingUser = null;
    }
  }

  if (pendingUser) anchors.push(makeAnchorFromMessages(pendingUser, null, anchors.length, "wrapper:tail-user"));
  return anchors;
}

function pushAnchor(anchors: RenderedTurnAnchor[], seen: Set<HTMLElement>, anchor: RenderedTurnAnchor, stats: ScanStats): void {
  stats.selectorStats.candidates = (stats.selectorStats.candidates ?? 0) + 1;
  if (isComposerAnchor(anchor)) {
    stats.skippedComposerCandidateCount += 1;
    stats.rejectedReasons.push(`${anchor.source}: composer-draft`);
    return;
  }
  if (!isUsableAnchor(anchor.jumpAnchor)) {
    stats.rejectedReasons.push(`${anchor.source}: unusable-anchor`);
    return;
  }
  if (seen.has(anchor.jumpAnchor)) {
    stats.rejectedReasons.push(`${anchor.source}: duplicate-anchor`);
    return;
  }
  seen.add(anchor.jumpAnchor);
  anchors.push(anchor);
}

function makeDomTurnFromAnchor(anchor: RenderedTurnAnchor, index: number): YadaTurn {
  const user = extractDomMessage(anchor.userAnchor ?? anchor.jumpAnchor, "user");
  const assistant = anchor.assistantRoot ? extractDomMessage(anchor.assistantRoot, "assistant") : null;
  return {
    id: anchor.userMessageId ?? anchor.assistantMessageId ?? anchor.turnId ?? `dom-turn-${index + 1}`,
    index,
    globalIndex: index,
    displayNumber: index + 1,
    renderedLocalIndex: anchor.indexHint ?? index,
    userMessageId: anchor.userMessageId ?? undefined,
    assistantMessageId: anchor.assistantMessageId ?? undefined,
    turnDomId: anchor.turnId,
    userTextFingerprint: anchor.userTextFingerprint,
    assistantTextFingerprint: anchor.assistantTextFingerprint,
    anchorSource: anchor.source,
    anchorMappingReason: "dom-local",
    anchorMappingTrusted: true,
    userMarkdown: user.markdown,
    assistantMarkdown: assistant?.markdown ?? "",
    userPreview: user.preview,
    assistantPreview: assistant?.preview ?? "",
    attachments: [...user.attachments, ...(assistant?.attachments ?? [])],
    isComposerDraft: false,
    anchorElement: anchor.jumpAnchor,
    userAnchorElement: anchor.userAnchor,
    assistantAnchorElement: anchor.assistantRoot,
    groupElements: anchor.groupEls
  };
}

function makeAnchorFromMessages(user: DomMessage, assistant: DomMessage | null, index: number, source: string): RenderedTurnAnchor {
  const groupEls = uniqueElements([user.turnRoot, user.anchorElement, assistant?.turnRoot, assistant?.anchorElement]);
  const rects = groupEls.map((element) => element.getBoundingClientRect()).filter((rect) => rect.width > 0 || rect.height > 0);
  const top = rects.length ? Math.min(...rects.map((rect) => rect.top)) : user.anchorElement.getBoundingClientRect().top;
  const bottom = rects.length ? Math.max(...rects.map((rect) => rect.bottom)) : user.anchorElement.getBoundingClientRect().bottom;
  return {
    indexHint: index,
    turnId: getTurnDomId(user.turnRoot) ?? getTurnDomId(assistant?.turnRoot ?? null),
    messageId: user.messageId ?? assistant?.messageId ?? null,
    userMessageId: user.messageId ?? null,
    assistantMessageId: assistant?.messageId ?? null,
    userTextFingerprint: createTextFingerprint(user.markdown || user.preview),
    assistantTextFingerprint: assistant ? createTextFingerprint(assistant.markdown || assistant.preview) : "",
    jumpAnchor: user.anchorElement,
    userAnchor: user.anchorElement,
    assistantRoot: assistant?.anchorElement ?? null,
    groupEls,
    top,
    bottom,
    source
  };
}

function extractDomMessage(node: HTMLElement, role: "user" | "assistant"): DomMessage {
  const turnRoot = getTurnRoot(node);
  const attachments = isInsideComposer(turnRoot) ? [] : extractDomAttachments(turnRoot);
  const contentNode = getMessageContentNode(node, role);
  const rawMarkdown = extractMarkdownFromElement(contentNode);
  const markdown = combineTextAndAttachments(rawMarkdown, attachments) || noTextPlaceholder();

  return {
    role,
    messageId: getMessageId(node, turnRoot),
    markdown,
    preview: makePreview(markdown),
    attachments,
    anchorElement: role === "user" ? getJumpAnchor(node, turnRoot) : turnRoot,
    turnRoot
  };
}

function getConversationRoot(): HTMLElement {
  const roots = [
    document.querySelector<HTMLElement>("#thread"),
    document.querySelector<HTMLElement>("main#main"),
    document.querySelector<HTMLElement>("main"),
    document.querySelector<HTMLElement>('[data-testid*="conversation" i]')
  ].filter((element): element is HTMLElement => element instanceof HTMLElement);
  return roots.find((element) => !isInsideExcludedArea(element)) ?? document.body;
}

function getTurnRoot(node: HTMLElement): HTMLElement {
  const turnRoot = node.closest(TURN_ROOT_SELECTOR);
  return turnRoot instanceof HTMLElement && !isInsideComposer(turnRoot) ? turnRoot : node;
}

function getJumpAnchor(roleNode: HTMLElement, turnRoot: HTMLElement): HTMLElement {
  const candidates = [
    roleNode.closest<HTMLElement>('[data-message-author-role="user"]'),
    roleNode.closest<HTMLElement>("[data-message-id]"),
    turnRoot,
    roleNode
  ];
  return candidates.find((candidate): candidate is HTMLElement => candidate instanceof HTMLElement && candidate.isConnected) ?? roleNode;
}

function getMessageId(roleNode: HTMLElement, turnRoot: HTMLElement): string | undefined {
  const messageNode = roleNode.closest(MESSAGE_ID_SELECTOR) ?? roleNode.querySelector(MESSAGE_ID_SELECTOR);
  if (messageNode instanceof HTMLElement) {
    const id = safeGetAttribute(messageNode, "data-message-id");
    if (id) return id;
  }

  return getTurnDomId(turnRoot) ?? undefined;
}

function getTurnDomId(turnRoot: HTMLElement | null): string | null {
  if (!(turnRoot instanceof HTMLElement)) return null;
  return safeGetAttribute(turnRoot, "data-turn-id")
    ?? safeGetAttribute(turnRoot, "data-turn-id-container")
    ?? safeGetAttribute(turnRoot, "data-testid")
    ?? safeGetAttribute(turnRoot, "data-turn")
    ?? null;
}

function getMessageContentNode(node: HTMLElement, role: "user" | "assistant"): HTMLElement {
  const selector = role === "user"
    ? ".whitespace-pre-wrap, [data-message-content], [data-testid*='user' i]"
    : ".markdown, .prose, [class*='prose'], [data-message-content], [data-testid*='assistant' i]";
  const content = node.querySelector<HTMLElement>(selector);
  return content && !isInsideComposer(content) ? content : node;
}

function findUserNode(wrapper: HTMLElement): HTMLElement | null {
  if (isInsideComposer(wrapper)) return null;
  if (safeGetAttribute(wrapper, "data-message-author-role") === "user") return wrapper;
  const explicit = wrapper.querySelector<HTMLElement>(USER_ROLE_SELECTOR);
  if (explicit && !isInsideComposer(explicit)) return explicit;
  if (looksLikeUserRoot(wrapper)) return wrapper;
  const content = wrapper.querySelector<HTMLElement>(".whitespace-pre-wrap, [data-testid*='user' i]");
  return content && !isInsideComposer(content) && looksLikeUserRoot(content) ? content : null;
}

function findAssistantNode(wrapper: HTMLElement): HTMLElement | null {
  if (isInsideComposer(wrapper)) return null;
  if (safeGetAttribute(wrapper, "data-message-author-role") === "assistant") return wrapper;
  const explicit = wrapper.querySelector<HTMLElement>(ASSISTANT_ROLE_SELECTOR);
  if (explicit && !isInsideComposer(explicit)) return explicit;
  const content = wrapper.querySelector<HTMLElement>(".markdown, .prose, [class*='prose'], [data-testid*='assistant' i]");
  return content && !isInsideComposer(content) ? content : null;
}

function looksLikeUserRoot(element: HTMLElement): boolean {
  if (isInsideExcludedArea(element)) return false;
  const testId = safeGetAttribute(element, "data-testid") ?? "";
  if (/user/i.test(testId)) return true;
  if (element.matches(".whitespace-pre-wrap")) return true;
  if (element.querySelector(".whitespace-pre-wrap") && !element.querySelector(".markdown, .prose, [class*='prose']")) return true;
  return false;
}

function extractMarkdownFromElement(element: HTMLElement): string {
  if (isInsideComposer(element)) return "";
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll([
    "button",
    "input",
    "textarea",
    "select",
    "img",
    'a[href*="/backend-api/files/"]',
    '[data-testid*="file" i]',
    '[data-testid*="paste" i]',
    '[data-testid*="attachment" i]',
    '[data-testid*="upload" i]',
    '[aria-label*="file" i]',
    '[aria-label*="paste" i]',
    '[aria-label*="pasted" i]',
    '[aria-label*="attachment" i]',
    "[download]",
    "svg",
    "style",
    "script",
    "[aria-hidden='true']",
    ".sr-only",
    "[id^='chatgpt-yada']",
    "[data-yada-root]"
  ].join(", ")).forEach((node) => {
    node.remove();
  });

  clone.querySelectorAll("br").forEach((node) => {
    node.replaceWith(document.createTextNode("\n"));
  });

  clone.querySelectorAll("a[href]").forEach((anchor) => {
    const href = safeGetAttribute(anchor, "href");
    const text = normalizeInlineText(anchor.textContent ?? "");
    if (!href || !text) return;
    if (href.startsWith("#") || href.startsWith("javascript:")) return;
    const absoluteHref = makeAbsoluteUrl(href);
    anchor.replaceWith(document.createTextNode(`[${text}](${absoluteHref})`));
  });

  clone.querySelectorAll("pre").forEach((pre) => {
    const code = pre.textContent?.trim() ?? "";
    const language = detectCodeLanguage(pre);
    pre.replaceWith(document.createTextNode(`\n\`\`\`${language}\n${code}\n\`\`\`\n`));
  });

  clone.querySelectorAll("blockquote").forEach((quote) => {
    const text = normalizeMarkdownText(quote.textContent ?? "");
    if (!text) return;
    quote.replaceWith(document.createTextNode(`\n${text.split("\n").map((line) => `> ${line}`).join("\n")}\n`));
  });

  clone.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((heading) => {
    const level = Number(heading.tagName.slice(1));
    const text = normalizeInlineText(heading.textContent ?? "");
    if (!text) return;
    heading.replaceWith(document.createTextNode(`\n${"#".repeat(level)} ${text}\n`));
  });

  clone.querySelectorAll("li").forEach((item) => {
    const text = item.textContent?.trim() ?? "";
    if (text && !text.startsWith("- ")) item.prepend(document.createTextNode("- "));
  });

  return normalizeMarkdownText(clone.textContent ?? "");
}

function detectCodeLanguage(pre: Element): string {
  const code = pre.querySelector("code");
  const className = code?.className ?? pre.className;
  const match = String(className).match(/language-([a-z0-9_-]+)/i);
  return match?.[1] ?? "";
}

function buildUniqueFingerprintMap(domTurns: readonly YadaTurn[], role: "user" | "assistant"): Map<string, YadaTurn> {
  const counts = new Map<string, number>();
  for (const turn of domTurns) {
    const fingerprint = getTurnFingerprint(turn, role);
    if (!fingerprint) continue;
    counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1);
  }

  const result = new Map<string, YadaTurn>();
  for (const turn of domTurns) {
    const fingerprint = getTurnFingerprint(turn, role);
    if (fingerprint && counts.get(fingerprint) === 1) result.set(fingerprint, turn);
  }
  return result;
}

function getTurnFingerprint(turn: YadaTurn, role: "user" | "assistant"): string {
  if (role === "assistant") {
    return turn.assistantTextFingerprint ?? createTextFingerprint(turn.assistantMarkdown || turn.assistantPreview);
  }
  return turn.userTextFingerprint ?? createTextFingerprint(turn.userMarkdown || turn.userPreview);
}

function isTrustedAnchorBinding(turn: YadaTurn): boolean {
  if (turn.anchorMappingTrusted === false) return false;
  const reason = turn.anchorMappingReason ?? turn.anchorSource ?? "";
  return !reason.startsWith("estimated");
}

function isUsableAnchor(anchor: HTMLElement | null | undefined): anchor is HTMLElement {
  if (!(anchor instanceof HTMLElement) || !anchor.isConnected) return false;
  if (isInsideExcludedArea(anchor)) return false;
  const rect = anchor.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 || anchor.getClientRects().length > 0;
}

function isUsableElement(element: HTMLElement): boolean {
  return element.isConnected && !isInsideExcludedArea(element);
}

function isInsideExcludedArea(element: HTMLElement): boolean {
  return isInsideComposer(element) || Boolean(element.closest([
    "nav",
    "aside",
    "header",
    "footer",
    "dialog",
    "[role='dialog']",
    "[data-radix-popper-content-wrapper]",
    "[data-yada-root]"
  ].join(", ")));
}

function rejectComposerCandidates(nodes: HTMLElement[], source: string, stats: ScanStats): HTMLElement[] {
  return nodes.filter((node) => {
    if (!isInsideComposer(node)) return true;
    stats.skippedComposerCandidateCount += 1;
    stats.rejectedReasons.push(`${source}: composer-draft`);
    return false;
  });
}

function isComposerAnchor(anchor: RenderedTurnAnchor): boolean {
  return [
    anchor.jumpAnchor,
    anchor.userAnchor,
    anchor.assistantRoot,
    ...anchor.groupEls
  ].some((element) => element instanceof Element && isInsideComposer(element));
}

function queryAllSafe(root: ParentNode, selector: string, statKey: string, stats: ScanStats): HTMLElement[] {
  try {
    const nodes = Array.from(root.querySelectorAll(selector)).filter((node): node is HTMLElement => node instanceof HTMLElement);
    stats.selectorStats[statKey] = nodes.length;
    stats.rawDomCandidateCount += nodes.length;
    return nodes;
  } catch (error) {
    stats.rejectedReasons.push(`${statKey}: selector failed ${(error as Error).message}`);
    return [];
  }
}

function safeGetAttribute(node: Element | null | undefined, name: string): string | null {
  return node instanceof Element ? node.getAttribute(name) : null;
}

function uniqueElements(elements: Array<HTMLElement | null | undefined>): HTMLElement[] {
  const result: HTMLElement[] = [];
  for (const element of elements) {
    if (element instanceof HTMLElement && !result.includes(element)) result.push(element);
  }
  return result;
}

function normalizeMarkdownText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeInlineText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function makeAbsoluteUrl(href: string): string {
  try {
    return new URL(href, window.location.href).href;
  } catch {
    return href;
  }
}

function makePreview(markdown: string): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, "[代码块]")
    .replace(/[#*_>`~-]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return plain.length > 180 ? `${plain.slice(0, 179)}...` : plain;
}

function makeRenderedAnchorDebug(turn: YadaTurn): YadaRenderedAnchorDebug {
  const rect = getTurnDebugRange(turn);
  return {
    renderedLocalIndex: turn.renderedLocalIndex ?? null,
    globalIndex: Number.isFinite(turn.globalIndex ?? NaN) ? turn.globalIndex as number : turn.index,
    displayNumber: Number.isFinite(turn.displayNumber ?? NaN) ? turn.displayNumber as number : turn.index + 1,
    mappingReason: turn.anchorMappingReason ?? turn.anchorSource ?? null,
    mappingTrusted: turn.anchorMappingTrusted !== false,
    turnId: turn.turnDomId ?? turn.id ?? null,
    userMessageId: turn.userMessageId ?? null,
    assistantMessageId: turn.assistantMessageId ?? null,
    userTextFingerprint: turn.userTextFingerprint,
    assistantTextFingerprint: turn.assistantTextFingerprint,
    top: rect.top,
    bottom: rect.bottom
  };
}

function makeRenderedAnchorDebugFromAnchor(anchor: RenderedTurnAnchor, fallbackIndex: number): YadaRenderedAnchorDebug {
  return {
    renderedLocalIndex: anchor.indexHint ?? fallbackIndex,
    globalIndex: null,
    displayNumber: null,
    mappingReason: "rendered-local",
    mappingTrusted: false,
    turnId: anchor.turnId,
    userMessageId: anchor.userMessageId,
    assistantMessageId: anchor.assistantMessageId,
    userTextFingerprint: anchor.userTextFingerprint,
    assistantTextFingerprint: anchor.assistantTextFingerprint,
    top: Math.round(anchor.top),
    bottom: Math.round(anchor.bottom)
  };
}

function getTurnDebugRange(turn: YadaTurn): { top: number; bottom: number } {
  const elements = uniqueElements([...(turn.groupElements ?? []), turn.anchorElement, turn.userAnchorElement, turn.assistantAnchorElement])
    .filter(isUsableAnchor);
  const rects = elements.map((element) => element.getBoundingClientRect()).filter((rect) => rect.width > 0 || rect.height > 0);
  if (rects.length === 0) return { top: 0, bottom: 0 };
  return {
    top: Math.round(Math.min(...rects.map((rect) => rect.top))),
    bottom: Math.round(Math.max(...rects.map((rect) => rect.bottom)))
  };
}

function summarizeAnchor(anchor: RenderedTurnAnchor): Record<string, unknown> {
  return {
    indexHint: anchor.indexHint,
    turnId: anchor.turnId,
    userMessageId: anchor.userMessageId,
    assistantMessageId: anchor.assistantMessageId,
    source: anchor.source,
    top: Math.round(anchor.top),
    bottom: Math.round(anchor.bottom),
    textFingerprintLength: anchor.userTextFingerprint.length,
    assistantTextFingerprintLength: anchor.assistantTextFingerprint.length
  };
}

function emptyAnchorScanDebug(): YadaDomAnchorScanDebug {
  return {
    candidateCount: 0,
    acceptedCount: 0,
    rejectedCount: 0,
    fullTurnsLength: 0,
    selectorStats: {},
    firstAccepted: null,
    firstRejectedReasons: [],
    visibleIndexes: [],
    visibleRenderedAnchors: [],
    bindByMessageIdCount: 0,
    bindByFingerprintCount: 0,
    bindByTurnDomIdCount: 0,
    bindByFullIndexCount: 0,
    bindByEstimatedIndexCount: 0
  };
}

function emptyConversationAudit(): YadaConversationAudit {
  return {
    rawDomCandidateCount: 0,
    skippedComposerCandidateCount: 0,
    composerElementCount: 0,
    finalTurnCount: 0,
    composerTurnCount: 0,
    warning: null
  };
}

function makeConversationAudit(turns: readonly YadaTurn[], debug: YadaDomAnchorScanDebug): YadaConversationAudit {
  const composerTurnCount = turns.filter(isComposerDraftTurn).length;
  const skippedComposerCandidateCount = Number(debug.selectorStats.skippedComposerCandidateCount ?? 0);
  const rawDomCandidateCount = Number(debug.selectorStats.rawDomCandidateCount ?? 0);
  return {
    rawDomCandidateCount,
    skippedComposerCandidateCount,
    composerElementCount: countComposerElements(),
    finalTurnCount: turns.length,
    composerTurnCount,
    warning: composerTurnCount > 0 ? "Composer draft leaked into turns." : null
  };
}

function makeAnchorScanErrorDebug(phase: string, error: unknown): YadaDomAnchorScanDebug {
  const normalized = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return {
    candidateCount: 0,
    acceptedCount: 0,
    rejectedCount: 1,
    fullTurnsLength: 0,
    selectorStats: { error: 1, rawDomCandidateCount: 0, skippedComposerCandidateCount: 0, composerElementCount: countComposerElements() },
    firstAccepted: null,
    firstRejectedReasons: [`${phase}: ${normalized}`],
    visibleIndexes: [],
    visibleRenderedAnchors: [],
    bindByMessageIdCount: 0,
    bindByFingerprintCount: 0,
    bindByTurnDomIdCount: 0,
    bindByFullIndexCount: 0,
    bindByEstimatedIndexCount: 0
  };
}

function logDomCollectorError(phase: string, error: unknown): void {
  if (!isYadaDebugEnabled()) return;
  const normalized = error instanceof Error
    ? { errorName: error.name, errorMessage: error.message, stack: error.stack ?? null }
    : { errorName: "UnknownError", errorMessage: String(error), stack: null };
  console.warn("ChatGPT Yada Error Boundary:", {
    yadaErrorBoundary: true,
    phase,
    ...normalized,
    safeFallbackApplied: true
  });
}

function isYadaDebugEnabled(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("yadaDebug") === "1" || params.has("yadaDebug")) return true;
    return window.localStorage.getItem("chatgpt-yada-debug") === "1";
  } catch {
    return false;
  }
}
