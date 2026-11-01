import { clockElapsed, type Clock } from './recorder';
import type { EventsTrack, RecEvent } from './project/types';

/** At most this many moves (and scrolls) a second leave the page. */
export const EVENTS_PER_SECOND = 30;

/** Accepts a call at most `perSecond` times a second; `now` is ms. */
export function createThrottle(perSecond = EVENTS_PER_SECOND) {
  // One per time slot, so the rate never drifts below or above `perSecond`.
  let last = -Infinity;
  return (now: number): boolean => {
    const slot = Math.floor((now * perSecond) / 1000);
    if (slot <= last) return false;
    last = slot;
    return true;
  };
}

/** The bits of an element the filter looks at; a real Element fits. */
interface FieldLike { tagName?: string; type?: string; autocomplete?: string; getAttribute?(name: string): string | null }

const SECRET_AUTOCOMPLETE = /\b(current-password|new-password|one-time-code|cc-number|cc-csc)\b/;

/** Password fields (and fields that hold one while "show password" is on) are never recorded. */
export function isSecretField(el: FieldLike | null | undefined): boolean {
  if (!el || !el.tagName || el.tagName.toUpperCase() !== 'INPUT') return false;
  if ((el.type ?? '').toLowerCase() === 'password') return true;
  const auto = el.autocomplete || el.getAttribute?.('autocomplete') || '';
  return SECRET_AUTOCOMPLETE.test(auto.toLowerCase());
}

/** Keys kept by name: they move or confirm, they never put a character on the page. */
const NAMED = new Set([
  'Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
]);
const MODIFIERS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Fn', 'OS']);

export interface KeyLike {
  key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing?: boolean;
}

/** The shortcut's key from its physical position, so a layout's character never shows: KeyC → "C". */
function codeName(code: string): string | null {
  const m = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(code);
  if (m) return m[1] ?? m[2]!;
  return null;
}

/**
 * "typing", a shortcut name such as "Ctrl+C", a named key such as "Enter", or null for nothing at all.
 * Never returns a typed character; returns null inside a password field.
 */
export function keyName(e: KeyLike, target?: FieldLike | null): string | null {
  if (isSecretField(target)) return null;
  if (MODIFIERS.has(e.key)) return null;
  if (e.isComposing) return 'typing';
  // AltGr arrives as Ctrl+Alt and types characters such as "@"; Alt alone types accents on a Mac.
  const shortcut = (e.ctrlKey || e.metaKey) && !(e.ctrlKey && e.altKey);
  if (shortcut) {
    const base = NAMED.has(e.key) ? e.key : codeName(e.code);
    if (!base) return 'typing';
    const mods = [e.ctrlKey && 'Ctrl', e.metaKey && 'Cmd', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean);
    return [...mods, base].join('+');
  }
  if (NAMED.has(e.key)) return e.shiftKey ? `Shift+${e.key}` : e.key;
  return 'typing';
}

/** 0..1 of the viewport, clamped. */
export function share(v: number, size: number): number {
  if (!(size > 0)) return 0;
  return Math.min(1, Math.max(0, v / size));
}

/** What the page sends: events stamped with wall time (`t` = Date.now()), mapped to recording time on arrival. */
export interface EventsBatch { viewport: { w: number; h: number }; events: RecEvent[] }

/** Wall time → recording time on the take's clock; null while paused or before the take ran. */
export function recTime(clock: Clock, wall: number): number | null {
  if (clock.runningSince === null || wall < clock.runningSince) return null;
  return Math.round(clockElapsed(clock, wall));
}

/** Collects one take's events in recording time. Events outside the running clock are dropped. */
export function createEventsLog() {
  const events: RecEvent[] = [];
  let viewport = { w: 0, h: 0 };
  return {
    add(batch: EventsBatch, clock: Clock): void {
      if (batch.viewport.w > 0 && batch.viewport.h > 0) viewport = { w: batch.viewport.w, h: batch.viewport.h };
      for (const e of batch.events) {
        const t = recTime(clock, e.t);
        if (t === null) continue;
        // A key event is rebuilt so nothing but its name can travel through.
        if (e.type === 'key') {
          if (typeof e.key !== 'string' || (e.key !== 'typing' && e.key.length < 2)) continue;
          events.push({ t, type: 'key', key: e.key, ...(e.x !== undefined && e.y !== undefined ? { x: e.x, y: e.y } : {}) });
        } else {
          events.push({ ...e, t });
        }
      }
    },
    get size() { return events.length; },
    track(): EventsTrack {
      return { version: 1, viewport, events: [...events].sort((a, b) => a.t - b.t) };
    },
  };
}

export const EVENTS_FILE = 'events.json';
const EVENTS_SCRIPT = '/content-scripts/events.js';
const TARGET_KEY = 'klipkord.events';

/** The tab whose events are recorded, kept so the background can check senders and follow page loads. */
export async function eventsTab(): Promise<number | null> {
  const stored = await browser.storage.session.get(TARGET_KEY);
  return (stored[TARGET_KEY] as number | undefined) ?? null;
}

/** Puts the events script in the tab; false where Klipkord may not see the page. */
export async function injectEvents(tabId: number): Promise<boolean> {
  try {
    await browser.scripting.executeScript({ target: { tabId }, files: [EVENTS_SCRIPT] });
    return true;
  } catch {
    return false;
  }
}

export async function startEvents(tabId: number): Promise<boolean> {
  if (!(await injectEvents(tabId))) return false;
  await browser.storage.session.set({ [TARGET_KEY]: tabId });
  return true;
}

/** Takes the script's listeners off the page and forgets the tab. */
export async function stopEvents(): Promise<void> {
  const tabId = await eventsTab();
  if (tabId === null) return;
  await browser.storage.session.remove(TARGET_KEY);
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      func: () => (globalThis as { klipkordEvents?: { remove: () => void } }).klipkordEvents?.remove(),
    });
  } catch {
    // The tab was closed or left the site, which took the script with it.
  }
}
