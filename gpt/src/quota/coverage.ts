import type { QuotaCoverage } from "./types";

export function coverageCaption(coverage: QuotaCoverage): "完整" | "历史估算" | "数据不完整" {
  if (coverage === "complete-local") return "完整";
  if (coverage === "partial") return "历史估算";
  return "数据不完整";
}
