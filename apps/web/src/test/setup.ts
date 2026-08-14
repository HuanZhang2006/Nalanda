import { afterEach, vi } from "vitest";
import { setLocale } from "../i18n";

// React 18 uses this flag to verify that stateful tests are wrapped in act().
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

if (typeof window !== "undefined") {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
  const matchMedia = (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    });
  Object.defineProperty(globalThis, "matchMedia", { configurable: true, value: matchMedia });
  Object.defineProperty(window, "matchMedia", { configurable: true, value: matchMedia });
}

const requestAnimationFrameStub = (callback: FrameRequestCallback) => {
  callback(performance.now());
  return 1;
};
const cancelAnimationFrameStub = () => undefined;
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Keep browser primitives outside Vitest's stub registry. Several suites call
// `vi.unstubAllGlobals()` for per-test fetch/crypto mocks; React Flow still
// needs these jsdom shims after that cleanup has run.
Object.defineProperty(globalThis, "requestAnimationFrame", {
  configurable: true,
  value: requestAnimationFrameStub,
});
Object.defineProperty(globalThis, "cancelAnimationFrame", {
  configurable: true,
  value: cancelAnimationFrameStub,
});
Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: ResizeObserverStub,
});
if (typeof window !== "undefined") {
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value: requestAnimationFrameStub,
  });
  Object.defineProperty(window, "cancelAnimationFrame", {
    configurable: true,
    value: cancelAnimationFrameStub,
  });
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    value: ResizeObserverStub,
  });
}

afterEach(() => {
  if (typeof document !== "undefined") {
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("data-rail");
    localStorage.clear();
    setLocale("en", { persist: false });
  }
  vi.useRealTimers();
});
