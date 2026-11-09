// Runs the v3 rows of the machine-check page in headless Chromium, under the extension's CSP, and prints them as JSON.
// Usage (after `pnpm build`): node scripts/measure-v3.mjs [seconds of preview]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';

const root = join(import.meta.dirname, '..', '.output', 'chrome-mv3');
const seconds = Number(process.argv[2]) || 10;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff': 'font/woff', '.woff2': 'font/woff2', '.png': 'image/png', '.wav': 'audio/wav', '.wasm': 'application/wasm' };
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const csp = manifest.content_security_policy.extension_pages;

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream', 'content-security-policy': csp }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;

const { chromium } = createRequire(import.meta.url)('playwright');
// No GPU in the sandbox: WebGL2 runs on SwiftShader (software), so these numbers are a floor, not the laptop.
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--enable-precise-memory-info'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => console.error('Motikord: could not run the check page', e));
  page.on('console', (m) => { if (m.type() === 'error') console.error(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/check.html?v3=${seconds}`);
  await page.waitForFunction(() => typeof globalThis.motikordV3 === 'function');
  page.setDefaultTimeout(0);
  // Long runs on software WebGL: show the page's status line every 30 s.
  const progress = setInterval(() => page.textContent('#status').then((t) => console.error(new Date().toISOString(), t), () => {}), 30_000);
  const rows = await page.evaluate(() => globalThis.motikordV3());
  const machine = await page.evaluate(() => ({ cores: navigator.hardwareConcurrency, ua: navigator.userAgent }));
  clearInterval(progress);
  console.log(JSON.stringify({ machine, seconds, csp, rows }, null, 2));
} finally {
  await browser.close();
  server.close();
}
