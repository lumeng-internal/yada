export const NATIVE_NAV_CONFIG = {
  timeoutMs: 15_000,
  directSettleMs: 48,
  pollMs: 32,
  alignmentQuietMs: 80,
  alignmentTolerancePx: 8,
  maxAlignmentAttempts: 2,
  failStyleMs: 1_500
} as const;
