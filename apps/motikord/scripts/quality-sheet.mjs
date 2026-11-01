// Renders the 20 recorded quality prompts (test/quality/prompts.json) into test/quality/sheet.html:
// the real pipeline runs offline (vitest), frames at 10/35/60/90% are drawn in Playwright Chromium.
// Usage: pnpm quality-sheet
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('..', import.meta.url));
const dataFile = join(await mkdtemp(join(tmpdir(), 'motikord-sheet-')), 'rows.json');
const run = spawnSync('pnpm', ['exec', 'vitest', 'run', 'test/quality/sheet.test.ts'], { cwd: root, env: { ...process.env, QUALITY_SHEET: dataFile }, stdio: 'inherit' });
if (run.status !== 0) process.exit(run.status ?? 1);
const rows = JSON.parse(await readFile(dataFile, 'utf8'));

// vite comes with wxt (not a direct dependency).
const req = createRequire(import.meta.url);
const { build } = await import(req.resolve('vite', { paths: [req.resolve('wxt')] }));
const entry = join(dirname(dataFile), 'entry.ts');
await writeFile(entry, `import { renderFrames } from ${JSON.stringify(join(root, 'lib/render/frames.ts'))}; import { clipDuration } from ${JSON.stringify(join(root, 'lib/render/drawFrame.ts'))}; (window as any).M = { renderFrames, clipDuration };`);
const bundle = await build({
  root, configFile: false, logLevel: 'error',
  build: { write: false, lib: { entry, name: 'M', formats: ['iife'], fileName: 'sheet' } },
});
const code = (Array.isArray(bundle) ? bundle[0] : bundle).output[0].code;

const { chromium } = req('playwright');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');
await page.addScriptTag({ content: code });
const AT = [0.1, 0.35, 0.6, 0.9];
for (const r of rows) {
  r.frames = await page.evaluate(async ({ recipe, aspect, at }) => {
    const total = window.M.clipDuration(recipe);
    return window.M.renderFrames(recipe, at.map((p) => Math.min(total - 1, Math.round(total * p))), { aspect });
  }, { recipe: r.recipe, aspect: r.aspect, at: AT });
}
await browser.close();

const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const date = new Date().toISOString().slice(0, 10);
const RULES = [['Overlap', 'overlap'], ['Crowding', 'crowding'], ['Empty', 'empty'], ['Align', 'align'], ['Words', 'words'], ['Repeat', 'template-repeat']];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pass = rows.filter((r) => r.issues.length === 0).length;
const cap = (s) => s[0].toUpperCase() + s.slice(1).replace(/-/g, ' ');

const body = rows.map((r, i) => `<tr>
<td class="n">${i + 1}</td>
<td class="p">${esc(r.prompt)}</td>
<td class="m">${esc(`${cap(r.type)} · ${r.aspect} · ${cap(r.style)}`)}</td>
<td class="f">${r.frames.map((f, k) => `<img src="${f}" alt="${AT[k] * 100}%" title="${AT[k] * 100}%">`).join('')}</td>
${RULES.map(([, k]) => (r.issues.includes(k) ? '<td class="x" title="fails">&#10007;</td>' : '<td class="t" title="passes">&#10003;</td>')).join('')}
<td class="w"></td></tr>`).join('\n');

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Motikord quality bar</title><style>
:root{--bg:#fff;--fg:#1a1a1f;--muted:#6b6b76;--line:#e4e4ea;--ok:#188a4a;--bad:#c62f2f;--chip:#f1f1f5}
@media(prefers-color-scheme:dark){:root{--bg:#141418;--fg:#ececf1;--muted:#9a9aa6;--line:#2c2c34;--ok:#4cc382;--bad:#ef6b6b;--chip:#23232b}}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,sans-serif}
h1{font-size:20px;margin:0 0 12px}.chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}.chip{background:var(--chip);border-radius:999px;padding:4px 12px;font-weight:600}
.line{color:var(--muted);margin:0 0 16px}.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;min-width:900px}
th,td{border-bottom:1px solid var(--line);padding:8px 6px;vertical-align:middle;text-align:left}th{font-size:12px;color:var(--muted)}
td.n{color:var(--muted)}td.p{min-width:200px;max-width:260px}td.m{color:var(--muted);white-space:nowrap}td.f{white-space:nowrap}td.f img{height:110px;margin-right:4px;border-radius:4px;border:1px solid var(--line)}
td.t,td.x{text-align:center;font-weight:700}td.t{color:var(--ok)}td.x{color:var(--bad)}td.w{min-width:90px;border-left:1px dashed var(--line)}
</style></head><body>
<h1>Quality bar · run ${esc(date)} · build ${esc(version)}</h1>
<div class="chips"><span class="chip">Checker: ${pass} of 20 pass</span><span class="chip">X: — of 20 would post</span></div>
<p class="line">Pass: all 20 pass the checker and at least 16 would post</p>
<div class="wrap"><table><thead><tr><th>#</th><th>Prompt</th><th>Clip type · size · style</th><th>10% · 35% · 60% · 90%</th>${RULES.map(([n]) => `<th>${n}</th>`).join('')}<th>Would post?</th></tr></thead><tbody>
${body}
</tbody></table></div></body></html>`;
const out = fileURLToPath(new URL('../test/quality/sheet.html', import.meta.url));
await writeFile(out, html);
console.log(`Checker: ${pass} of ${rows.length} pass. Sheet: ${out}`);
