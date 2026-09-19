export class GateError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "GateError";
    this.status = status;
  }
}

export function withTimeout(promise, timeoutMs, message = "timeout") {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new Error(message));
  }
  let timer;
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitUntil(predicate, timeoutMs, message, intervalMs = 50) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last) return last;
    const remain = deadline - Date.now();
    if (remain <= 0) break;
    await sleep(Math.min(intervalMs, remain));
  }
  throw new Error(`${message}: ${JSON.stringify(last)}`);
}

export async function holdWhile(predicate, holdMs, message, intervalMs = 50) {
  const end = Date.now() + holdMs;
  while (Date.now() < end) {
    const ok = await predicate();
    if (!ok) throw new Error(message);
    await sleep(Math.min(intervalMs, Math.max(0, end - Date.now())));
  }
}

export const CANDIDATE_DEADLINE_MS = 300_000;
export const CLEANUP_TIMEOUT_MS = 15_000;

export function createStageRunner({ deadlineMs = CANDIDATE_DEADLINE_MS, now = Date.now } = {}) {
  const stages = {};
  const startedAt = now();

  function remaining() {
    return Math.max(0, deadlineMs - (now() - startedAt));
  }

  function skip(name, reason) {
    stages[name] = { status: "SKIP", duration: 0, error: reason || null };
    return stages[name];
  }

  function setStage(name, record) {
    stages[name] = {
      status: record.status,
      duration: record.duration ?? 0,
      error: record.error ?? null
    };
    return stages[name];
  }

  async function runStage(name, timeoutMs, fn, { fatal = false } = {}) {
    const start = now();
    try {
      const budget = remaining();
      if (budget <= 0) throw new GateError("FAIL", "candidate deadline exceeded");
      const result = await withTimeout(Promise.resolve().then(fn), Math.min(timeoutMs, budget), `stage ${name} timeout`);
      const status = result?.status ?? "PASS";
      setStage(name, { status, duration: now() - start, error: result?.error ?? null });
      console.log(`${name}=${status} ${now() - start}ms`);
      if (fatal && status !== "PASS" && status !== "SKIP" && status !== "NOT_APPLICABLE") {
        throw new GateError(
          status === "SETUP_REQUIRED" || status === "BUSY" ? status : "FAIL",
          result?.error || name
        );
      }
      return result;
    } catch (error) {
      const status = error.status === "SETUP_REQUIRED" || error.status === "BUSY" ? error.status : "FAIL";
      if (!stages[name]) setStage(name, { status, duration: now() - start, error: error.message });
      console.log(`${name}=${stages[name].status} ${now() - start}ms`);
      if (fatal || error.status === "BUSY") {
        throw error instanceof GateError ? error : new GateError(status, error.message);
      }
      return { status, error: error.message };
    }
  }

  return { runStage, skip, setStage, stages, startedAt, remaining };
}

export function overallStatus({ stages = {}, missingSamples = [] } = {}) {
  const list = Object.values(stages);
  if (list.some((item) => item.status === "FAIL")) return "FAIL";
  if (list.some((item) => item.status === "BUSY")) return "BUSY";
  if (missingSamples.length || list.some((item) => item.status === "SETUP_REQUIRED")) return "SETUP_REQUIRED";
  return "PASS";
}

export function missingSampleMessage(missing) {
  const labels = {
    long: "100+ 轮真实对话",
    duplicate: "同一对话中有两条相同提问的真实样本",
    short: "12～24 轮测试对话",
    medium: "30～50 轮测试对话"
  };
  const parts = missing.map((key) => labels[key]).filter(Boolean);
  if (!parts.length) return null;
  return `当前会议浏览器 ChatGPT 账号缺少：${parts.join("；")}。`;
}
