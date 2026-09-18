import { createNavigationTurns, type NavigationTurn } from "@/navigation/navigationData";
import type { YadaTurn } from "../conversation/types";

export type LunaPromptRef = {
  id: string;
};

export function toLunaPrompts(turns: readonly YadaTurn[]): LunaPromptRef[] {
  return turns.map((turn) => ({ id: turn.userMessageId ?? turn.id }));
}

export function toLunaNavigationTurns(turns: readonly YadaTurn[]): NavigationTurn[] {
  return createNavigationTurns(
    turns.flatMap((turn) => {
      const promptId = turn.userMessageId ?? turn.id;
      const promptText = turn.userMarkdown || turn.userPreview || promptId;
      const responseId = turn.assistantMessageId;
      const responseText = turn.assistantMarkdown || turn.assistantPreview;
      const prompt = { id: promptId, kind: "prompt" as const, text: promptText };
      if (!responseId || !responseText.trim()) return [prompt];
      return [prompt, { id: responseId, kind: "response" as const, text: responseText }];
    })
  );
}

export function findTurn(turns: readonly YadaTurn[], turnId: string): YadaTurn | undefined {
  return turns.find((turn) =>
    turn.id === turnId
    || turn.userMessageId === turnId
    || turn.assistantMessageId === turnId
  );
}
