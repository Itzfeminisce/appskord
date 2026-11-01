// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createEventsLog, createThrottle, isSecretField, keyName, recTime, share, type KeyLike } from './events';
import { clockPause, clockResume, clockStart } from './recorder';

const key = (k: Partial<KeyLike> & { key: string; code?: string }): KeyLike =>
  ({ code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...k });

const field = (type: string, autocomplete = '') => {
  const el = document.createElement('input');
  el.type = type;
  if (autocomplete) el.setAttribute('autocomplete', autocomplete);
  return el;
};

describe('keyName', () => {
  it('turns every typed character into "typing"', () => {
    for (const k of ['a', 'Z', '7', '@', ' ', 'é', 'Backspace']) expect(keyName(key({ key: k }))).toBe('typing');
    expect(keyName(key({ key: 'A', code: 'KeyA', shiftKey: true }))).toBe('typing');
  });

  it('names shortcuts from the key position, never the character', () => {
    expect(keyName(key({ key: 'c', code: 'KeyC', ctrlKey: true }))).toBe('Ctrl+C');
    expect(keyName(key({ key: 'p', code: 'KeyP', metaKey: true, shiftKey: true }))).toBe('Cmd+Shift+P');
    expect(keyName(key({ key: 'Enter', ctrlKey: true }))).toBe('Ctrl+Enter');
    expect(keyName(key({ key: 'Enter' }))).toBe('Enter');
    expect(keyName(key({ key: 'Tab', shiftKey: true }))).toBe('Shift+Tab');
  });

  it('keeps AltGr, Alt and composed characters as "typing"', () => {
    expect(keyName(key({ key: '@', code: 'KeyQ', ctrlKey: true, altKey: true }))).toBe('typing');
    expect(keyName(key({ key: 'é', code: 'KeyE', altKey: true }))).toBe('typing');
    expect(keyName(key({ key: 'ß', code: 'Minus', ctrlKey: true }))).toBe('typing');
    expect(keyName(key({ key: 'か', isComposing: true }))).toBe('typing');
  });

  it('drops modifiers alone', () => {
    expect(keyName(key({ key: 'Shift', shiftKey: true }))).toBeNull();
    expect(keyName(key({ key: 'Control', ctrlKey: true }))).toBeNull();
  });

  it('records nothing at all in a password field', () => {
    const pw = field('password');
    expect(isSecretField(pw)).toBe(true);
    expect(keyName(key({ key: 'a' }), pw)).toBeNull();
    expect(keyName(key({ key: 'v', code: 'KeyV', ctrlKey: true }), pw)).toBeNull();
    expect(keyName(key({ key: 'Enter' }), pw)).toBeNull();
    // A shown password is still a password.
    expect(keyName(key({ key: 'a' }), field('text', 'current-password'))).toBeNull();
    expect(keyName(key({ key: 'a' }), field('text'))).toBe('typing');
    expect(isSecretField(document.createElement('textarea'))).toBe(false);
  });
});

describe('createThrottle', () => {
  it('lets through at most 30 a second', () => {
    const ok = createThrottle(30);
    let passed = 0;
    for (let t = 0; t < 1000; t++) if (ok(t)) passed++;
    expect(passed).toBe(30);
    expect(ok(1000)).toBe(true);
    expect(ok(1001)).toBe(false);
  });
});

describe('share', () => {
  it('maps into 0..1 of the viewport and clamps', () => {
    expect(share(50, 200)).toBe(0.25);
    expect(share(-5, 200)).toBe(0);
    expect(share(500, 200)).toBe(1);
    expect(share(5, 0)).toBe(0);
  });
});

describe('recording time', () => {
  it('maps wall time onto the take clock across a pause', () => {
    let c = clockStart(1000);
    expect(recTime(c, 1500)).toBe(500);
    expect(recTime(c, 900)).toBeNull();
    c = clockPause(c, 2000);
    expect(recTime(c, 2500)).toBeNull();
    c = clockResume(c, 5000);
    expect(recTime(c, 5250)).toBe(1250);
    expect(recTime(c, 4000)).toBeNull();
  });

  it('collects events in recording time, sorted, and drops typed characters that slip in', () => {
    const log = createEventsLog();
    const clock = clockStart(10_000);
    log.add({
      viewport: { w: 1280, h: 720 },
      events: [
        { t: 10_400, type: 'click', x: 0.5, y: 0.5 },
        { t: 10_200, type: 'move', x: 0.1, y: 0.2 },
        { t: 10_300, type: 'key', key: 'x' },
        { t: 10_350, type: 'key', key: 'Ctrl+C', x: 0.3, y: 0.4 },
        { t: 9_000, type: 'scroll', dy: 0.1 },
      ],
    }, clock);
    log.add({ viewport: { w: 0, h: 0 }, events: [{ t: 10_500, type: 'page' }] }, clock);
    expect(log.track()).toEqual({
      version: 1,
      viewport: { w: 1280, h: 720 },
      events: [
        { t: 200, type: 'move', x: 0.1, y: 0.2 },
        { t: 350, type: 'key', key: 'Ctrl+C', x: 0.3, y: 0.4 },
        { t: 400, type: 'click', x: 0.5, y: 0.5 },
        { t: 500, type: 'page' },
      ],
    });
  });

  it('keeps nothing while paused', () => {
    const log = createEventsLog();
    log.add({ viewport: { w: 1, h: 1 }, events: [{ t: 5, type: 'move', x: 0, y: 0 }] }, clockPause(clockStart(0), 1));
    expect(log.size).toBe(0);
  });
});
