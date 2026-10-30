// Scores the AI on test/prompts.json: clip type detected, recipe valid, checker passes on the raw reply.
// Exits 1 when the valid or checker rate falls below these thresholds.
const VALID_MIN = 0.9;
const CHECKER_MIN = 0.7;
// Default: a fake Groq (CI, no network). Live: MOTIKORD_GROQ_KEY=<key> node scripts/score-prompts.mjs --live
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const live = process.argv.includes('--live');
const prompts = JSON.parse(await readFile(new URL('../test/prompts.json', import.meta.url), 'utf8'));

const server = await createServer({ root, configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true } });
let exitCode = 0;
try {
  const { detectType } = await server.ssrLoadModule('/lib/ai/detectType.ts');
  const { writeRecipe } = await server.ssrLoadModule('/lib/ai/writeRecipe.ts');

  const key = live ? process.env.MOTIKORD_GROQ_KEY : 'gsk_test';
  if (!key) throw new Error('Set MOTIKORD_GROQ_KEY for a live run.');
  const opts = { ai: 'cloud', key, fetch: live ? (u, i) => fetch(u, i) : fakeGroq(prompts) };

  const rows = [];
  for (const p of prompts) {
    const row = { id: p.id, want: p.type, got: '-', valid: false, checker: false, note: '' };
    try {
      row.got = (await detectType(p.prompt, { ...opts, settings: {} })).type;
      const out = await writeRecipe({ prompt: p.prompt, type: p.type, aspect: p.aspect, assets: [], id: p.id }, opts);
      row.valid = true;
      row.checker = out.checkerClean;
      row.note = out.notices.join(' ');
    } catch (e) {
      row.note = e?.state ?? e?.code ?? 'error';
    }
    rows.push(row);
  }

  const yes = (b) => (b ? 'yes' : 'no');
  const table = [['prompt', 'type', 'detected', 'valid', 'checker', 'note'], ...rows.map((r) => [r.id, r.want, r.got, yes(r.valid), yes(r.checker), r.note])];
  const widths = table[0].map((_, c) => Math.max(...table.map((r) => String(r[c]).length)));
  for (const r of table) console.log(r.map((v, c) => String(v).padEnd(widths[c])).join('  '));
  const rate = (f) => rows.filter(f).length / rows.length;
  const valid = rate((r) => r.valid);
  const checker = rate((r) => r.checker);
  const detected = rate((r) => r.got === r.want);
  const pct = (x) => `${Math.round(x * 100)}%`;
  console.log(`\n${live ? 'live' : 'fake'} | detected ${pct(detected)} | valid ${pct(valid)} (min ${pct(VALID_MIN)}) | checker ${pct(checker)} (min ${pct(CHECKER_MIN)})`);
  if (valid < VALID_MIN || checker < CHECKER_MIN) exitCode = 1;
} catch (e) {
  console.error('Motikord: could not score prompts', e instanceof Error ? e.message : e);
  exitCode = 1;
} finally {
  await server.close();
}
process.exit(exitCode);

/** A fake Groq that answers like a well-behaved model, so CI checks the pipeline end to end without network. */
function fakeGroq(list) {
  const byPrompt = new Map(list.map((p) => [p.prompt, p]));
  return async (_url, init) => {
    const { messages } = JSON.parse(init.body);
    const system = messages[0].content;
    const p = byPrompt.get(messages[1].content);
    const content = system.startsWith('You sort') ? JSON.stringify({ type: p?.type ?? 'social' }) : JSON.stringify(fakeDraft(p));
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };
}

function fakeDraft(p) {
  const words = (p?.prompt ?? 'Hello').replace(/["“”]/g, '').split(/\s+/);
  const head = words.slice(0, 4).join(' ');
  const text = (id, role, t, y, sizePx) => ({
    id, name: role, type: 'text', role, text: t, font: 'Geist', sizePx, weight: role === 'title' ? 700 : 500, colour: '#FFFFFF',
    align: 'center', lineHeight: 1.15, startMs: 0, endMs: 4000, box: { x: 0.1, y, w: 0.8, h: 0.16 }, opacity: 1,
    in: { preset: 'rise-in', feel: 'smooth', durationMs: 600 }, out: { preset: 'fade-out', feel: 'smooth', durationMs: 400 },
  });
  const second = p?.type === 'chart'
    ? { id: 'c1', name: 'Chart', type: 'chart', chart: 'bar', values: [{ label: 'A', value: 3 }, { label: 'B', value: 5 }], colour: '#F472B6', startMs: 0, endMs: 4000, box: { x: 0.15, y: 0.55, w: 0.7, h: 0.2 }, opacity: 1 }
    : text('t2', 'body', words.slice(4, 7).join(' ') || 'Today', 0.56, 48);
  return { name: head, scenes: [{ id: 's1', durationMs: 4000, background: '#111114', layout: 'center', layers: [text('t1', 'title', head, 0.36, 64), second] }] };
}
