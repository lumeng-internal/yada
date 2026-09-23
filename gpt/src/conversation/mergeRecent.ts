import type { ConversationSnapshot } from "../core/types";
import type { YadaTurn } from "./types";
import { identity } from "../quota/vibebar/conversationParser";
import type { ChatGPTChatTurn } from "../quota/vibebar/types";

export async function mergeRecentSnapshot(
  full: ConversationSnapshot,
  recent: ConversationSnapshot
): Promise<ConversationSnapshot | null> {
  if (full.conversationId !== recent.conversationId) return null;
  if (!full.activeTurns.length || !recent.activeTurns.length) return null;
  if (recent.quotaUnclassifiedTurns > 0) return null;
  if (recent.quotaIsWork !== full.quotaIsWork || recent.quotaTemporary !== full.quotaTemporary) return null;
  if (full.quotaOrigin && recent.quotaOrigin && full.quotaOrigin !== recent.quotaOrigin) return null;

  const anchor = findAnchor(full.activeTurns, recent.activeTurns);
  if (!anchor) return null;

  const prefix = full.activeTurns.slice(0, anchor.fullIndex);
  const tail = recent.activeTurns.slice(anchor.recentIndex).map((turn, index) => renumber(turn, prefix.length + index));
  const replacedUserIds = full.activeTurns
    .slice(anchor.fullIndex)
    .map((turn) => turn.userMessageId)
    .filter((id): id is string => Boolean(id));
  const replaced = new Set(await Promise.all(replacedUserIds.map((id) => identity(`${full.conversationId}:${id}`))));
  const kept = full.quotaTurns.filter((turn) => !replaced.has(turn.id));
  const quotaTurns = dedupeTurns([...kept, ...recent.quotaTurns]);

  return {
    ...full,
    revision: full.revision,
    capturedAt: recent.capturedAt,
    activeTurns: [...prefix, ...tail],
    quotaTurns,
    quotaUnclassifiedTurns: full.quotaUnclassifiedTurns,
    title: recent.title ?? full.title,
    coverage: "full"
  };
}

function renumber(turn: YadaTurn, index: number): YadaTurn {
  return { ...turn, index, globalIndex: index, displayNumber: index + 1 };
}

function findAnchor(full: readonly YadaTurn[], recent: readonly YadaTurn[]): { fullIndex: number; recentIndex: number } | null {
  for (let fullIndex = full.length - 1; fullIndex >= 0; fullIndex -= 1) {
    const userId = full[fullIndex]?.userMessageId;
    if (!userId) continue;
    const recentIndex = recent.findIndex((turn) => turn.userMessageId === userId);
    if (recentIndex < 0) continue;
    if (tailAgrees(full, recent, fullIndex, recentIndex)) return { fullIndex, recentIndex };
  }
  return null;
}

function tailAgrees(full: readonly YadaTurn[], recent: readonly YadaTurn[], fullIndex: number, recentIndex: number): boolean {
  let offset = 0;
  while (fullIndex + offset < full.length && recentIndex + offset < recent.length) {
    const fullId = full[fullIndex + offset]?.userMessageId;
    const recentId = recent[recentIndex + offset]?.userMessageId;
    if (!fullId || !recentId) return false;
    if (fullId !== recentId) return replacementAgrees(full, recent, fullIndex + offset, recentIndex + offset);
    offset += 1;
  }
  if (recentIndex + offset >= recent.length && fullIndex + offset < full.length) return false;
  return extensionIsNew(full, recent.slice(recentIndex + offset));
}

function replacementAgrees(full: readonly YadaTurn[], recent: readonly YadaTurn[], fullIndex: number, recentIndex: number): boolean {
  const earlier = new Set(full.slice(0, fullIndex).map((turn) => turn.userMessageId));
  const replaced = new Set(full.slice(fullIndex).map((turn) => turn.userMessageId));
  for (const turn of recent.slice(recentIndex)) {
    const id = turn.userMessageId;
    if (!id || earlier.has(id) || replaced.has(id)) return false;
  }
  return true;
}

function extensionIsNew(full: readonly YadaTurn[], extra: readonly YadaTurn[]): boolean {
  const known = new Set(full.map((turn) => turn.userMessageId));
  return extra.every((turn) => Boolean(turn.userMessageId) && !known.has(turn.userMessageId));
}

function dedupeTurns(turns: readonly ChatGPTChatTurn[]): ChatGPTChatTurn[] {
  const byId = new Map<string, ChatGPTChatTurn>();
  for (const turn of turns) byId.set(turn.id, turn);
  return [...byId.values()];
}
