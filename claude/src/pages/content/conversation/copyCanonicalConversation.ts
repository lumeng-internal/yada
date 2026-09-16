import { serializeConversationSnapshot, type SerializationMetrics } from './serializeConversation';
import type { ConversationStoreState } from './types';
import { validateCompleteCopy, type CopyValidationError } from './validateCopy';

export type CanonicalCopyResult = {
  status: 'copied' | 'unavailable' | 'invalid' | 'stale' | 'clipboard-error';
  metrics?: SerializationMetrics;
  errors: Array<CopyValidationError | 'complete-snapshot-unavailable' | 'clipboard-write-failed'>;
};

export interface CanonicalCopyOptions {
  isCurrentSnapshot?: () => boolean;
}

export const copyCanonicalConversation = async (
  state: ConversationStoreState,
  writeText: (text: string) => Promise<void>,
  options: CanonicalCopyOptions = {},
): Promise<CanonicalCopyResult> => {
  const snapshot = state.snapshot;
  if (state.status !== 'ready' || !snapshot?.complete) {
    return { status: 'unavailable', errors: ['complete-snapshot-unavailable'] };
  }

  const serialized = await serializeConversationSnapshot(snapshot);
  const errors = await validateCompleteCopy(snapshot, serialized);
  if (errors.length > 0) return { status: 'invalid', metrics: serialized.metrics, errors };
  if (options.isCurrentSnapshot && !options.isCurrentSnapshot()) {
    return { status: 'stale', metrics: serialized.metrics, errors: [] };
  }

  try {
    await writeText(serialized.markdown);
    return { status: 'copied', metrics: serialized.metrics, errors: [] };
  } catch {
    return { status: 'clipboard-error', metrics: serialized.metrics, errors: ['clipboard-write-failed'] };
  }
};
