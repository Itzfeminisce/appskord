import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('side panel v3 screens', () => {
  it('import nothing from @appskord/motion but types, so three.js stays out of the panel', () => {
    const dir = new URL('.', import.meta.url);
    const files = readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('.test.'));
    expect(files.length).toBeGreaterThan(8);
    for (const f of files) {
      const bad = readFileSync(new URL(f, dir), 'utf8').split('\n').filter((l) => /^import\s+(?!type\b).*@appskord\/motion/.test(l));
      expect(bad, f).toEqual([]);
    }
  });
});
