import { afterEach, describe, expect, it } from 'vitest';
import { joinSession, type EditorSession } from './session';

const open: EditorSession[] = [];
afterEach(() => open.splice(0).forEach((s) => s.close()));

const join = (id: string, onTaken?: () => Promise<void>) => {
  const s = joinSession(id, { channel: new BroadcastChannel('klipkord-editor-test'), waitMs: 30, onTaken });
  open.push(s);
  return s;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('one editor tab per recording', () => {
  it('the first tab edits; a second tab on the same recording is open-elsewhere until it takes over', async () => {
    let saved = false;
    const first = join('rec-1', async () => { saved = true; });
    await wait(60);
    expect(first.state).toBe('editing');

    const second = join('rec-1');
    await wait(60);
    expect(second.state).toBe('elsewhere');

    await second.take();
    expect(second.state).toBe('editing');
    expect(first.state).toBe('elsewhere');
    expect(saved).toBe(true);
  });

  it('tabs on different recordings both edit', async () => {
    const a = join('rec-1');
    const b = join('rec-2');
    await wait(60);
    expect([a.state, b.state]).toEqual(['editing', 'editing']);
  });
});
