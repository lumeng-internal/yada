import type { CanonicalMessage, CanonicalTurn } from './types';

const PREVIEW_LIMIT = 240;

const preview = (value: string): string => {
  const characters = Array.from(value.trim());
  return characters.length <= PREVIEW_LIMIT ? characters.join('') : `${characters.slice(0, PREVIEW_LIMIT).join('')}…`;
};

export const buildCanonicalTurns = (messages: CanonicalMessage[]): CanonicalTurn[] => {
  const turns: CanonicalTurn[] = [];

  for (const message of messages) {
    if (message.role === 'user') {
      turns.push({
        id: message.id,
        order: turns.length,
        userMessageId: message.id,
        userPreview: preview(message.visibleText),
        assistantPreview: '',
      });
      continue;
    }

    const current = turns.at(-1);
    if (current?.userMessageId && !current.assistantMessageId) {
      current.assistantMessageId = message.id;
      current.assistantPreview = preview(message.visibleText);
      continue;
    }

    turns.push({
      id: message.id,
      order: turns.length,
      assistantMessageId: message.id,
      userPreview: '',
      assistantPreview: preview(message.visibleText),
    });
  }

  return turns;
};
