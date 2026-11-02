import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { TELL_PORT } from '@/lib/catchup/session';
import { getMeeting } from '@/lib/db';
import type { CalendarEvent } from '@/lib/types';

const h = vi.hoisted(() => ({
  handler: undefined as undefined | ((msg: unknown) => unknown),
  connect: undefined as undefined | ((port: unknown) => void),
  sent: [] as { type: string }[],
}));

vi.mock('@/lib/messages', () => ({
  onMessage: (fn: (msg: unknown) => unknown) => { h.handler = fn; },
  send: vi.fn(async (msg: { type: string }) => {
    h.sent.push(msg);
    if (msg.type === 'offscreen/start') return { ok: true, tellStart: Date.now() };
    if (msg.type === 'offscreen/stop') return { ok: true, recorded: true, voicePart: { at: 1, ms: 42_000, kind: 'voice' } };
    return undefined;
  }),
}));
vi.mock('@/lib/memory/store', () => ({ openLoops: async () => [] }));
vi.mock('@/lib/reminders', async (actual) => ({ ...(await actual<object>()), scheduleReminders: async () => undefined, onReminderAlarm: async () => undefined }));

/** Replaces browser APIs the fake browser does not implement. */
function stub(path: string, impl: (...a: never[]) => unknown = () => undefined) {
  const keys = path.split('.');
  let o = browser as unknown as Record<string, Record<string, unknown>>;
  for (const k of keys.slice(0, -1)) o = (o[k] ??= {}) as never;
  (o as Record<string, unknown>)[keys.at(-1)!] = vi.fn(impl);
}

const port = (name: string) => {
  const listeners: (() => void)[] = [];
  return { name, onDisconnect: { addListener: (fn: () => void) => listeners.push(fn) }, close: () => listeners.forEach((fn) => fn()) };
};

const event: CalendarEvent = { id: 'ev1', title: 'Q4 planning', start: 1_000, end: 3_600_000, attendees: [] };

beforeAll(async () => {
  for (const p of [
    'runtime.onInstalled.addListener', 'runtime.onStartup.addListener', 'action.onClicked.addListener', 'windows.onFocusChanged.addListener',
    'notifications.onClicked.addListener', 'notifications.onButtonClicked.addListener', 'alarms.onAlarm.addListener', 'commands.onCommand.addListener',
    'storage.onChanged.addListener',
  ]) stub(p);
  for (const p of ['action.setBadgeBackgroundColor', 'action.setBadgeText', 'alarms.create', 'sidePanel.setPanelBehavior', 'offscreen.createDocument', 'offscreen.closeDocument']) {
    stub(p, async () => undefined);
  }
  stub('windows.getLastFocused', async () => ({ id: 1 }));
  stub('runtime.getContexts', async () => []);
  stub('runtime.onConnect.addListener', (fn: never) => { h.connect = fn; });
  const bg = await import('@/entrypoints/background');
  bg.default.main();
});

describe('the Catch up screen port', () => {
  it('closing the panel mid-telling stops it and keeps what was said', async () => {
    const start = await h.handler!({ type: 'recording/start', tabId: -1, catchup: { meetingId: 'm1', picked: { kind: 'event', event } } });
    expect(start).toEqual({ ok: true, meetingId: 'm1' });
    const p = port(TELL_PORT);
    h.connect!(p);
    h.connect!(port('other'));
    p.close();
    await vi.waitFor(async () => expect((await getMeeting('m1'))?.status).toBe('processing'));
    expect(h.sent.filter((m) => m.type === 'offscreen/stop')).toHaveLength(1);
    expect((await getMeeting('m1'))?.told?.parts).toEqual([{ at: 1, ms: 42_000, kind: 'voice' }]);
    expect(await h.handler!({ type: 'recording/get-state' })).toEqual({ status: 'idle' });
  });
});
