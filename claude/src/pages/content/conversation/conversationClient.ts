import type { BridgePort } from './bridge';
import type {
  ConversationClient,
  ConversationClientResult,
  ConversationRequestContext,
} from './types';

const requestKey = (context: ConversationRequestContext): string => (
  `${context.organizationId}:${context.conversationId}`
);

const abortError = (): Error => {
  const error = new Error('Conversation request aborted');
  error.name = 'AbortError';
  return error;
};

const observeAbort = <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
};

export class ConversationClientImpl implements ConversationClient {
  private readonly cache = new Map<string, ConversationClientResult>();
  private readonly inFlight = new Map<string, Promise<ConversationClientResult>>();
  private readonly generations = new Map<string, symbol>();

  constructor(
    private readonly getBridge: () => BridgePort | null,
    private readonly now: () => number = () => Date.now(),
  ) {}

  fetchConversation(
    context: ConversationRequestContext,
    options: { force?: boolean; signal?: AbortSignal } = {},
  ): Promise<ConversationClientResult> {
    const key = requestKey(context);
    if (options.force) this.invalidate(context.conversationId);
    const existing = this.inFlight.get(key);
    if (existing) return observeAbort(existing, options.signal);
    if (!options.force) {
      const cached = this.cache.get(key);
      if (cached) return observeAbort(Promise.resolve(cached), options.signal);
    }

    const bridge = this.getBridge();
    if (!bridge) return Promise.reject(new Error('Conversation bridge unavailable'));
    const generation = this.generations.get(key) ?? Symbol(key);
    this.generations.set(key, generation);

    const request = bridge.requestConversation(context.organizationId, context.conversationId)
      .then((conversation): ConversationClientResult => {
        const result = { source: 'api', fetchedAt: this.now(), conversation } as const;
        if (this.generations.get(key) === generation) this.cache.set(key, result);
        return result;
      })
      .finally(() => {
        if (this.inFlight.get(key) === request) this.inFlight.delete(key);
        if (!this.cache.has(key) && !this.inFlight.has(key) && this.generations.get(key) === generation) {
          this.generations.delete(key);
        }
      });
    this.inFlight.set(key, request);
    return observeAbort(request, options.signal);
  }

  invalidate(conversationId?: string): void {
    this.getBridge()?.invalidateConversation?.(conversationId);
    if (!conversationId) {
      const keys = new Set([...this.cache.keys(), ...this.inFlight.keys(), ...this.generations.keys()]);
      for (const key of keys) this.generations.delete(key);
      this.cache.clear();
      this.inFlight.clear();
      return;
    }

    const keys = new Set([...this.cache.keys(), ...this.inFlight.keys(), ...this.generations.keys()]);
    for (const key of keys) {
      if (!key.endsWith(`:${conversationId}`)) continue;
      this.generations.delete(key);
      this.cache.delete(key);
      this.inFlight.delete(key);
    }
  }
}
