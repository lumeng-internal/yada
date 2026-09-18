export type QuotaRuleSet = {
  id: "openai-pro-200-chat-2026-09-18";
  effectiveFrom: string;
  sourceUrl: string;
  gpt6ProWeekly: number;
  solProDaily: number;
  combinedDaily: number;
};

export const QUOTA_RULES: QuotaRuleSet = {
  id: "openai-pro-200-chat-2026-09-18",
  effectiveFrom: "2026-09-18",
  sourceUrl: "https://help.openai.com/en/articles/20001354-gpt-56-in-chatgpt",
  gpt6ProWeekly: 200,
  solProDaily: 170,
  combinedDaily: 200
};

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
