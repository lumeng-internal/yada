import { identifier, record, type HistoryBoundary } from "./protocol";

export const MAX_HISTORY_IDENTITIES = 10_000;

export type HistoryPage = {
  messages: Array<{ id: string; prompt: boolean }>;
  boundary: HistoryBoundary;
  cursor: string | null;
  branch: string | null;
};

type MessageIdentity = { id: string; prompt: boolean };

export function readHistoryMetadata(value: unknown, expectedConversationId: string): HistoryPage | null {
  const envelope = record(value);
  const payload = record(envelope?.conversation) ?? envelope;
  if (!payload) return null;

  const payloadId = identifier(payload.conversation_id) ?? identifier(payload.id);
  if (payloadId && payloadId !== expectedConversationId) return null;
  const branch = identifier(payload.current_node) ?? identifier(payload.current_node_id);

  if (Array.isArray(payload.messages)) return readPagedMessages(payload, branch);
  return readMappingPath(payload, branch);
}

function readPagedMessages(payload: Record<string, unknown>, branch: string | null): HistoryPage | null {
  const values = payload.messages as unknown[];
  if (values.length > MAX_HISTORY_IDENTITIES) return null;
  const messages: MessageIdentity[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const identity = messageIdentity(value);
    if (!identity) return { messages, branch, boundary: "unknown", cursor: null };
    if (!seen.has(identity.id)) {
      seen.add(identity.id);
      messages.push(identity);
    }
  }

  const pagination = record(payload.page_info) ?? record(payload.pageInfo);
  const hasPrevious = pagination?.has_previous_page ?? pagination?.hasPreviousPage;
  const cursor = identifier(pagination?.start_cursor) ?? identifier(pagination?.startCursor);
  if (hasPrevious === false) return { messages, branch, boundary: "complete", cursor: null };
  if (hasPrevious === true && cursor) return { messages, branch, boundary: "more", cursor };
  return { messages, branch, boundary: "unknown", cursor };
}

function readMappingPath(payload: Record<string, unknown>, branch: string | null): HistoryPage | null {
  const mapping = record(payload.mapping);
  if (!mapping || !branch || Object.keys(mapping).length > MAX_HISTORY_IDENTITIES) return null;

  const messages: MessageIdentity[] = [];
  const visited = new Set<string>();
  let nodeId: string | null = branch;
  let foundRoot = false;
  while (nodeId && visited.size < MAX_HISTORY_IDENTITIES) {
    if (visited.has(nodeId)) break;
    visited.add(nodeId);
    const node = record(mapping[nodeId]);
    if (!node) break;
    if (node.message != null) {
      const identity = messageIdentity(node.message);
      if (!identity) break;
      messages.push(identity);
    }
    if (node.parent === null || node.parent === "") {
      foundRoot = true;
      break;
    }
    nodeId = identifier(node.parent);
  }
  return {
    messages,
    branch,
    boundary: foundRoot ? "complete" : "unknown",
    cursor: null
  };
}

function messageIdentity(value: unknown): MessageIdentity | null {
  const message = record(value);
  const id = identifier(message?.id);
  const role = record(message?.author)?.role;
  if (!id || !["user", "assistant", "system", "tool", "developer"].includes(String(role))) return null;
  const hidden = record(message?.metadata)?.is_visually_hidden_from_conversation === true;
  return { id, prompt: role === "user" && !hidden };
}

export class HistoryChain {
  readonly identities = new Map<string, boolean>();
  private readonly usedCursors = new Set<string>();
  private selectedBranch: string | null = null;
  boundary: HistoryBoundary = "unknown";
  cursor: string | null = null;
  pages = 0;
  issue: "unlinked" | "stalled" | "limit" | null = null;

  get prompts(): number {
    return [...this.identities.values()].filter(Boolean).length;
  }

  accept(page: HistoryPage, requestedBefore: string | null): void {
    if (requestedBefore === null) this.begin(page.branch);
    else if (!this.continues(requestedBefore, page.branch)) {
      this.fail("unlinked");
      return;
    }

    let additions = 0;
    for (const message of page.messages) {
      if (!this.identities.has(message.id)) additions += 1;
      if (this.identities.size >= MAX_HISTORY_IDENTITIES && !this.identities.has(message.id)) {
        this.fail("limit");
        return;
      }
      this.identities.set(message.id, message.prompt);
    }

    if (page.boundary === "more") {
      if (!page.cursor || this.usedCursors.has(page.cursor) || (requestedBefore !== null && additions === 0)) {
        this.fail("stalled");
        return;
      }
      this.usedCursors.add(page.cursor);
    }

    this.pages += 1;
    this.boundary = page.boundary;
    this.cursor = page.cursor;
    this.issue = null;
  }

  private begin(branch: string | null): void {
    this.identities.clear();
    this.usedCursors.clear();
    this.selectedBranch = branch;
    this.boundary = "unknown";
    this.cursor = null;
    this.pages = 0;
    this.issue = null;
  }

  private continues(before: string, branch: string | null): boolean {
    return this.pages > 0
      && this.boundary === "more"
      && this.cursor === before
      && !(branch && this.selectedBranch && branch !== this.selectedBranch);
  }

  private fail(issue: NonNullable<HistoryChain["issue"]>): void {
    this.boundary = "unknown";
    this.issue = issue;
  }
}
