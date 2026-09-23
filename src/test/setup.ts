import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { vi } from 'vitest';
vi.stubGlobal('crypto', webcrypto);
vi.stubGlobal('navigator', { storage: { estimate: async () => ({ quota: 128 * 1024 * 1024 }) } });
