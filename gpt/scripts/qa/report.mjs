import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function writeJsonAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, path);
}

export function emptyReport({ runId, commit, version, startedAt }) {
  return {
    runId,
    commit,
    version,
    startedAt,
    finishedAt: null,
    duration: null,
    timestamp: startedAt,
    check: null,
    build: null,
    fixture: null,
    browser: { product: null, version: null, debuggerPort: 9222 },
    extension: { id: null, temporaryLoaded: false, version: null },
    samples: { short: null, medium: null, long: null, duplicate: null },
    discovery: null,
    live: { short: null, medium: null, long: null, duplicate: null, cancel: null },
    quota: {
      unit: null,
      plan: null,
      livePlanCategory: null,
      liveStatus: null,
      historyStatus: null,
      classifiedTurns: null,
      unclassifiedTurns: null
    },
    popup: null,
    privacy: null,
    zip: { path: null, sha256: null, distMatchesZip: null },
    stages: {},
    cleanup: { createdTargetsClosed: null, temporaryUninstalled: null, originalBrowserUntouched: true },
    overall: null,
    error: null
  };
}
