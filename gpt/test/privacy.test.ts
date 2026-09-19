import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { prune } from "../src/quota/ledger";
import type { QuotaUsageEvent } from "../src/quota/types";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe("privacy boundary", () => {
  it("does not persist conversation bodies on quota events", () => {
    const events: QuotaUsageEvent[] = [{
      id: "chat-a1",
      accountKey: "account",
      createdAt: Date.now(),
      model: "gpt-6-pro",
      classification: "personal"
    }];
    expect(JSON.stringify(prune(events, Date.now()))).not.toMatch(/userMarkdown|assistantMarkdown|请总结/);
  });

  it("keeps production source free of remote telemetry and native bootstrap", () => {
    const root = join(process.cwd(), "src");
    const text = walk(root).filter((path) => path.endsWith(".ts") || path.endsWith(".js") || path.endsWith(".html")).map((path) => readFileSync(path, "utf8")).join("\n");
    expect(text).not.toMatch(/native-bootstrap-page|NativeBootstrapController|HistoryTracker|导航准备中|导航未完整/);
    expect(text).not.toMatch(/定位中|jumpVirtual|searchVirtualPrompt|luna-navigation/);
    expect(text).not.toMatch(/google-analytics|sentry\.io|api[_-]?key/i);
    expect(text).not.toMatch(/\bECS\b|\bRDS\b|\bOSS\b/);
  });
});
