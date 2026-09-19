import { beforeEach } from "vitest";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

const localStore: Record<string, string> = {};
const localStorageMock: Storage = {
  get length() { return Object.keys(localStore).length; },
  clear() { for (const key of Object.keys(localStore)) delete localStore[key]; },
  getItem(key) { return Object.prototype.hasOwnProperty.call(localStore, key) ? localStore[key] : null; },
  setItem(key, value) { localStore[key] = String(value); },
  removeItem(key) { delete localStore[key]; },
  key(index) { return Object.keys(localStore)[index] ?? null; }
};
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: localStorageMock });
if (typeof window !== "undefined") {
  Object.defineProperty(window, "localStorage", { configurable: true, value: localStorageMock });
}

type Store = Record<string, unknown>;
const memory: Store = {};
const listeners = new Set<(changes: Record<string, { newValue?: unknown; oldValue?: unknown }>, area: string) => void>();

const local = {
  async get(keys?: string | string[] | Record<string, unknown>) {
    if (keys == null) return { ...memory };
    const list = Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : Object.keys(keys);
    return Object.fromEntries(list.map((key) => [key, memory[key]]));
  },
  async set(values: Record<string, unknown>) {
    const changes: Record<string, { newValue?: unknown; oldValue?: unknown }> = {};
    for (const [key, value] of Object.entries(values)) {
      changes[key] = { oldValue: memory[key], newValue: value };
      memory[key] = value;
    }
    for (const listener of listeners) listener(changes, "local");
  }
};

const chromeMock = {
  storage: {
    local,
    onChanged: {
      addListener(listener: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void) {
        listeners.add(listener);
      },
      removeListener(listener: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void) {
        listeners.delete(listener);
      }
    }
  },
  runtime: {
    sendMessage: async () => ({}),
    onMessage: { addListener() {}, removeListener() {} }
  },
  action: {
    setIcon: async () => undefined,
    setTitle: async () => undefined
  },
  alarms: {
    create: async () => undefined,
    onAlarm: { addListener() {} }
  },
  tabs: {
    query: async () => [],
    sendMessage: async () => undefined
  }
};

Object.assign(globalThis, { chrome: chromeMock });

beforeEach(() => {
  for (const key of Object.keys(memory)) delete memory[key];
});

const matchMedia = (): MediaQueryList => ({
  matches: false,
  media: "",
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() { return false; }
}) as MediaQueryList;
Object.defineProperty(globalThis, "matchMedia", { configurable: true, writable: true, value: matchMedia });
if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: matchMedia });
}

class MemoryImageData {
  data: Uint8ClampedArray;
  constructor(public width: number, public height: number) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

class MemoryCanvas {
  constructor(public width: number, public height: number) {}
  getContext() {
    return {
      clearRect() {},
      beginPath() {},
      arc() {},
      stroke() {},
      fillText() {},
      drawImage() {},
      putImageData() {},
      getImageData: (sx: number, sy: number, width: number, height: number) => new MemoryImageData(width, height),
      strokeStyle: "",
      fillStyle: "",
      lineWidth: 0,
      lineCap: "round",
      font: "",
      textAlign: "center",
      textBaseline: "middle"
    };
  }
}

if (!(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas) {
  Object.assign(globalThis, { OffscreenCanvas: MemoryCanvas, ImageData: MemoryImageData });
}

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value() {
    return new MemoryCanvas(this.width, this.height).getContext();
  }
});
