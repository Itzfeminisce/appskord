import type { Ctx2D } from './layers/path';
import type { Picture } from './layers/scene';

// Test helpers: a 2D context that records what is drawn, and stand-in pictures. Not used by the extension.

export type Call = [string, ...unknown[]];
export interface Fake2d { ctx: Ctx2D; calls: Call[]; names(): string[] }

/** A 2D context that records every call and property set; text is 10 px per character. */
export function fake2d(): Fake2d {
  const calls: Call[] = [];
  const state: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return (text: string) => ({ width: text.length * 10 });
      if (key === 'createLinearGradient') {
        return (...args: unknown[]) => {
          calls.push(['createLinearGradient', ...args]);
          return { addColorStop: (...stop: unknown[]) => calls.push(['addColorStop', ...stop]) };
        };
      }
      return (...args: unknown[]) => {
        calls.push([String(key), ...args]);
      };
    },
    set(target, key, value) {
      target[key] = value;
      calls.push([`${String(key)}=`, value]);
      return true;
    },
  }) as unknown as Ctx2D;
  return { ctx, calls, names: () => calls.map((c) => c[0]) };
}

/** A stand-in VideoFrame: has a display size and records close(). */
export function fakeFrame(w = 1920, h = 1080): Picture & { closed: boolean } {
  const frame = { displayWidth: w, displayHeight: h, closed: false, close() { frame.closed = true; } };
  return frame as unknown as Picture & { closed: boolean };
}
