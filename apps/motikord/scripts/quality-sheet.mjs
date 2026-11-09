// v3 quality sheet: v2's 20 prompts (test/quality/prompts.json) re-run in v3, beside X's 4 references, with score inputs.
// Usage: pnpm quality-sheet [out.html]. The AI step reads GROQ_API_KEY at run time and never prints it.
// With no key the 20-prompt column says "not run (no key)" and the 12 v3 clip templates stand in as the clips.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] ?? fileURLToPath(new URL('../test/quality/sheet-v3.html', import.meta.url));
const key = process.env.GROQ_API_KEY || '';

const req = createRequire(import.meta.url);
const { createServer } = await import(req.resolve('vite', { paths: [req.resolve('wxt')] }));
const server = await createServer({ root, configFile: false, logLevel: 'error', server: { middlewareMode: true }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
const load = (p) => server.ssrLoadModule(p);

const prompts = JSON.parse(await readFile(new URL('../test/quality/prompts.json', import.meta.url), 'utf8'));
const { CLIP_TEMPLATES_V3, clipTemplateV3 } = await load('/lib/templates/v3/clips.ts');

const templates = CLIP_TEMPLATES_V3.map((t) => {
  const clip = clipTemplateV3(t);
  return { name: t.name, type: t.type, pack: t.packId, scenes: clip.scenes.length, seconds: Math.round(t.lengthMs / 100) / 10 };
});

let rows = prompts.map((p) => ({ id: p.id, prompt: p.prompt, type: p.type, state: 'not run (no key)' }));
if (key) {
  const { writeClip } = await load('/lib/ai/writeRecipe.ts');
  const { check } = await load('/lib/checker.ts');
  rows = [];
  for (const p of prompts) {
    try {
      const model = p.model ?? 'openai/gpt-oss-120b';
      const res = await writeClip(
        { prompt: p.prompt, type: p.type, aspect: p.aspect, assets: [], id: p.id, style: p.style, pace: p.pace, critic: false, settings: { ai: 'cloud', provider: 'groq', models: { groq: model } } },
        { ai: 'cloud', provider: 'groq', model, key },
        { frames: async (_r, times) => times.map(() => '') },
      );
      const issues = check(res.recipe).map((i) => i.kind);
      rows.push({ id: p.id, prompt: p.prompt, type: p.type, state: issues.length ? `checker: ${[...new Set(issues)].join(', ')}` : 'made, checker clean' });
    } catch (error) {
      rows.push({ id: p.id, prompt: p.prompt, type: p.type, state: 'could not make' });
      console.error(`Motikord: could not make ${p.id}`, error instanceof Error ? error.message.replaceAll(key, '***') : '');
    }
  }
}
await server.close();

const REFS = [
  ['Ben Marriott', 'The Best Motion Design & Animation of 2026', 'https://www.youtube.com/watch?v=ylXeuDp_8XM'],
  ['Jack Jaeschke', 'Figma Config 2026, rebuilt in Cavalry', 'https://www.youtube.com/watch?v=xsf6mebkmME'],
  ['Figma', 'Introducing Figma Motion', 'https://www.youtube.com/watch?v=l3HuAYXyOTo'],
  ['Dardo', 'A product ad made in code with Remotion', 'https://dardo.studio/en/blog/remotion-video/'],
];
const RUBRIC = ['Type system', 'Timing that follows meaning', 'Depth and light', 'One idea per clip', 'Finish'];
const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const score = (name) => `<td class="s"><input type="number" min="0" max="5" aria-label="${esc(name)}" placeholder="0-5"></td>`;
const post = '<td class="s"><select aria-label="Would you post this?"><option></option><option>Yes</option><option>No</option></select></td>';
const head = `<th>#</th><th>Clip</th><th>Details</th>${RUBRIC.map((r) => `<th>${esc(r)}</th>`).join('')}<th>Would post?</th>`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Motikord v3 quality bar</title><style>
:root{--bg:#fff;--fg:#1a1a1f;--muted:#6b6b76;--line:#e4e4ea;--chip:#f1f1f5}
@media(prefers-color-scheme:dark){:root{--bg:#141418;--fg:#ececf1;--muted:#9a9aa6;--line:#2c2c34;--chip:#23232b}}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,sans-serif}
h1{font-size:22px;margin:0 0 8px}h2{font-size:17px;margin:28px 0 8px}a{color:inherit}.line{color:var(--muted);margin:0 0 12px}
.chip{display:inline-block;background:var(--chip);border-radius:999px;padding:4px 12px;font-weight:600;margin-right:8px}
.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;min-width:860px}th,td{border-bottom:1px solid var(--line);padding:8px 6px;text-align:left;vertical-align:middle}
th{font-size:12px;color:var(--muted)}td.s{width:70px}input,select{width:60px;font:inherit;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:4px;padding:2px 4px}
.refs{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.ref{border:1px solid var(--line);border-radius:8px;padding:12px}
.ref b{display:block}.ref span{color:var(--muted)}.no{color:var(--muted);font-style:italic}
</style></head><body>
<h1>Quality bar v3 · build ${esc(version)} · ${esc(new Date().toISOString().slice(0, 10))}</h1>
<p><span class="chip" id="total">Would post: 0 of 20</span><span class="chip">Pass at 16 of 20</span><span class="chip">${key ? 'AI run: on' : 'AI run: not run (no key)'}</span></p>
<p class="line">Judged side by side with X's 4 references. Their frames are never drawn, copied or shipped; open each link and play it next to the clip.</p>
<div class="refs">${REFS.map(([a, t, u]) => `<div class="ref"><b>${esc(a)}</b><span>${esc(t)}</span><br><a href="${esc(u)}" target="_blank" rel="noopener">Open reference</a></div>`).join('')}</div>
<h2>The 20 prompts, re-run in v3</h2>
<div class="wrap"><table><thead><tr>${head}</tr></thead><tbody>
${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.prompt)}</td><td class="${key ? '' : 'no'}">${esc(r.state)}</td>${RUBRIC.map(score).join('')}${post}</tr>`).join('\n')}
</tbody></table></div>
<h2>The 12 v3 clip templates</h2>
<div class="wrap"><table><thead><tr>${head}</tr></thead><tbody>
${templates.map((t, i) => `<tr><td>${i + 1}</td><td>${esc(t.name)}</td><td>${esc(`${t.type} · ${t.pack} · ${t.scenes} scenes · ${t.seconds} s`)}</td>${RUBRIC.map(score).join('')}${post}</tr>`).join('\n')}
</tbody></table></div>
<script>
const sel=[...document.querySelectorAll('.wrap')[0].querySelectorAll('select')];
const t=document.getElementById('total');const u=()=>{t.textContent='Would post: '+sel.filter(s=>s.value==='Yes').length+' of 20'};
sel.forEach(s=>s.addEventListener('change',u));
</script></body></html>`;
await mkdir(dirname(out), { recursive: true });
await writeFile(out, html);
console.log(`Quality sheet: ${out} (${rows.length} prompts ${key ? 'run' : 'not run, no key'}, ${templates.length} templates)`);
process.exit(0);
