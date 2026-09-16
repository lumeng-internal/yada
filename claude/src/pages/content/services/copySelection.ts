import {
  getCandidatesFromTurns,
  getConversationTurns,
  type ConversationTurn,
} from './conversationTurns';
import type { ExportMessageCandidate } from './exportExtractors';

export type CopySelectionSnapshot = {
  selectionMode: boolean;
  selectedTurnIds: Set<string>;
  turns: ConversationTurn[];
};

type CopySelectionSubscriber = (snapshot: CopySelectionSnapshot) => void;

let selectionMode = false;
let selectedTurnIds = new Set<string>();
let turns: ConversationTurn[] = [];
const subscribers = new Set<CopySelectionSubscriber>();

const cloneSnapshot = (): CopySelectionSnapshot => ({
  selectionMode,
  selectedTurnIds: new Set(selectedTurnIds),
  turns: [...turns],
});

const areTurnListsEqual = (a: ConversationTurn[], b: ConversationTurn[]): boolean => {
  if (a.length !== b.length) return false;
  return a.every((turn, index) => turn.id === b[index]?.id);
};

const areSetsEqual = (a: Set<string>, b: Set<string>): boolean => {
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
};

const notifyCopySelectionSubscribers = () => {
  const snapshot = cloneSnapshot();
  subscribers.forEach((subscriber) => subscriber(snapshot));
};

export const getCopySelectionSnapshot = (): CopySelectionSnapshot => cloneSnapshot();

export const subscribeCopySelection = (subscriber: CopySelectionSubscriber): (() => void) => {
  subscribers.add(subscriber);
  subscriber(cloneSnapshot());
  return () => {
    subscribers.delete(subscriber);
  };
};

export const setCopySelectionTurns = (nextTurns: ConversationTurn[]) => {
  const validTurnIds = new Set(nextTurns.map((turn) => turn.id));
  const nextSelectedTurnIds = new Set([...selectedTurnIds].filter((id) => validTurnIds.has(id)));
  const turnsChanged = !areTurnListsEqual(turns, nextTurns);
  const selectionChanged = !areSetsEqual(selectedTurnIds, nextSelectedTurnIds);

  turns = nextTurns;
  selectedTurnIds = nextSelectedTurnIds;

  if (turnsChanged || selectionChanged) notifyCopySelectionSubscribers();
};

export const refreshCopySelectionTurns = (root?: ParentNode): ConversationTurn[] => {
  const nextTurns = getConversationTurns(root);
  setCopySelectionTurns(nextTurns);
  return nextTurns;
};

export const enterCopySelectionMode = () => {
  refreshCopySelectionTurns();
  if (selectionMode) return;
  selectionMode = true;
  notifyCopySelectionSubscribers();
};

export const exitCopySelectionMode = () => {
  const changed = selectionMode || selectedTurnIds.size > 0;
  selectionMode = false;
  selectedTurnIds = new Set();
  if (changed) notifyCopySelectionSubscribers();
};

export const toggleCopySelectionTurn = (turnId: string) => {
  if (!selectionMode) return;

  const validTurnIds = new Set(turns.map((turn) => turn.id));
  if (!validTurnIds.has(turnId)) return;

  const nextSelectedTurnIds = new Set(selectedTurnIds);
  if (nextSelectedTurnIds.has(turnId)) nextSelectedTurnIds.delete(turnId);
  else nextSelectedTurnIds.add(turnId);

  selectedTurnIds = nextSelectedTurnIds;
  notifyCopySelectionSubscribers();
};

export const toggleCopySelectionTurnIds = (
  turnIds: Iterable<string>,
  baseSelectedTurnIds: Iterable<string> = selectedTurnIds,
) => {
  if (!selectionMode) return;

  const validTurnIds = new Set(turns.map((turn) => turn.id));
  const nextSelectedTurnIds = new Set<string>();

  for (const turnId of baseSelectedTurnIds) {
    if (validTurnIds.has(turnId)) nextSelectedTurnIds.add(turnId);
  }

  for (const turnId of turnIds) {
    if (!validTurnIds.has(turnId)) continue;
    if (nextSelectedTurnIds.has(turnId)) nextSelectedTurnIds.delete(turnId);
    else nextSelectedTurnIds.add(turnId);
  }

  if (areSetsEqual(selectedTurnIds, nextSelectedTurnIds)) return;

  selectedTurnIds = nextSelectedTurnIds;
  notifyCopySelectionSubscribers();
};

export const addCopySelectionTurns = (turnIds: Iterable<string>) => {
  if (!selectionMode) return;

  const validTurnIds = new Set(turns.map((turn) => turn.id));
  const nextSelectedTurnIds = new Set(selectedTurnIds);

  for (const turnId of turnIds) {
    if (validTurnIds.has(turnId)) nextSelectedTurnIds.add(turnId);
  }

  if (areSetsEqual(selectedTurnIds, nextSelectedTurnIds)) return;

  selectedTurnIds = nextSelectedTurnIds;
  notifyCopySelectionSubscribers();
};

export const setCopySelectionTurnIds = (turnIds: Iterable<string>) => {
  if (!selectionMode) return;

  const validTurnIds = new Set(turns.map((turn) => turn.id));
  const nextSelectedTurnIds = new Set<string>();

  for (const turnId of turnIds) {
    if (validTurnIds.has(turnId)) nextSelectedTurnIds.add(turnId);
  }

  if (areSetsEqual(selectedTurnIds, nextSelectedTurnIds)) return;

  selectedTurnIds = nextSelectedTurnIds;
  notifyCopySelectionSubscribers();
};

export const selectAllCopySelectionTurns = () => {
  const nextTurns = refreshCopySelectionTurns();
  selectionMode = true;
  selectedTurnIds = new Set(nextTurns.map((turn) => turn.id));
  notifyCopySelectionSubscribers();
};

export const invertCopySelectionTurns = () => {
  const nextTurns = refreshCopySelectionTurns();
  selectionMode = true;

  const nextSelectedTurnIds = new Set<string>();
  for (const turn of nextTurns) {
    if (!selectedTurnIds.has(turn.id)) nextSelectedTurnIds.add(turn.id);
  }

  selectedTurnIds = nextSelectedTurnIds;
  notifyCopySelectionSubscribers();
};

export const clearCopySelectionTurns = () => {
  if (selectedTurnIds.size === 0) return;
  selectedTurnIds = new Set();
  notifyCopySelectionSubscribers();
};

export const getSelectedCopySelectionTurns = (): ConversationTurn[] => {
  return turns
    .filter((turn) => selectedTurnIds.has(turn.id))
    .sort((a, b) => a.order - b.order);
};

export const getSelectedCopySelectionCandidates = (): ExportMessageCandidate[] => {
  return getCandidatesFromTurns(getSelectedCopySelectionTurns());
};
