import type { AssistantUsageEventCandidate } from "../core/types";
import { detectProModel } from "./modelDetector";
import type { QuotaEventSource, QuotaUsageEvent } from "./types";

export function toQuotaEvents(
  events: readonly AssistantUsageEventCandidate[],
  accountKey: string,
  source: QuotaEventSource
): QuotaUsageEvent[] {
  return events.map((event) => {
    const createdMs = toOccurredAt(event.createdAt);
    const occurredAt = createdMs ?? event.observedAt;
    const detected = detectProModel(event.modelSlug);
    return {
      id: event.assistantMessageId,
      accountKey,
      conversationId: event.conversationId,
      occurredAt,
      observedAt: event.observedAt,
      timeSource: createdMs == null ? "observed" : "message",
      model: detected.kind,
      source,
      workspaceKind: event.workspaceKind,
      modelSlug: detected.slug ?? undefined
    };
  });
}

function toOccurredAt(createdAt: number | null): number | null {
  if (createdAt == null || !Number.isFinite(createdAt) || createdAt <= 0) return null;
  return createdAt < 1e12 ? Math.round(createdAt * 1000) : Math.round(createdAt);
}
