import { classifyElement, extractPick, hoverLabel, pickedLabel, squash, type ElementInfo, type PageInfo, type Pick, type PickKind } from '../lib/grab/pick';
import { onMessage, send } from '../lib/messages';

// Put on the page only when you press "Grab from this page" (activeTab + scripting); never a static content script.
const BAR_TEXT = 'Click a headline, image, logo, quote or table';
const ESC_TEXT = 'Press Esc to stop picking';
const MAX_IMAGE_BYTES = 12_000_000;
const SLOT = '__motikordGrab';

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: Geist, system-ui, -apple-system, 'Segoe UI', sans-serif; }
.root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; }
.box { position: fixed; border-radius: 2px; pointer-events: none; }
.hover { outline: 2px dashed #F472B6; outline-offset: 6px; background: rgba(244,114,182,0.08); }
.picked { outline: 2px solid #BE185D; outline-offset: 6px; }
.tag { position: fixed; height: 24px; padding: 0 8px; border-radius: 6px; font-size: 12px; display: flex; align-items: center; gap: 6px; white-space: nowrap; color: #FFFFFF; pointer-events: none; }
.tag.hover { background: #111114; font-weight: 500; outline: 0; }
.tag.picked { background: #BE185D; font-weight: 600; outline: 0; }
.badge { position: fixed; width: 22px; height: 22px; border-radius: 50%; background: #BE185D; display: grid; place-items: center; pointer-events: none; }
.bar { position: fixed; bottom: 44px; left: 50%; transform: translateX(-50%); width: min(580px, calc(100vw - 24px)); height: 48px; border-radius: 14px; background: #111114; color: #FFFFFF; display: flex; align-items: center; gap: 12px; padding: 0 8px 0 16px; box-shadow: 0 8px 24px rgba(16,16,20,0.25); pointer-events: auto; }
.bar span.msg { font-size: 13px; flex-grow: 1; }
.bar span.count { font-family: 'Geist Mono', ui-monospace, monospace; font-size: 12px; color: #A1A1AA; white-space: nowrap; }
.bar button { height: 34px; padding: 0 12px; border: 0; border-radius: 9px; background: transparent; color: #E4E4E7; font-size: 13px; font-weight: 500; cursor: pointer; }
.bar button.done { padding: 0 14px; background: #BE185D; color: #FFFFFF; font-weight: 600; }
.esc { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); width: 300px; text-align: center; font-size: 12px; color: #111114; text-shadow: 0 0 4px #FFFFFF; pointer-events: none; }
`;

const CHECK = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const CURSOR = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F9A8D4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4l7 17 2.5-7.5L21 11z"/></svg>';

function describe(el: Element): ElementInfo {
  const rect = el.getBoundingClientRect();
  const img = el instanceof HTMLImageElement ? el : undefined;
  const table = el instanceof HTMLTableElement ? el : undefined;
  const hint = [img?.alt, el.getAttribute('aria-label'), el.id, el.getAttribute('class'), img?.currentSrc || img?.src, el.closest('a')?.getAttribute('aria-label'), el.closest('a')?.getAttribute('class')].filter(Boolean).join(' ');
  return {
    tag: el.tagName.toLowerCase(), role: el.getAttribute('role') ?? undefined,
    text: table ? '' : (el as HTMLElement).innerText ?? el.textContent ?? '',
    childElements: el.childElementCount, hint, insideHeader: !!el.closest('header, nav, [role="banner"]'),
    width: rect.width, height: rect.height, src: img?.currentSrc || img?.src || undefined, alt: img?.alt || el.getAttribute('aria-label') || undefined,
    rows: table ? Array.from(table.rows).map((r) => Array.from(r.cells).map((c) => c.innerText)) : undefined,
    caption: table?.caption?.innerText,
  };
}

/** The nearest thing worth picking at or above the element; a headline, quote, picture or table beats plain text around it. */
function resolve(start: Element): { el: Element; kind: PickKind; info: ElementInfo } | undefined {
  let firstText: { el: Element; kind: PickKind; info: ElementInfo } | undefined;
  let n: Element | null = start;
  for (let depth = 0; n && depth < 5 && n !== document.body && n !== document.documentElement; depth++, n = n.parentElement) {
    const info = describe(n);
    const kind = classifyElement(info);
    if (!kind) continue;
    if (kind !== 'text') return { el: n, kind, info };
    firstText ??= { el: n, kind, info };
  }
  return firstText;
}

function pageInfo(): PageInfo {
  const meta = document.querySelector<HTMLMetaElement>('meta[property="og:site_name"]')?.content;
  const licence = document.querySelector<HTMLLinkElement>('link[rel~="license"]')?.href;
  return { title: squash(document.title), url: location.href, site: squash(meta ?? '') || location.hostname.replace(/^www\./, ''), licenceHref: licence || undefined };
}

const toDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

/** Reads the picture's bytes inside the page, where its cookies and CORS apply. */
async function readPicture(el: Element, src: string | undefined): Promise<string> {
  if (el instanceof SVGElement) {
    const xml = new XMLSerializer().serializeToString(el);
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(xml)))}`;
  }
  if (src?.startsWith('data:')) return src;
  try {
    if (!src) throw new Error('no source');
    const blob = await (await fetch(src)).blob();
    if (!blob.type.startsWith('image/') || blob.size > MAX_IMAGE_BYTES) throw new Error('not a usable image');
    return await toDataUrl(blob);
  } catch (fetchError) {
    // A picture the page drew itself can still be copied through a canvas when it is not cross-origin.
    if (el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0) {
      const canvas = document.createElement('canvas');
      canvas.width = el.naturalWidth;
      canvas.height = el.naturalHeight;
      canvas.getContext('2d')?.drawImage(el, 0, 0);
      return canvas.toDataURL('image/png');
    }
    throw fetchError;
  }
}

interface Mark { pick: Pick; el: Element; box: HTMLElement; tag: HTMLElement; badge: HTMLElement; reading?: Promise<void> }

function start(): () => void {
  const host = document.createElement('motikord-grab');
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = CSS;
  const root = document.createElement('div');
  root.className = 'root';
  shadow.append(style, root);

  const hoverBox = Object.assign(document.createElement('div'), { className: 'box hover' });
  const hoverTag = Object.assign(document.createElement('div'), { className: 'tag hover' });
  hoverBox.hidden = hoverTag.hidden = true;

  const bar = document.createElement('div');
  bar.className = 'bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Grab from the page');
  bar.innerHTML = `${CURSOR}<span class="msg"></span><span class="count"></span><button type="button" class="cancel">Cancel</button><button type="button" class="done">Done</button>`;
  (bar.querySelector('.msg') as HTMLElement).textContent = BAR_TEXT;
  const count = bar.querySelector('.count') as HTMLElement;
  const esc = Object.assign(document.createElement('div'), { className: 'esc', textContent: ESC_TEXT });
  root.append(hoverBox, hoverTag, bar, esc);
  document.documentElement.append(host);

  const marks = new Map<Element, Mark>();
  let hovered: { el: Element; kind: PickKind } | undefined;
  let counter = 0;
  let stopped = false;

  const place = (box: HTMLElement, tag: HTMLElement, el: Element) => {
    const r = el.getBoundingClientRect();
    const visible = r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    box.hidden = tag.hidden = !visible;
    Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    Object.assign(tag.style, { left: `${Math.max(4, r.left - 6)}px`, top: `${Math.max(4, r.top - 36)}px` });
  };
  const layout = () => {
    if (hovered) place(hoverBox, hoverTag, hovered.el);
    for (const m of marks.values()) {
      place(m.box, m.tag, m.el);
      const r = m.el.getBoundingClientRect();
      Object.assign(m.badge.style, { left: `${r.right + 3}px`, top: `${r.top - 25}px` });
      m.badge.hidden = m.box.hidden;
    }
  };
  let frame = 0;
  const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(layout); };

  const picks = () => [...marks.values()].map((m) => m.pick);
  const report = (done = false) => {
    count.textContent = `${marks.size} picked`;
    void send({ type: 'grab/picks', picks: picks(), page: pageInfo(), done });
  };

  const unmark = (el: Element) => {
    const m = marks.get(el);
    if (!m) return;
    m.box.remove(); m.tag.remove(); m.badge.remove();
    marks.delete(el);
  };

  function toggle(target: { el: Element; kind: PickKind; info: ElementInfo }) {
    if (marks.has(target.el)) { unmark(target.el); report(); schedule(); return; }
    const pick = extractPick(target.info, target.kind, `p${++counter}`);
    const box = Object.assign(document.createElement('div'), { className: 'box picked' });
    const tag = Object.assign(document.createElement('div'), { className: 'tag picked', textContent: pickedLabel(target.kind) });
    const badge = Object.assign(document.createElement('div'), { className: 'badge', innerHTML: CHECK });
    root.append(box, tag, badge);
    const mark: Mark = { pick, el: target.el, box, tag, badge };
    marks.set(target.el, mark);
    if (target.kind === 'image' || target.kind === 'logo') {
      mark.reading = readPicture(target.el, target.info.src)
        .then((dataUrl) => { pick.dataUrl = dataUrl; pick.mime = /^data:([^;,]+)/.exec(dataUrl)?.[1]; })
        .catch((error: unknown) => { pick.failed = true; console.error('Motikord: could not read this picture', error); })
        .finally(() => { if (!stopped) report(); });
    }
    if (hovered?.el === target.el) { hoverBox.hidden = hoverTag.hidden = true; }
    report(); schedule();
  }

  const inside = (e: Event) => e.target === host;
  const onMove = (e: MouseEvent) => {
    if (inside(e)) return;
    const target = e.target instanceof Element ? resolve(e.target) : undefined;
    if (!target || marks.has(target.el)) { hovered = undefined; hoverBox.hidden = hoverTag.hidden = true; return; }
    if (hovered?.el !== target.el) { hovered = { el: target.el, kind: target.kind }; hoverTag.textContent = hoverLabel(target.kind); }
    layout();
  };
  const onClick = (e: MouseEvent) => {
    if (inside(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const target = e.target instanceof Element ? resolve(e.target) : undefined;
    if (target) toggle(target);
  };
  const swallow = (e: Event) => { if (!inside(e)) e.stopImmediatePropagation(); };

  async function finish(kind: 'done' | 'cancel') {
    if (stopped) return;
    if (kind === 'done') {
      await Promise.all([...marks.values()].map((m) => m.reading));
      report(true);
    } else void send({ type: 'grab/cancel' });
    teardown();
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault(); e.stopImmediatePropagation();
    void finish('done');
  };

  bar.querySelector('.cancel')!.addEventListener('click', () => void finish('cancel'));
  bar.querySelector('.done')!.addEventListener('click', () => void finish('done'));
  const stopListening = onMessage({
    'grab/remove': (msg) => { for (const [el, m] of marks) if (m.pick.id === msg.id) { unmark(el); count.textContent = `${marks.size} picked`; schedule(); } },
    'grab/stop': () => teardown(),
  });

  const opts = { capture: true } as const;
  addEventListener('mousemove', onMove, opts);
  addEventListener('click', onClick, opts);
  for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick', 'dblclick', 'contextmenu'] as const) addEventListener(type, swallow, opts);
  addEventListener('keydown', onKey, opts);
  addEventListener('scroll', schedule, opts);
  addEventListener('resize', schedule);
  count.textContent = '0 picked';

  function teardown() {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    removeEventListener('mousemove', onMove, opts);
    removeEventListener('click', onClick, opts);
    for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick', 'dblclick', 'contextmenu'] as const) removeEventListener(type, swallow, opts);
    removeEventListener('keydown', onKey, opts);
    removeEventListener('scroll', schedule, opts);
    removeEventListener('resize', schedule);
    stopListening();
    host.remove();
    delete (window as unknown as Record<string, unknown>)[SLOT];
  }
  return teardown;
}

export default defineContentScript({
  // Injected by chrome.scripting.executeScript from the Grab screen; no host permission is added: activeTab covers the tab you grab from.
  registration: 'runtime',
  matches: [],
  main() {
    const w = window as unknown as Record<string, (() => void) | undefined>;
    w[SLOT]?.();
    w[SLOT] = start();
  },
});
