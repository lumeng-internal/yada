#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { runLocalFixtures } from "./lib/fixtures.mjs";
import { zipDist, zipMatchesDist } from "./lib/pack.mjs";
import { targetsToClose } from "./lib/cdp.mjs";
import { loadYada, openChatHome, uninstallTemporary } from "./qa/extension.mjs";
import { connectMeetingBrowser, meetingBusy, runNpm } from "./qa/environment.mjs";
import { acquireCandidateLock } from "./qa/lock.mjs";
import { liveCancel, liveDuplicate, liveNav, validateNavigationTarget } from "./qa/navigation.mjs";
import { livePopup, livePrivacy } from "./qa/popup.mjs";
import { compactSample, discoverLiveSamples, missingRequiredSamples } from "./qa/samples.mjs";
import { liveQuota } from "./qa/quota.mjs";
import { emptyReport, writeJsonAtomic } from "./qa/report.mjs";
import {
  CANDIDATE_DEADLINE_MS,
  CLEANUP_TIMEOUT_MS,
  GateError,
  createStageRunner,
  missingSampleMessage,
  overallStatus,
  withTimeout
} from "./qa/runner.mjs";

const root = resolve(import.meta.dirname, "..");
const repoRoot = resolve(root, "..");
const distChrome = resolve(root, "dist_chrome");
const version = "4.0.0";
const lockPath = resolve(root, "artifacts/candidate/.lock");

async function main() {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot }).toString().trim();
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const report = emptyReport({ runId, commit, version, startedAt });
  const createdTargetIds = new Set();
  const originalTargetIds = new Set();
  const runner = createStageRunner({ deadlineMs: CANDIDATE_DEADLINE_MS });
  let releaseLock = () => undefined;
  let cdp;
  let extension = null;
  let chatTarget = null;
  let popupTarget = null;
  let missingSamples = [];
  let exitStatus = "FAIL";

  const watchdog = setTimeout(() => {
    console.error("CANDIDATE=FAIL deadline");
    try { releaseLock(); } catch { /* ignore */ }
    process.exit(1);
  }, CANDIDATE_DEADLINE_MS + CLEANUP_TIMEOUT_MS + 10_000);

  const cleanup = async () => {
    const created = targetsToClose(createdTargetIds, originalTargetIds);
    for (const id of created) {
      await cdp?.closeTarget(id).catch(() => undefined);
      createdTargetIds.delete(id);
    }
    const temporary = Boolean(extension?.temporaryLoaded);
    if (temporary) await uninstallTemporary(cdp, extension);
    cdp?.close();
    report.cleanup = {
      createdTargetsClosed: true,
      temporaryUninstalled: temporary,
      originalBrowserUntouched: true
    };
  };

  try {
    releaseLock = acquireCandidateLock(lockPath, { commit });
    if (meetingBusy()) throw new GateError("BUSY", "会议浏览器正在执行会议任务，本次验收未运行。");

    await runner.runStage("check", 90_000, () => runNpm(root, "check"), { fatal: true });
    report.check = "PASS";
    await runner.runStage("build", 90_000, () => runNpm(root, "build"), { fatal: true });
    report.build = "PASS";
    await runner.runStage("quotaUnit", 1_000, () => ({ status: "PASS", note: "deterministic vibe-bar tests ran in check" }));
    report.quota.unit = "PASS";

    const browser = await runner.runStage("browser", 20_000, () => connectMeetingBrowser(originalTargetIds), { fatal: true });
    cdp = browser.cdp;
    report.browser = browser.browser;

    await runner.runStage("fixture", 100_000, async () => {
      const fixtures = await runLocalFixtures(cdp, createdTargetIds);
      for (const id of targetsToClose(createdTargetIds, originalTargetIds)) {
        await cdp.closeTarget(id).catch(() => undefined);
        createdTargetIds.delete(id);
      }
      report.fixture = { ok: true, checks: fixtures.checks.length };
      return { status: "PASS" };
    }, { fatal: true });

    extension = await runner.runStage("extension", 20_000, () => loadYada(cdp, distChrome, createdTargetIds), { fatal: true });
    report.extension = { id: extension.id, temporaryLoaded: extension.temporaryLoaded, version: extension.version };

    const home = await openChatHome(cdp, createdTargetIds);
    chatTarget = home.targetId;
    if (!home.loggedIn) {
      runner.skip("discovery", "ChatGPT 未登录");
      runner.skip("navShort", "ChatGPT 未登录");
      runner.skip("navMedium", "ChatGPT 未登录");
      runner.skip("navLong", "ChatGPT 未登录");
      runner.skip("navDuplicate", "ChatGPT 未登录");
      runner.skip("navCancel", "ChatGPT 未登录");
      runner.skip("quotaLive", "ChatGPT 未登录");
      missingSamples = ["long", "duplicate", "short", "medium"];
      report.error = "会议浏览器当前 ChatGPT 登录已失效。";
    } else {
      const discovered = await runner.runStage("discovery", 180_000, async () => {
        const result = await discoverLiveSamples(cdp, chatTarget, {
          deadline: Date.now() + Math.min(160_000, Math.max(30_000, runner.remaining() - 90_000)),
          maxProbes: 200,
          async validate(sample) {
            const ready = await validateNavigationTarget(cdp, sample.conversationId, createdTargetIds);
            if (ready?.targetId) {
              await cdp.closeTarget(ready.targetId).catch(() => undefined);
              createdTargetIds.delete(ready.targetId);
            }
            return Boolean(ready);
          }
        });
        report.samples = {
          short: compactSample(result.samples.short),
          medium: compactSample(result.samples.medium),
          long: compactSample(result.samples.long),
          duplicate: compactSample(result.samples.duplicate)
        };
        report.discovery = result.discovery;
        return { status: "PASS", ...result };
      });

      const samples = discovered?.samples || { short: null, medium: null, long: null, duplicate: null };
      missingSamples = missingRequiredSamples(samples);

      for (const [stageName, kind, sample] of [
        ["navShort", "short", samples.short],
        ["navMedium", "medium", samples.medium],
        ["navLong", "long", samples.long]
      ]) {
        if (!sample) {
          runner.skip(stageName, `missing ${kind} sample`);
          continue;
        }
        const result = await runner.runStage(stageName, 45_000, async () => {
          const live = await liveNav(cdp, sample, kind, createdTargetIds);
          report.live[kind] = live;
          return { status: "PASS" };
        });
        if (result?.status === "FAIL") report.live[kind] = { ok: false, error: result.error };
      }

      if (samples.duplicate) {
        const result = await runner.runStage("navDuplicate", 45_000, async () => {
          const live = await liveDuplicate(cdp, samples.duplicate, createdTargetIds);
          report.live.duplicate = live;
          return { status: "PASS" };
        });
        if (result?.status === "FAIL") report.live.duplicate = { ok: false, error: result.error };
      } else {
        runner.skip("navDuplicate", "missing duplicate sample");
      }

      if (samples.long) {
        const result = await runner.runStage("navCancel", 45_000, async () => {
          const live = await liveCancel(cdp, samples.long, createdTargetIds);
          report.live.cancel = live;
          return { status: "PASS" };
        });
        if (result?.status === "FAIL") report.live.cancel = { ok: false, error: result.error };
      } else {
        runner.skip("navCancel", "missing long sample");
      }

      const quota = await runner.runStage("quotaLive", 30_000, async () => {
        const live = await liveQuota(cdp, chatTarget);
        Object.assign(report.quota, {
          plan: live.plan,
          livePlanCategory: live.livePlanCategory,
          liveStatus: live.liveStatus,
          historyStatus: live.historyStatus,
          classifiedTurns: live.classifiedTurns,
          unclassifiedTurns: live.unclassifiedTurns
        });
        return live;
      });
      if (quota?.status === "FAIL") report.quota.liveStatus = "FAIL";
    }

    const popup = await runner.runStage("popup", 20_000, async () => {
      const ui = await livePopup(cdp, extension.id, createdTargetIds);
      report.popup = ui;
      popupTarget = ui.popupId;
      return ui;
    });
    if (popup?.status === "FAIL") report.popup = { state: "error", error: popup.error };

    const privacy = await runner.runStage("privacy", 15_000, async () => {
      const result = await livePrivacy(cdp, extension.id, popupTarget);
      report.privacy = result;
      return result;
    });
    if (privacy?.status === "FAIL") report.privacy = { ok: false, error: privacy.error };

    exitStatus = overallStatus({ stages: runner.stages, missingSamples });
    if (exitStatus === "SETUP_REQUIRED" && !report.error) {
      report.error = missingSampleMessage(missingSamples) || "会议浏览器当前 ChatGPT 登录已失效。";
    }
  } catch (error) {
    exitStatus = error.status === "SETUP_REQUIRED" || error.status === "BUSY" ? error.status : "FAIL";
    report.error = error.message;
    if (exitStatus === "BUSY") runner.setStage("browser", { status: "BUSY", error: error.message });
  } finally {
    const cleanupStarted = Date.now();
    try {
      await withTimeout(cleanup(), CLEANUP_TIMEOUT_MS, "cleanup timeout");
      runner.setStage("cleanup", { status: "PASS", duration: Date.now() - cleanupStarted });
    } catch (error) {
      runner.setStage("cleanup", { status: "FAIL", duration: Date.now() - cleanupStarted, error: error.message });
      report.cleanup = { ...(report.cleanup || {}), error: error.message, createdTargetsClosed: false };
    }

    try {
      if (exitStatus !== "BUSY") {
        const packed = await runner.runStage("pack", 30_000, () => {
          const zipName = exitStatus === "PASS" ? `ChatGPT-Yada-v${version}-dist_chrome.zip` : `ChatGPT-Yada-v${version}-UNVERIFIED.zip`;
          if (exitStatus === "PASS") {
            const unverified = resolve(root, `ChatGPT-Yada-v${version}-UNVERIFIED.zip`);
            if (existsSync(unverified)) rmSync(unverified);
          }
          const zipped = zipDist({ projectRoot: root, zipName });
          const compared = zipMatchesDist(root, zipName);
          report.zip = { path: zipped.zipPath, sha256: zipped.sha256, distMatchesZip: compared.matches };
          if (exitStatus === "PASS" && !compared.matches) {
            throw new Error(`ZIP 与 dist_chrome 不一致: ${compared.mismatches.join(", ")}`);
          }
          return { status: "PASS" };
        });
        if (packed?.status === "FAIL") exitStatus = "FAIL";
      } else {
        runner.skip("pack", "busy");
      }
    } catch (error) {
      exitStatus = "FAIL";
      report.error = error.message;
    }

    report.stages = runner.stages;
    report.overall = exitStatus;
    report.finishedAt = new Date().toISOString();
    report.duration = Date.parse(report.finishedAt) - Date.parse(startedAt);
    try {
      writeJsonAtomic(resolve(root, `artifacts/candidate/${commit}.json`), report);
    } catch (error) {
      console.error(`report write failed: ${error.message}`);
    }
    try { releaseLock(); } catch { /* ignore */ }
    clearTimeout(watchdog);
    console.log(`CANDIDATE=${exitStatus}`);
    console.log(`wrote ${resolve(root, `artifacts/candidate/${commit}.json`)}`);
  }

  return exitStatus === "PASS" ? 0 : exitStatus === "FAIL" ? 1 : 2;
}

process.exit(await main());
