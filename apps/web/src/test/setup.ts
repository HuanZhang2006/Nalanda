import { afterEach, vi } from "vitest";

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

vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
  callback(performance.now());
  return 1;
});
vi.stubGlobal("cancelAnimationFrame", vi.fn());

afterEach(() => {
  if (typeof document !== "undefined") {
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("data-rail");
    localStorage.clear();
  }
  vi.useRealTimers();
});
