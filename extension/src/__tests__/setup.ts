import { vi, beforeEach } from "vitest";
import "@testing-library/jest-dom";

// Shared in-memory storage, mutated in place so closures always see current state
const storage: Record<string, unknown> = {};

function clearStorage() {
  for (const key of Object.keys(storage)) {
    delete storage[key];
  }
}

// Prevent jsdom from actually destroying the document on window.close()
vi.stubGlobal("close", vi.fn());

vi.stubGlobal("chrome", {
  storage: {
    local: {
      get: vi.fn(async (keys?: string | string[]) => {
        if (!keys) return { ...storage };
        const ks = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(ks.map((k) => [k, storage[k]]));
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(storage, items);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete storage[k]);
      }),
    },
  },
  runtime: {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    getURL: vi.fn(
      (path: string) => `chrome-extension://test-extension-id/${path}`
    ),
  },
  tabs: {
    create: vi.fn().mockResolvedValue({ id: 1 }),
  },
  history: {
    onVisited: { addListener: vi.fn() },
    search: vi.fn().mockResolvedValue([]),
  },
  alarms: {
    create: vi.fn(),
    onAlarm: { addListener: vi.fn() },
  },
});

beforeEach(() => {
  clearStorage();
  vi.clearAllMocks();
});
