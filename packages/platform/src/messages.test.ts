import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { on, send } from './messages';

type Msg = { type: 'ping' } | { type: 'echo'; text: string };

describe('messages', () => {
  beforeEach(() => fakeBrowser.reset());

  it('resolves undefined when nothing is listening', async () => {
    await expect(send<Msg>({ type: 'ping' })).resolves.toBeUndefined();
  });

  it('delivers typed messages and replies, sync or async', async () => {
    const off = on<Msg>((msg) => (msg.type === 'echo' ? Promise.resolve(msg.text) : undefined));
    expect(await send<Msg, string>({ type: 'echo', text: 'hi' })).toBe('hi');
    off();
  });

  it('ignores messages without a string type', async () => {
    let calls = 0;
    const off = on<Msg>(() => {
      calls++;
      return true;
    });
    await fakeBrowser.runtime.sendMessage({ nope: 1 }).catch(() => undefined);
    expect(calls).toBe(0);
    off();
  });

  it('answers undefined when the handler rejects', async () => {
    const off = on<Msg>(() => Promise.reject(new Error('boom')));
    expect(await send<Msg>({ type: 'ping' })).toBeUndefined();
    off();
  });
});
