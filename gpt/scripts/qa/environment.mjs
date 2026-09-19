import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCdpClient, readJson } from "../lib/cdp.mjs";
import { pidAlive } from "./lock.mjs";
import { GateError } from "./runner.mjs";

const CDP_ORIGIN = "http://127.0.0.1:9222";

export function runNpm(root, script) {
  const result = spawnSync("npm", ["run", script], { cwd: root, stdio: "inherit", shell: false });
  if (result.status !== 0) throw new Error(`npm run ${script} failed`);
  return { status: "PASS" };
}

export function meetingBusy() {
  const locks = [
    resolve("/Volumes/AutomationData/10_Workspace/Codex/meeting-organizer-2/runtime/.meeting-organizer-2/v3.3/run.lock"),
    resolve("/Volumes/AutomationData/20_Codex/meeting-organizer-2/runtime/.meeting-organizer-2/v3.3/run.lock")
  ];
  for (const file of locks) {
    if (!existsSync(file)) continue;
    try {
      const lock = JSON.parse(readFileSync(file, "utf8"));
      if (pidAlive(lock.pid)) return true;
    } catch {
      return true;
    }
  }
  const heartbeats = [
    resolve("/Volumes/AutomationData/10_Workspace/Codex/course-gpt-batch-runner/data/iflyrec_course_asset_collector/data/downloads/.meeting-organizer-2/v3.3/heartbeat.json"),
    resolve("/Volumes/AutomationData/10_Workspace/Codex/course-gpt-batch-runner/runtime/runs/background/heartbeat.json")
  ];
  for (const file of heartbeats) {
    if (!existsSync(file)) continue;
    try {
      const beat = JSON.parse(readFileSync(file, "utf8"));
      const stage = String(beat.stage || beat.currentStage || "").toUpperCase();
      if (!pidAlive(beat.pid)) continue;
      if (stage && stage !== "CLOSED" && stage !== "COMPLETED") return true;
    } catch {
      continue;
    }
  }
  return false;
}

export async function connectMeetingBrowser(originalTargetIds) {
  let versionInfo;
  try {
    versionInfo = await readJson(`${CDP_ORIGIN}/json/version`);
  } catch {
    throw new GateError("SETUP_REQUIRED", "会议浏览器当前没有运行，请先启动现有会议浏览器。");
  }
  const cdp = createCdpClient(versionInfo.webSocketDebuggerUrl);
  await cdp.connect();
  const browserVersion = await cdp.call("Browser.getVersion");
  const product = `${browserVersion.product || versionInfo.Browser} ${versionInfo["User-Agent"] || ""}`;
  if (!/Chrome/i.test(product)) {
    throw new GateError("SETUP_REQUIRED", "9222 不是预期的会议 Chrome / Chrome for Testing。");
  }
  const existing = await cdp.listTargets();
  if (!existing.length) throw new GateError("SETUP_REQUIRED", "会议浏览器当前没有运行，请先启动现有会议浏览器。");
  for (const target of existing) originalTargetIds.add(target.targetId);
  return {
    status: "PASS",
    cdp,
    browser: {
      product: browserVersion.product || versionInfo.Browser,
      version: String(browserVersion.product || versionInfo.Browser || "").replace(/^.*\//, ""),
      debuggerPort: 9222
    }
  };
}
