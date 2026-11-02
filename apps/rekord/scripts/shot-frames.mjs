// Screenshots a design frame and the built screen's dev frame route side by side, for the visual match.
// Usage (from apps/rekord, after `pnpm build`):
//   node scripts/shot-frames.mjs <frame.dc.html> <DevFrame> [outDir] [--size 400x600]
// Writes <outDir>/<DevFrame>.frame.png and <outDir>/<DevFrame>.built.png. Chrome APIs are stubbed in memory.
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const sizeAt = args.indexOf('--size');
const [width, height] = (sizeAt >= 0 ? args.splice(sizeAt, 2)[1] : '400x600').split('x').map(Number);
const [framePath, devFrame, outDir = join(app, 'shots')] = args;
if (!framePath || !devFrame) {
  console.error('Usage: node scripts/shot-frames.mjs <frame.dc.html> <DevFrame> [outDir] [--size 400x600]');
  process.exit(1);
}
const built = join(app, '.output/chrome-mv3');
if (!existsSync(join(built, 'sidepanel.html'))) {
  console.error('No build found: run `pnpm build` in apps/rekord first.');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

// The frames load Geist from Google Fonts; serve the same fonts from the app's own packages instead.
const font = (pkg, file) => readFileSync(join(app, 'node_modules/@fontsource-variable', pkg, 'files', file)).toString('base64');
const fontCss = [['Geist', font('geist', 'geist-latin-wght-normal.woff2')], ['Geist Mono', font('geist-mono', 'geist-mono-latin-wght-normal.woff2')]]
  .map(([family, data]) => `@font-face{font-family:'${family}';font-weight:100 900;font-display:block;src:url(data:font/woff2;base64,${data}) format('woff2')}`)
  .join('\n');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const path = join(built, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!path.startsWith(built) || !existsSync(path) || statSync(path).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
  createReadStream(path).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const manifest = JSON.parse(readFileSync(join(built, 'manifest.json'), 'utf8'));

// In-memory chrome.* for the side panel page; storage changes reach onChanged listeners like the real API.
function stubChrome(version) {
  const listeners = new Set();
  const area = (name) => {
    const data = new Map();
    return {
      get: async (keys) => {
        if (keys == null) return Object.fromEntries(data);
        const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
        return Object.fromEntries(list.filter((k) => data.has(k)).map((k) => [k, structuredClone(data.get(k))]));
      },
      set: async (items) => {
        const changes = {};
        for (const [k, v] of Object.entries(items)) { changes[k] = { oldValue: data.get(k), newValue: structuredClone(v) }; data.set(k, structuredClone(v)); }
        for (const l of listeners) l(changes, name);
      },
      remove: async (keys) => { for (const k of [keys].flat()) data.delete(k); },
      clear: async () => data.clear(),
    };
  };
  const event = () => ({ addListener() {}, removeListener() {}, hasListener: () => false });
  globalThis.chrome = {
    runtime: { id: 'shot-frames', getManifest: () => ({ version }), getURL: (p) => p, sendMessage: async () => undefined, onMessage: event(), connect: () => ({ onMessage: event(), onDisconnect: event(), postMessage() {}, disconnect() {} }) },
    storage: { local: area('local'), session: area('session'), sync: area('sync'), onChanged: { addListener: (l) => listeners.add(l), removeListener: (l) => listeners.delete(l), hasListener: (l) => listeners.has(l) } },
    tabs: { query: async () => [], get: async () => ({}), onActivated: event(), onUpdated: event(), onRemoved: event() },
    permissions: { contains: async () => false, request: async () => false, onAdded: event(), onRemoved: event() },
    action: { setBadgeText: async () => undefined, setBadgeBackgroundColor: async () => undefined },
    identity: { getAuthToken: async () => undefined },
  };
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ contentType: 'text/css', body: fontCss }));
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
  await page.goto(pathToFileURL(resolve(framePath)).href);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const framePng = join(outDir, `${devFrame}.frame.png`);
  await page.screenshot({ path: framePng });

  const panel = await browser.newPage({ viewport: { width, height } });
  panel.on('pageerror', (error) => console.error('page error:', error.message));
  await panel.addInitScript(stubChrome, manifest.version);
  await panel.goto(`${origin}/sidepanel.html#/dev/${devFrame}`);
  await panel.waitForLoadState('networkidle');
  await panel.evaluate(() => document.fonts.ready);
  await panel.waitForTimeout(600);
  const builtPng = join(outDir, `${devFrame}.built.png`);
  await panel.screenshot({ path: builtPng });
  console.log(`${framePng}\n${builtPng}`);
} finally {
  await browser.close();
  server.close();
}
