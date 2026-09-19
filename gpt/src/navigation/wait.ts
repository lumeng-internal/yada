export function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

export function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "name" in error && (error as { name: string }).name === "AbortError");
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = (): void => {
      window.clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function waitWhileAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortError();
}

export function nextFrame(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const canRaf = typeof requestAnimationFrame === "function";
    const id = canRaf
      ? requestAnimationFrame(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      })
      : window.setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, 16);
    const onAbort = (): void => {
      if (canRaf) cancelAnimationFrame(id);
      else window.clearTimeout(id);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
