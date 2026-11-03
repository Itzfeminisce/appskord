import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import prompts from './prompts.json';
import { check } from '../../lib/checker';
import { writeClip } from '../../lib/ai/writeRecipe';
import { replay, tinyFrame, type Recorded } from './replay';

// Runs only for `pnpm quality-sheet`: writes each prompt's recipe and checker issues for scripts/quality-sheet.mjs.
describe.skipIf(!process.env.QUALITY_SHEET)('quality sheet data', () => {
  it('writes the recorded clips and their checker issues', async () => {
    const rows = [];
    for (const r of prompts as Recorded[]) {
      const model = r.model ?? 'openai/gpt-oss-120b';
      const out = await writeClip(
        { prompt: r.prompt, type: r.type, aspect: r.aspect, assets: r.assets ?? [], id: r.id, style: r.style, pace: r.pace, critic: true, settings: { ai: 'cloud', provider: 'groq', models: { groq: model } } },
        { ai: 'cloud', provider: 'groq', model, key: 'gsk_test', fetch: replay(r).fetch },
        { frames: async (_rec, times) => times.map(() => tinyFrame) },
      );
      rows.push({ id: r.id, prompt: r.prompt, type: r.type, aspect: r.aspect, style: r.style, recipe: out.recipe, issues: check(out.recipe).map((i) => i.kind) });
    }
    writeFileSync(process.env.QUALITY_SHEET!, JSON.stringify(rows));
  });
});
