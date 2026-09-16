export type YadaAttachmentKind = "image" | "file" | "pasted";

export type YadaAttachment = {
  kind: YadaAttachmentKind;
  label: string;
  filename?: string;
  mimeType?: string;
};

export type YadaTurn = {
  id: string;
  index: number;
  globalIndex?: number;
  displayNumber?: number;
  renderedLocalIndex?: number | null;
  userMessageId?: string;
  assistantMessageId?: string;
  turnDomId?: string | null;
  userTextFingerprint?: string;
  assistantTextFingerprint?: string;
  anchorSource?: string;
  anchorMappingReason?: string;
  anchorMappingTrusted?: boolean;
  /** Unix seconds from each message; never inferred from another message. */
  userCreatedAt?: number;
  assistantCreatedAt?: number;
  userMarkdown: string;
  assistantMarkdown: string;
  userPreview: string;
  assistantPreview: string;
  attachments: YadaAttachment[];
  isComposerDraft?: boolean;
  anchorElement?: HTMLElement;
  userAnchorElement?: HTMLElement | null;
  assistantAnchorElement?: HTMLElement | null;
  groupElements?: HTMLElement[];
};

export type YadaConversationSource = "api-full" | "cached-api-full" | "dom-partial";

export type YadaDomAnchorScanDebug = {
  candidateCount: number;
  acceptedCount: number;
  rejectedCount: number;
  fullTurnsLength?: number;
  selectorStats: Record<string, number>;
  firstAccepted: Record<string, unknown> | null;
  firstRejectedReasons: string[];
  visibleIndexes: number[];
  visibleRenderedAnchors?: YadaRenderedAnchorDebug[];
  bindByMessageIdCount: number;
  bindByFingerprintCount: number;
  bindByTurnDomIdCount?: number;
  bindByFullIndexCount?: number;
  bindByEstimatedIndexCount: number;
};

export type YadaRenderedAnchorDebug = {
  renderedLocalIndex: number | null;
  globalIndex: number | null;
  displayNumber: number | null;
  mappingReason: string | null;
  mappingTrusted: boolean;
  turnId: string | null;
  userMessageId: string | null;
  assistantMessageId: string | null;
  userTextFingerprint?: string;
  assistantTextFingerprint?: string;
  top: number;
  bottom: number;
};

export type YadaConversationAudit = {
  rawDomCandidateCount: number;
  skippedComposerCandidateCount: number;
  composerElementCount: number;
  finalTurnCount: number;
  composerTurnCount: number;
  warning: string | null;
};

export type YadaConversationSnapshot = {
  conversationId: string | null;
  source: YadaConversationSource;
  turns: YadaTurn[];
  capturedAt: number;
  apiTurnsLength?: number;
  domTurnsLength?: number;
  usingCachedApiTurns?: boolean;
  lastStableTurnsLength?: number;
  anchorScanDebug?: YadaDomAnchorScanDebug;
  conversationAudit?: YadaConversationAudit;
};
