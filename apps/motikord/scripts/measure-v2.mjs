// Runs the v2 rows of the machine-check page in headless Chromium and prints them as JSON.
// Usage (after `pnpm build`): node scripts/measure-v2.mjs [seconds per preview test]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';

const root = join(import.meta.dirname, '..', '.output', 'chrome-mv3');
const seconds = Number(process.argv[2]) || 10;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.wav': 'audio/wav' };

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;

const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => console.error('Motikord: could not run the check page', e));
  await page.goto(`http://127.0.0.1:${port}/check.html?v2=${seconds}`);
  await page.waitForFunction(() => typeof globalThis.motikordV2 === 'function');
  const rows = await page.evaluate(() => globalThis.motikordV2());
  const machine = await page.evaluate(() => ({ cores: navigator.hardwareConcurrency, ua: navigator.userAgent }));
  console.log(JSON.stringify({ machine, seconds, rows }, null, 2));
} finally {
  await browser.close();
  server.close();
}
