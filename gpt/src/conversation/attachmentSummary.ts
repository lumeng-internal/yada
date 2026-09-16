import type { YadaAttachment } from "./types";
import { isInsideComposer } from "./composerGuard";

type UnknownRecord = Record<string, unknown>;
type AttachmentCandidate = YadaAttachment & {
  key?: string;
};

const FILE_EXTENSION_LABELS: Array<[RegExp, string]> = [
  [/\.pdf$/i, "PDF 文件"],
  [/\.(?:md|markdown)$/i, "Markdown 文件"],
  [/\.csv$/i, "CSV 文件"],
  [/\.txt$/i, "文本文件"],
  [/\.json$/i, "JSON 文件"],
  [/\.(?:xlsx|xls)$/i, "Excel 文件"],
  [/\.(?:docx|doc)$/i, "Word 文件"],
  [/\.(?:zip|rar|7z)$/i, "压缩文件"]
];

const IMAGE_EXTENSION_PATTERN = /\.(?:png|jpe?g|webp|gif|bmp|heic|heif|avif)$/i;

export function summarizeAttachments(attachments: YadaAttachment[]): string {
  return attachments.map(formatAttachment).filter(Boolean).join(" ");
}

export function combineTextAndAttachments(text: string, attachments: YadaAttachment[]): string {
  const cleanText = normalizeBlockText(text);
  const summary = summarizeAttachments(attachments);
  if (cleanText && summary) return `${summary}\n${cleanText}`;
  if (cleanText) return cleanText;
  if (summary) return summary;
  return "";
}

export function noTextPlaceholder(): string {
  return "[无文字消息]";
}

export function extractApiAttachments(message: UnknownRecord): YadaAttachment[] {
  const attachments: AttachmentCandidate[] = [];
  const content = readRecord(message.content);
  const metadata = readRecord(message.metadata);

  if (Array.isArray(content?.parts)) {
    for (const part of content.parts) {
      collectAttachmentFromPart(part, attachments);
    }
  }

  const contentHasImage = attachments.some((attachment) => attachment.kind === "image");
  for (const key of ["attachments", "files", "uploaded_files"]) {
    const value = metadata?.[key] ?? message[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        const collected: AttachmentCandidate[] = [];
        collectAttachmentFromPart(item, collected);
        attachments.push(...collected.filter((attachment) => !(contentHasImage && attachment.kind === "image")));
      }
    }
  }

  const aggregateResult = readRecord(metadata?.aggregate_result);
  if (Array.isArray(aggregateResult?.messages)) {
    for (const item of aggregateResult.messages) {
      const record = readRecord(item);
      if (record && readString(record, "message_type") === "image") {
        const url = readString(record, "image_url") ?? readString(record, "url") ?? undefined;
        attachments.push({ kind: "image", label: "图片", key: makeKey("image", url ?? "aggregate") });
      }
    }
  }

  return dedupeAttachments(attachments);
}

export function extractDomAttachments(root: HTMLElement): YadaAttachment[] {
  if (isInsideComposer(root)) return [];
  const attachments: AttachmentCandidate[] = [];
  const imageKeys = new Set<string>();

  root.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    if (isLikelyAttachmentImage(image)) {
      const key = getDomCandidateKey(image) ?? makeKey("image", safeGetAttribute(image, "src") ?? safeGetAttribute(image, "alt") ?? "");
      if (key) imageKeys.add(key);
      attachments.push({ kind: "image", label: "图片", key });
    }
  });

  const fileNodes = root.querySelectorAll<HTMLElement>(
    [
      'a[href*="/backend-api/files/"]',
      '[data-testid*="file" i]',
      '[data-testid*="paste" i]',
      '[data-testid*="attachment" i]',
      '[data-testid*="upload" i]',
      '[aria-label*="file" i]',
      '[aria-label*="paste" i]',
      '[aria-label*="pasted" i]',
      '[aria-label*="attachment" i]',
      "[download]"
    ].join(", ")
  );

  fileNodes.forEach((node) => {
    const text = normalizeInlineText(node.textContent ?? "");
    const key = getDomCandidateKey(node);
    if (looksLikePasteNode(node)) {
      attachments.push({ kind: "pasted", label: "粘贴内容", key: key ?? "pasted" });
      return;
    }

    const filename = findFilename(text)
      ?? readAttributeFilename(node)
      ?? undefined;

    if (nodeContainsKnownImage(node, imageKeys)) return;

    if (isImageFilename(filename)) {
      attachments.push({ kind: "image", label: "图片", key: key ?? makeKey("image", filename ?? "") });
      return;
    }

    if (!filename && !looksLikeFileNode(node)) return;
    if (filename && isImageFilename(filename)) return;
    attachments.push({ kind: "file", label: getFileLabel(filename), filename, key: key ?? makeKey("file", filename ?? "") });
  });

  return dedupeAttachments(attachments);
}

export function getFileLabel(filename?: string, mimeType?: string): string {
  if (mimeType?.includes("pdf")) return "PDF 文件";
  if (mimeType?.includes("markdown")) return "Markdown 文件";
  if (mimeType?.includes("json")) return "JSON 文件";
  if (mimeType?.includes("csv")) return "CSV 文件";
  if (mimeType?.includes("text")) return "文本文件";
  if (mimeType?.includes("spreadsheet") || mimeType?.includes("excel")) return "Excel 文件";
  if (mimeType?.includes("word")) return "Word 文件";

  if (filename) {
    const match = FILE_EXTENSION_LABELS.find(([pattern]) => pattern.test(filename));
    if (match) return match[1];
  }

  return "文件";
}

function formatAttachment(attachment: YadaAttachment): string {
  if (attachment.kind === "image") return "[图片]";
  if (attachment.kind === "pasted") return "[粘贴内容]";
  if (attachment.kind === "file") {
    return attachment.filename ? `[${attachment.label}] ${attachment.filename}` : `[${attachment.label}]`;
  }
  return "";
}

function collectAttachmentFromPart(part: unknown, attachments: AttachmentCandidate[]): void {
  const record = readRecord(part);
  if (!record) return;

  const contentType = (readString(record, "content_type") ?? readString(record, "type") ?? "").toLowerCase();
  const filename = readString(record, "file_name")
    ?? readString(record, "filename")
    ?? readString(record, "name")
    ?? readString(record, "title")
    ?? undefined;
  const mimeType = readString(record, "mime_type")
    ?? readString(record, "mimetype")
    ?? readString(record, "mime")
    ?? undefined;
  const assetPointer = readString(record, "asset_pointer")
    ?? readString(record, "image_asset_pointer")
    ?? readString(record, "url")
    ?? readString(record, "href")
    ?? undefined;
  const key = makeKey("api", assetPointer ?? filename ?? mimeType ?? contentType);

  if (isImageContent(contentType, filename, mimeType, assetPointer)) {
    attachments.push({ kind: "image", label: "图片", key });
    return;
  }

  if (contentType.includes("paste") || contentType.includes("pasted") || record.pasted === true) {
    attachments.push({ kind: "pasted", label: "粘贴内容", key: key ?? "pasted" });
    return;
  }

  if (filename || contentType.includes("file") || mimeType) {
    attachments.push({ kind: "file", label: getFileLabel(filename, mimeType), filename, mimeType, key });
    return;
  }

}

function dedupeAttachments(attachments: AttachmentCandidate[]): YadaAttachment[] {
  const seen = new Set<string>();
  const result: YadaAttachment[] = [];
  let anonymousImageIndex = 0;
  for (const attachment of attachments) {
    const key = getDedupeKey(attachment, anonymousImageIndex);
    if (attachment.kind === "image" && !attachment.key) anonymousImageIndex += 1;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      kind: attachment.kind,
      label: attachment.label,
      filename: attachment.filename,
      mimeType: attachment.mimeType
    });
  }
  return result;
}

function looksLikePasteNode(node: HTMLElement): boolean {
  const signal = [
    node.dataset.testid,
    safeGetAttribute(node, "aria-label"),
    node.className,
    node.textContent
  ].join(" ").toLowerCase();
  return signal.includes("paste") || signal.includes("pasted") || signal.includes("粘贴");
}

function looksLikeFileNode(node: HTMLElement): boolean {
  const signal = [
    node.dataset.testid,
    safeGetAttribute(node, "aria-label"),
    safeGetAttribute(node, "href"),
    node.textContent
  ].join(" ").toLowerCase();
  return !IMAGE_EXTENSION_PATTERN.test(signal)
    && (signal.includes("/backend-api/files/")
      || signal.includes("attachment")
      || signal.includes("uploaded file")
      || signal.includes("file attachment"));
}

function isLikelyAttachmentImage(image: HTMLImageElement): boolean {
  const src = safeGetAttribute(image, "src") ?? "";
  const alt = safeGetAttribute(image, "alt") ?? "";
  const signal = `${src} ${alt} ${image.className}`.toLowerCase();
  if (signal.includes("avatar") || signal.includes("profile")) return false;

  const rect = image.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0 && rect.width < 28 && rect.height < 28) return false;

  return true;
}

function findFilename(text: string): string | null {
  return text.match(/[^\s/\\]+\.(?:pdf|md|markdown|csv|txt|json|xlsx|xls|docx|doc|zip|rar|7z|png|jpe?g|webp|gif|bmp|heic|heif|avif)\b/i)?.[0] ?? null;
}

function normalizeInlineText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeBlockText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function readRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? value as UnknownRecord : null;
}

function readString(record: UnknownRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isImageContent(contentType: string, filename?: string, mimeType?: string, assetPointer?: string): boolean {
  return contentType.includes("image")
    || mimeType?.toLowerCase().startsWith("image/") === true
    || isImageFilename(filename)
    || assetPointer?.startsWith("sediment://") === true
    || assetPointer?.startsWith("data:image/") === true;
}

function isImageFilename(filename?: string | null): boolean {
  return Boolean(filename && IMAGE_EXTENSION_PATTERN.test(filename));
}

function readAttributeFilename(node: HTMLElement): string | null {
  return safeGetAttribute(node, "download")
    ?? filenameFromUrl(safeGetAttribute(node, "href"))
    ?? filenameFromUrl(safeGetAttribute(node, "src"))
    ?? findFilename(safeGetAttribute(node, "aria-label") ?? "")
    ?? findFilename(node.dataset.testid ?? "");
}

function safeGetAttribute(node: Element | null | undefined, name: string): string | null {
  return node instanceof Element ? node.getAttribute(name) : null;
}

function filenameFromUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.href);
    const last = url.pathname.split("/").filter(Boolean).pop() ?? "";
    return findFilename(decodeURIComponent(last));
  } catch {
    return findFilename(value);
  }
}

function getDomCandidateKey(node: HTMLElement): string | undefined {
  const parts = [
    safeGetAttribute(node, "src"),
    safeGetAttribute(node, "href"),
    safeGetAttribute(node, "alt"),
    safeGetAttribute(node, "download"),
    safeGetAttribute(node, "aria-label"),
    node.dataset.testid,
    findFilename(node.textContent ?? "")
  ].filter(isString);
  return parts.length ? makeKey("dom", parts.join("|")) : undefined;
}

function nodeContainsKnownImage(node: HTMLElement, imageKeys: ReadonlySet<string>): boolean {
  const image = node.matches("img") ? node as HTMLImageElement : node.querySelector<HTMLImageElement>("img");
  if (!image) return false;
  const key = getDomCandidateKey(image);
  return !key || imageKeys.has(key) || isLikelyAttachmentImage(image);
}

function getDedupeKey(attachment: AttachmentCandidate, anonymousImageIndex: number): string {
  if (attachment.key) return `${attachment.kind}:${attachment.key}`;
  if (attachment.kind === "image") return `image:${attachment.filename ?? `anonymous-${anonymousImageIndex}`}`;
  if (attachment.kind === "pasted") return "pasted";
  return `file:${attachment.filename ?? ""}:${attachment.mimeType ?? ""}:${attachment.label}`;
}

function makeKey(prefix: string, value: string): string | undefined {
  const normalized = value.replace(/\s+/g, " ").trim().toLowerCase();
  return normalized ? `${prefix}:${normalized}` : undefined;
}

function isString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
