export function createCdpClient(wsUrl) {
  let socket;
  let sequence = 0;
  const pending = new Map();
  const sessions = new Map();

  async function connect() {
    socket = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const callback = pending.get(message.id);
        pending.delete(message.id);
        if (!callback) return;
        message.error ? callback.reject(Object.assign(new Error(message.error.message || "CDP error"), message.error)) : callback.resolve(message.result);
      }
    };
  }

  function call(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
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

  async function attach(targetId) {
    if (sessions.has(targetId)) return sessions.get(targetId);
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    sessions.set(targetId, sessionId);
    await call("Page.enable", {}, sessionId).catch(() => undefined);
    await call("Runtime.enable", {}, sessionId).catch(() => undefined);
    return sessionId;
  }

  async function evaluate(targetId, expression, options = {}) {
    const sessionId = sessions.get(targetId) ?? await attach(targetId);
    const result = await call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: options.awaitPromise !== false,
      ...options
    }, sessionId);
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || result.exceptionDetails.exception?.description || "evaluate failed");
    }
    return result.result?.value;
  }

  async function navigate(targetId, url) {
    const sessionId = sessions.get(targetId) ?? await attach(targetId);
    await call("Page.enable", {}, sessionId);
    await call("Page.navigate", { url }, sessionId);
  }

  async function closeTarget(targetId) {
    sessions.delete(targetId);
    await call("Target.closeTarget", { targetId });
  }

  async function waitForTarget(predicate, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const targets = await listTargets();
      const found = targets.find(predicate);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("Timed out waiting for target");
  }

  function close() {
    socket?.close();
  }

  return { connect, call, listTargets, createTarget, attach, evaluate, navigate, closeTarget, waitForTarget, close };
}

export async function readJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response.json();
}
