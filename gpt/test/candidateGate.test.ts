import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCdpClient, targetsToClose } from "../scripts/lib/cdp.mjs";
import { acquireCandidateLock } from "../scripts/qa/lock.mjs";
import { classifyPlanType, quotaLiveStatus } from "../scripts/qa/quota.mjs";
import { overallStatus } from "../scripts/qa/runner.mjs";
import {
  discoverFromList,
  navigationEligible,
  quotaEligible,
  sampleKindFromProbe
} from "../scripts/qa/samples.mjs";

class FakeSocket {
  static last = null;
  url;
  readyState = 0;
  sent = [];
  onopen;
  onerror;
  onmessage;
  onclose;
  constructor(url) {
    this.url = url;
    FakeSocket.last = this;
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}

describe("candidate QA contracts", () => {
  const dirs = [];
  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("rejects a CDP call after timeout", async () => {
    const client = createCdpClient("ws://cdp.test", { WebSocket: FakeSocket, defaultTimeoutMs: 30 });
    const connecting = client.connect();
    FakeSocket.last.open();
    await connecting;
    await expect(client.call("Browser.getVersion")).rejects.toThrow(/CDP timeout/);
    client.close();
  });

  it("rejects pending CDP calls when closed", async () => {
    const client = createCdpClient("ws://cdp.test", { WebSocket: FakeSocket, defaultTimeoutMs: 5_000 });
    const connecting = client.connect();
    FakeSocket.last.open();
    await connecting;
    const pending = client.call("Runtime.evaluate");
    client.close();
    await expect(pending).rejects.toThrow(/CDP closed|CDP socket closed/);
  });

  it("returns BUSY when a live candidate lock exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "yada-lock-"));
    dirs.push(dir);
    const lockPath = join(dir, ".lock");
    writeFileSync(lockPath, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), commit: "abc" })}\n`);
    expect(() => acquireCandidateLock(lockPath, { commit: "def" })).toThrow(/BUSY|正在运行/);
  });

  it("clears a stale candidate lock", () => {
    const dir = mkdtempSync(join(tmpdir(), "yada-lock-"));
    dirs.push(dir);
    const lockPath = join(dir, ".lock");
    writeFileSync(lockPath, `${JSON.stringify({ pid: 99999999, startedAt: new Date().toISOString(), commit: "abc" })}\n`);
    const release = acquireCandidateLock(lockPath, { commit: "def", pidAlive: () => false });
    const body = JSON.parse(readFileSync(lockPath, "utf8"));
    expect(body.commit).toBe("def");
    release();
  });

  it("cleanup only closes created targets", () => {
    const created = new Set(["a", "b", "original"]);
    const original = new Set(["original"]);
    expect(targetsToClose(created, original)).toEqual(["a", "b"]);
  });

  it("allows a Gizmo chat as a navigation candidate without changing quota eligibility", () => {
    const gizmo = { id: "g1", origin: "chat", temporary: false, gizmo: true };
    const personal = { id: "p1", origin: "chat", temporary: false, gizmo: false };
    const work = { id: "w1", origin: "tpp", temporary: false, gizmo: true };
    expect(navigationEligible(gizmo)).toBe(true);
    expect(navigationEligible(personal)).toBe(true);
    expect(navigationEligible(work)).toBe(false);
    expect(quotaEligible(gizmo)).toBe(true);
    expect(quotaEligible(personal)).toBe(true);
    expect(quotaEligible(work)).toBe(false);
  });

  it("treats has_previous_page as a long candidate", () => {
    expect(sampleKindFromProbe({ userCount: 40, hasPreviousPage: true })).toBe("long");
    expect(sampleKindFromProbe({ userCount: 40, hasPreviousPage: false })).toBe("medium");
    expect(sampleKindFromProbe({ userCount: 18, hasPreviousPage: false })).toBe("short");
  });

  it("probes non-gizmo chats before later gizmos", async () => {
    const items = [
      ...Array.from({ length: 50 }, (_, index) => ({ id: `g${index}`, origin: "chat", temporary: false, gizmo: true })),
      { id: "personal", origin: "chat", temporary: false, gizmo: false }
    ];
    const probed = [];
    await discoverFromList(items, {
      maxProbes: 5,
      deadline: Date.now() + 5_000,
      async probe(item) {
        probed.push(item.id);
        return { conversationId: item.id, userCount: 1, hasPreviousPage: false, userIds: ["u"], gizmo: item.gizmo, origin: "chat" };
      },
      async hydrate(sample) { return sample; }
    });
    expect(probed[0]).toBe("personal");
  });

  it("does not full-fetch all 200 conversations during discovery", async () => {
    const items = Array.from({ length: 200 }, (_, index) => ({
      id: `c${index}`,
      origin: "chat",
      temporary: false,
      gizmo: index >= 2,
      updateTime: 200 - index
    }));
    const probed = [];
    const hydrated = [];
    const result = await discoverFromList(items, {
      maxProbes: 80,
      deadline: Date.now() + 5_000,
      async probe(item) {
        probed.push(item.id);
        if (item.id === "c10") {
          return { conversationId: item.id, userCount: 120, hasPreviousPage: true, userIds: ["u0"], gizmo: true, origin: "chat" };
        }
        if (item.id === "c0") {
          return { conversationId: item.id, userCount: 18, hasPreviousPage: false, userIds: ["a"], gizmo: false, origin: "chat", duplicate: { a: "a", b: "b", hash: "x" } };
        }
        if (item.id === "c1") {
          return { conversationId: item.id, userCount: 36, hasPreviousPage: false, userIds: ["m"], gizmo: false, origin: "chat" };
        }
        return { conversationId: item.id, userCount: 8, hasPreviousPage: false, userIds: ["z"], gizmo: true, origin: "chat" };
      },
      async hydrate(sample) {
        hydrated.push(sample.conversationId);
        return {
          conversationId: sample.conversationId,
          turnCount: sample.userCount >= 100 ? 120 : sample.userCount,
          userIds: sample.userCount >= 100 ? Array.from({ length: 120 }, (_, i) => `u${i}`) : sample.userIds,
          duplicate: sample.duplicate
        };
      },
      async validate() { return true; }
    });
    expect(probed.length).toBeGreaterThan(10);
    expect(probed.length).toBeLessThan(200);
    expect(hydrated.length).toBeLessThanOrEqual(8);
    expect(result.discovery.gizmoChats).toBe(198);
    expect(result.discovery.normalChats).toBe(2);
    expect(result.samples.long?.conversationId).toBe("c10");
    expect(result.samples.short?.conversationId).toBe("c0");
    expect(result.samples.medium?.conversationId).toBe("c1");
  });

  it("marks non-Pro meeting accounts as quota live NOT_APPLICABLE", () => {
    expect(classifyPlanType("plus")).toBe("plus");
    expect(quotaLiveStatus("plus")).toBe("NOT_APPLICABLE");
    expect(quotaLiveStatus("free")).toBe("NOT_APPLICABLE");
    expect(quotaLiveStatus("other")).toBe("NOT_APPLICABLE");
    expect(quotaLiveStatus("pro")).toBe("PASS");
  });

  it("missing long sample plus popup fail is overall FAIL", () => {
    expect(overallStatus({
      stages: {
        popup: { status: "FAIL", duration: 1, error: "popup timeout" },
        navLong: { status: "SKIP", duration: 0, error: "missing long sample" },
        quotaUnit: { status: "PASS", duration: 1, error: null }
      },
      missingSamples: ["long"]
    })).toBe("FAIL");
  });

  it("missing long sample with independent stages passing is SETUP_REQUIRED", () => {
    expect(overallStatus({
      stages: {
        popup: { status: "PASS", duration: 1, error: null },
        privacy: { status: "PASS", duration: 1, error: null },
        quotaUnit: { status: "PASS", duration: 1, error: null },
        quotaLive: { status: "NOT_APPLICABLE", duration: 1, error: null },
        navLong: { status: "SKIP", duration: 0, error: "missing long sample" }
      },
      missingSamples: ["long"]
    })).toBe("SETUP_REQUIRED");
  });
});
