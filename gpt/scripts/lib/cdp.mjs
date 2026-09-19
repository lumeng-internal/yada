export const DEFAULT_CDP_TIMEOUT_MS = 12_000;

export function createCdpClient(wsUrl, options = {}) {
  const WebSocketImpl = options.WebSocket ?? globalThis.WebSocket;
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_CDP_TIMEOUT_MS;
  let socket;
  let sequence = 0;
  let closed = false;
  const pending = new Map();
  const sessions = new Map();

  function rejectAll(error) {
    const leftover = [...pending.values()];
    pending.clear();
    for (const callback of leftover) callback.reject(error);
  }

  async function connect(timeoutMs = 10_000) {
    socket = new WebSocketImpl(wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP connect timeout")), timeoutMs);
      socket.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(new Error("CDP socket error"));
      };
    });
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (!message.id) return;
      const callback = pending.get(message.id);
      pending.delete(message.id);
      if (!callback) return;
      message.error
        ? callback.reject(Object.assign(new Error(message.error.message || "CDP error"), message.error))
        : callback.resolve(message.result);
    };
    socket.onclose = () => {
      closed = true;
      sessions.clear();
      rejectAll(new Error("CDP socket closed"));
    };
    socket.onerror = () => {
      rejectAll(new Error("CDP socket error"));
    };
  }

  function call(method, params = {}, sessionId, timeoutMs = defaultTimeoutMs) {
    return new Promise((resolve, reject) => {
      if (closed || !socket || socket.readyState !== 1) {
        reject(new Error("CDP socket closed"));
        return;
      }
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      pending.set(id, {
        resolve(value) {
          clearTimeout(timer);
          resolve(value);
        },
        reject(error) {
          clearTimeout(timer);
          reject(error);
        }
      });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  async function listTargets() {
    const { targetInfos } = await call("Target.getTargets");
    return targetInfos ?? [];
  }

  async function createTarget(url) {
    const { targetId } = await call("Target.createTarget", { url });
    return targetId;
  }

  async function attach(targetId, force = false) {
    if (!force && sessions.has(targetId)) return sessions.get(targetId);
    sessions.delete(targetId);
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    sessions.set(targetId, sessionId);
    await call("Page.enable", {}, sessionId).catch(() => undefined);
    await call("Runtime.enable", {}, sessionId).catch(() => undefined);
    return sessionId;
  }

  async function evaluate(targetId, expression, options = {}) {
    const timeoutMs = options.timeoutMs ?? 15_000;
    const evalOptions = { ...options };
    delete evalOptions.timeoutMs;
    const run = async (force) => {
      const sessionId = await attach(targetId, force);
      const result = await call("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: options.awaitPromise !== false,
        ...evalOptions
      }, sessionId, timeoutMs);
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text || result.exceptionDetails.exception?.description || "evaluate failed");
      }
      return result.result?.value;
    };
    try {
      return await run(false);
    } catch (error) {
      const message = String(error.message || error);
      if (/session|inspect|detached|context/i.test(message) && !/timeout/i.test(message)) return run(true);
      throw error;
    }
  }

  async function navigate(targetId, url, timeoutMs = 30_000) {
    const sessionId = sessions.get(targetId) ?? await attach(targetId);
    await call("Page.enable", {}, sessionId, timeoutMs);
    await call("Page.navigate", { url }, sessionId, timeoutMs);
  }

  async function closeTarget(targetId) {
    sessions.delete(targetId);
    await call("Target.closeTarget", { targetId });
  }

  async function waitForTarget(predicate, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const targets = await listTargets();
      const found = targets.find(predicate);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Timed out waiting for target");
  }

  function close() {
    closed = true;
    rejectAll(new Error("CDP closed"));
    sessions.clear();
    try { socket?.close(); } catch { /* already closed */ }
    socket = null;
  }

  return { connect, call, listTargets, createTarget, attach, evaluate, navigate, closeTarget, waitForTarget, close };
}

export async function evaluateFn(cdp, targetId, fn, arg, options = {}) {
  const expression = arg === undefined ? `(${fn})()` : `(${fn})(${JSON.stringify(arg)})`;
  return cdp.evaluate(targetId, expression, options);
}

export async function readJson(url, timeoutMs = 8_000) {
  const response = await Promise.race([
    fetch(url),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${url} timeout`)), timeoutMs))
  ]);
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response.json();
}

export function targetsToClose(createdTargetIds, originalTargetIds) {
  return [...createdTargetIds].filter((id) => !originalTargetIds.has(id));
}
