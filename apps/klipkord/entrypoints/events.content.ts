import { createThrottle, isSecretField, keyName, share, type EventsBatch } from '@/lib/events';
import type { RecEvent } from '@/lib/project/types';

// Injected with `scripting` into the recorded tab only, while a take is armed or live; never declared.
export default defineContentScript({
  registration: 'runtime',
  main() {
    const scope = globalThis as { klipkordEvents?: { remove: () => void } };
    if (scope.klipkordEvents) return;
    scope.klipkordEvents = listen(() => delete scope.klipkordEvents);
  },
});

const FLUSH_MS = 100;

/** Reads only pointer positions, scrolls and which kind of key went down; never page text or typed characters. */
function listen(onRemove: () => void): { remove: () => void } {
  let queue: RecEvent[] = [];
  const moveOk = createThrottle();
  const scrollOk = createThrottle();
  let lastY = window.scrollY;
  let pendingDy = 0;

  const w = () => window.innerWidth;
  const h = () => window.innerHeight;
  const flush = () => {
    if (!queue.length) return;
    const batch: EventsBatch = { viewport: { w: w(), h: h() }, events: queue };
    queue = [];
    chrome.runtime.sendMessage({ type: 'events/batch', batch }).catch(() => undefined);
  };
  const timer = setInterval(flush, FLUSH_MS);

  const onMove = (e: PointerEvent) => {
    const now = Date.now();
    if (!moveOk(now)) return;
    queue.push({ t: now, type: 'move', x: share(e.clientX, w()), y: share(e.clientY, h()) });
  };
  const onDown = (e: PointerEvent) => {
    if (isSecretField(e.target as Element | null)) return;
    queue.push({ t: Date.now(), type: 'click', x: share(e.clientX, w()), y: share(e.clientY, h()) });
  };
  const onKey = (e: KeyboardEvent) => {
    const field = (e.composedPath()[0] as Element | undefined) ?? document.activeElement;
    const key = keyName(e, field as HTMLInputElement | null);
    if (!key) return;
    // Where the key went, so a zoom can follow typing.
    const rect = field instanceof Element && field !== document.body ? field.getBoundingClientRect() : null;
    const at = rect && rect.width > 0 ? { x: share(rect.left + rect.width / 2, w()), y: share(rect.top + rect.height / 2, h()) } : {};
    queue.push({ t: Date.now(), type: 'key', key, ...at });
  };
  const onScroll = () => {
    pendingDy += window.scrollY - lastY;
    lastY = window.scrollY;
    const now = Date.now();
    if (!pendingDy || !scrollOk(now)) return;
    queue.push({ t: now, type: 'scroll', dy: pendingDy / (h() || 1) });
    pendingDy = 0;
  };

  const opts = { capture: true, passive: true } as const;
  window.addEventListener('pointermove', onMove, opts);
  window.addEventListener('pointerdown', onDown, opts);
  window.addEventListener('keydown', onKey, opts);
  window.addEventListener('scroll', onScroll, opts);

  return {
    remove() {
      flush();
      clearInterval(timer);
      window.removeEventListener('pointermove', onMove, opts);
      window.removeEventListener('pointerdown', onDown, opts);
      window.removeEventListener('keydown', onKey, opts);
      window.removeEventListener('scroll', onScroll, opts);
      onRemove();
    },
  };
}
