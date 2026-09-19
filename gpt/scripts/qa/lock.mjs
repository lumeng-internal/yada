import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { GateError } from "./runner.mjs";

export function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireCandidateLock(lockPath, options = {}) {
  const pid = options.pid ?? process.pid;
  const commit = options.commit ?? null;
  const startedAt = options.startedAt ?? new Date().toISOString();
  const alive = options.pidAlive ?? pidAlive;
  mkdirSync(dirname(lockPath), { recursive: true });

  if (existsSync(lockPath)) {
    let existing = null;
    try {
      existing = JSON.parse(readFileSync(lockPath, "utf8"));
    } catch {
      existing = null;
    }
    if (existing && alive(existing.pid)) {
      throw new GateError("BUSY", `已有 candidate 正在运行 pid=${existing.pid}`);
    }
    try { unlinkSync(lockPath); } catch { /* stale */ }
  }

  const payload = { pid, startedAt, commit };
  try {
    writeFileSync(lockPath, `${JSON.stringify(payload)}\n`, { flag: "wx" });
  } catch {
    throw new GateError("BUSY", "已有 candidate 正在运行");
  }

  return function release() {
    try {
      if (!existsSync(lockPath)) return;
      const current = JSON.parse(readFileSync(lockPath, "utf8"));
      if (current.pid !== pid) return;
      unlinkSync(lockPath);
    } catch {
      /* lock already gone */
    }
  };
}
