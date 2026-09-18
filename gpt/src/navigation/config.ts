/** Yada-only navigation constants extracted from Luna APP_CONFIG. */

export const NAVIGATION_CONFIG = {
  promptTopOffsetPx: 16,
  fingerprint: {
    countPerAssistant: 3,
    probeLength: 40,
    verificationLength: 256,
    segmentViewportRatio: 0.75,
    segmentOverlapRatio: 0.15,
    estimatedCharsPerVisualLine: 60,
    estimatedRowsPerViewport: 30,
    maximumSegmentsPerAssistant: 20,
    buildBatchSize: 10,
    buildTimeBudgetMs: 8,
    observationDebounceMs: 750
  },
  anchorCache: {
    maxConversations: 50,
    maxAnchorsPerConversation: 100,
    maxAgeMs: 30 * 24 * 60 * 60 * 1_000,
    viewportWidthTolerance: 48
  },
  search: {
    maxAttempts: 32,
    maxUnproductiveAttempts: 6,
    renderWaitMs: 80,
    maxDurationMs: 30_000,
    edgeBackfillWaitMs: 1_200,
    maximumWindowSlideCycles: 16,
    interpolationFailuresBeforeBinary: 2,
    relativeViewportRatio: 0.75,
    minimumRelativeViewportRatio: 0.25,
    maximumRelativeViewportCount: 16,
    maximumLearnedRelativeViewportCount: 64,
    nearTargetPromptDistance: 4,
    maximumNearTargetViewportCount: 8,
    stalledStepGrowthRatio: 1.5,
    crossingStepRatio: 0.5,
    promptMountScanViewportRatio: 0.2,
    minimumPromptMountViewportRatio: 0.05,
    maximumPromptMountViewportCount: 2,
    promptMountStepGrowthRatio: 1.5,
    promptMountCrossingStepRatio: 0.5,
    maximumPromptMountAttempts: 12
  }
} as const;

export const APP_CONFIG = {
  platforms: {
    chatgpt: {
      promptTopOffsetPx: NAVIGATION_CONFIG.promptTopOffsetPx,
      settleAttempts: 3
    }
  },
  navigation: {
    fingerprint: NAVIGATION_CONFIG.fingerprint,
    anchorCache: NAVIGATION_CONFIG.anchorCache,
    search: NAVIGATION_CONFIG.search
  }
} as const;
