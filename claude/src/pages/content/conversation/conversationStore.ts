import { buildActiveBranch } from './buildActiveBranch';
import { buildCanonicalTurns } from './buildCanonicalTurns';
import type {
  ClaudeConversation,
  ConversationClient,
  ConversationClientResult,
  ConversationRequestContext,
  ConversationSnapshot,
  ConversationStoreState,
} from './types';

type StoreListener = (state: ConversationStoreState) => void;

const initialState = (): ConversationStoreState => ({ status: 'idle', snapshot: null, error: null });

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : 'Conversation request failed';

const sameContext = (left: ConversationRequestContext | null, right: ConversationRequestContext): boolean => (
  left?.organizationId === right.organizationId && left.conversationId === right.conversationId
);

export class ConversationStore {
  private state = initialState();
  private readonly listeners = new Set<StoreListener>();
  private currentContext: ConversationRequestContext | null = null;
  private requestGeneration = 0;

  constructor(private readonly client: ConversationClient) {}

  getState(): ConversationStoreState {
    return this.state;
  }

  getContext(): ConversationRequestContext | null {
    return this.currentContext ? { ...this.currentContext } : null;
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async load(
    context: ConversationRequestContext,
    options: { force?: boolean; signal?: AbortSignal } = {},
  ): Promise<void> {
    const sameRoute = sameContext(this.currentContext, context);
    const previousConversationId = this.currentContext?.conversationId;
    if (!sameRoute && previousConversationId) this.client.invalidate(previousConversationId);
    this.currentContext = { ...context };
    const generation = ++this.requestGeneration;
    this.setState({
      status: 'loading',
      snapshot: sameRoute ? this.state.snapshot : null,
      error: null,
    });

    try {
      const clientResult = await this.client.fetchConversation(context, options);
      if (!this.isCurrent(context, generation)) return;
      await this.commitResult(context, clientResult, generation);
    } catch (error) {
      if (!this.isCurrent(context, generation) || (error instanceof Error && error.name === 'AbortError')) return;
      const snapshot = sameRoute ? this.state.snapshot : null;
      this.setState({
        status: snapshot ? 'stale' : 'error',
        snapshot,
        error: errorMessage(error),
      });
    }
  }

  async applyConversation(
    context: ConversationRequestContext,
    conversation: ClaudeConversation,
    fetchedAt = Date.now(),
  ): Promise<boolean> {
    if (!sameContext(this.currentContext, context)) return false;
    this.client.invalidate(context.conversationId);
    const generation = ++this.requestGeneration;
    try {
      await this.commitResult(context, { source: 'api', conversation, fetchedAt }, generation);
      return this.isCurrent(context, generation);
    } catch (error) {
      if (!this.isCurrent(context, generation)) return false;
      this.setState({
        status: this.state.snapshot ? 'stale' : 'error',
        snapshot: this.state.snapshot,
        error: errorMessage(error),
      });
      return false;
    }
  }

  markStale(): void {
    if (!this.currentContext || !this.state.snapshot) return;
    this.setState({ ...this.state, status: 'stale' });
  }

  clear(): void {
    const previousConversationId = this.currentContext?.conversationId;
    this.requestGeneration += 1;
    this.currentContext = null;
    if (previousConversationId) this.client.invalidate(previousConversationId);
    this.setState(initialState());
  }

  private async commitResult(
    context: ConversationRequestContext,
    result: ConversationClientResult,
    generation: number,
  ): Promise<void> {
    const branch = await buildActiveBranch(result.conversation);
    if (!this.isCurrent(context, generation)) return;
    const currentLeafMessageId = result.conversation.current_leaf_message_uuid ?? '';
    const hasStreamingMessage = branch.messages.some((message) => message.streaming);
    const complete = branch.complete && !hasStreamingMessage;
    const snapshot: ConversationSnapshot = {
      conversationId: context.conversationId,
      currentLeafMessageId,
      messages: branch.messages,
      turns: buildCanonicalTurns(branch.messages),
      complete,
      issues: branch.issues,
      fetchedAt: result.fetchedAt,
    };
    if (
      !complete &&
      this.state.snapshot?.complete &&
      this.state.snapshot.conversationId === context.conversationId
    ) {
      this.setState({ status: 'stale', snapshot: this.state.snapshot, error: null });
      return;
    }
    this.setState({
      status: complete ? 'ready' : 'incomplete',
      snapshot,
      error: null,
    });
  }

  private isCurrent(context: ConversationRequestContext, generation: number): boolean {
    return generation === this.requestGeneration && sameContext(this.currentContext, context);
  }

  private setState(state: ConversationStoreState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}
