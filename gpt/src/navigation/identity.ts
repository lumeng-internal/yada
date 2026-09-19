import type { YadaTurn } from "../conversation/types";
import type { NavigationFailure } from "./types";

export function findTurn(turns: readonly YadaTurn[], turnId: string): YadaTurn[] {
  return turns.filter((turn) =>
    turn.id === turnId
    || turn.userMessageId === turnId
    || turn.assistantMessageId === turnId
  );
}

export function resolveNavigationTurn(
  turns: readonly YadaTurn[],
  turnId: string
): { ok: true; turn: YadaTurn } | { ok: false; status: Extract<NavigationFailure, "stale-target" | "identity-conflict"> } {
  const matches = findTurn(turns, turnId);
  if (matches.length > 1) return { ok: false, status: "identity-conflict" };
  if (matches.length === 0) return { ok: false, status: "stale-target" };
  return { ok: true, turn: matches[0]! };
}

export function turnUserMessageId(turn: YadaTurn): string {
  return turn.userMessageId ?? turn.id;
}
