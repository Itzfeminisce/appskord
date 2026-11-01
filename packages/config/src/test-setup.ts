import 'fake-indexeddb/auto';
import { vi } from 'vitest';

// A minimal `chrome` stub for code that touches it at import time; a test that needs more stubs it itself.
const local = new Map<string, unknown>();
const storageArea = {
  get: vi.fn(async (key?: string) => (key === undefined ? Object.fromEntries(local) : { [key]: local.get(key) })),
  set: vi.fn(async (items: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(items)) local.set(k, v);
  }),
  remove: vi.fn(async (key: string) => void local.delete(key)),
};

const event = () => ({ addListener: vi.fn(), removeListener: vi.fn(), hasListener: vi.fn(() => false) });

vi.stubGlobal('chrome', {
  runtime: {
    id: 'test-extension-id',
    sendMessage: vi.fn(),
    onMessage: event(),
    getURL: (p: string) => `chrome-extension://test-extension-id/${p}`,
  },
  storage: { local: storageArea, session: storageArea, onChanged: event() },
  permissions: { contains: vi.fn(async () => false), request: vi.fn(async () => false) },
});
