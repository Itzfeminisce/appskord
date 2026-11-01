import { afterEach, describe, expect, it } from 'vitest';
import { joinSession, type EditorSession, type Locks } from './session';

type Callback = (lock: Lock | null) => unknown;
interface Held { reject(e: unknown): void }
interface Waiting { cb: Callback; resolve(v: unknown): void; reject(e: unknown): void; signal?: AbortSignal }

/** Exclusive Web Locks for one test: a holder, a FIFO line, ifAvailable, steal and abort. */
class FakeLocks {
  private held = new Map<string, Held>();
  private lines = new Map<string, Waiting[]>();

  isHeld = (name: string) => this.held.has(name);

  request = ((name: string, options: LockOptions, cb: Callback) => new Promise((resolve, reject) => {
    const w: Waiting = { cb, resolve, reject, signal: options.signal };
    if (options.steal) {
      this.held.get(name)?.reject(new DOMException('stolen', 'AbortError'));
      this.held.delete(name);
      this.grant(name, w);
    } else if (!this.held.has(name)) this.grant(name, w);
    else if (options.ifAvailable) Promise.resolve(cb(null)).then(resolve, reject);
    else {
      const line = this.lines.get(name) ?? [];
      line.push(w);
      this.lines.set(name, line);
      options.signal?.addEventListener('abort', () => {
        const i = line.indexOf(w);
        if (i >= 0) line.splice(i, 1);
        reject(new DOMException('aborted', 'AbortError'));
      });
    }
  })) as unknown as Locks['request'];

  private grant(name: string, w: Waiting) {
    const me: Held = { reject: w.reject };
    this.held.set(name, me);
    Promise.resolve(w.cb({ name, mode: 'exclusive' } as Lock)).then((v) => {
      if (this.held.get(name) !== me) return;
      this.held.delete(name);
      w.resolve(v);
      const next = this.lines.get(name)?.shift();
      if (next) this.grant(name, next);
    }, w.reject);
  }
}

const open: EditorSession[] = [];
afterEach(() => open.splice(0).forEach((s) => s.close()));

const wait = (ms = 10) => new Promise((r) => setTimeout(r, ms));

function tabs() {
  const locks = new FakeLocks();
  const join = (id: string, onTaken?: () => Promise<void>, waitMs = 200) => {
    const s = joinSession(id, { channel: new BroadcastChannel('klipkord-editor-test'), locks, onTaken, waitMs });
    open.push(s);
    return s;
  };
  return { locks, join };
}

describe('one editor tab per recording', () => {
  it('two tabs opened together: exactly one edits', async () => {
    const { join } = tabs();
    const a = join('rec-1');
    const b = join('rec-1');
    await wait();
    expect([a.state, b.state].sort()).toEqual(['editing', 'elsewhere']);
  });

  it('closing the editing tab lets go; the waiting tab edits', async () => {
    const { join, locks } = tabs();
    const a = join('rec-1');
    await wait();
    const b = join('rec-1');
    const seen: string[] = [];
    b.subscribe((s) => seen.push(s));
    await wait();
    expect(b.state).toBe('elsewhere');
    a.close();
    await wait();
    expect(b.state).toBe('editing');
    expect(seen).toEqual(['editing']);
    b.close();
    await wait();
    expect(locks.isHeld('klipkord-editor:rec-1')).toBe(false);
  });

  it('Edit here: the editing tab saves, goes read-only, and waits in line', async () => {
    const { join } = tabs();
    let saved = false;
    const first = join('rec-1', async () => { saved = true; });
    await wait();
    const second = join('rec-1');
    await wait();
    await second.take();
    expect(second.state).toBe('editing');
    expect(first.state).toBe('elsewhere');
    expect(saved).toBe(true);
    second.close();
    await wait();
    expect(first.state).toBe('editing');
  });

  it('Edit here takes over even when the editing tab does not answer', async () => {
    const { join, locks } = tabs();
    // A tab that holds the lock but never hears "take".
    locks.request('klipkord-editor:rec-1', {}, () => new Promise(() => undefined)).catch(() => undefined);
    const tab = join('rec-1', undefined, 20);
    await wait();
    expect(tab.state).toBe('elsewhere');
    await tab.take();
    expect(tab.state).toBe('editing');
  });

  it('tabs on different recordings both edit', async () => {
    const { join } = tabs();
    const a = join('rec-1');
    const b = join('rec-2');
    await wait();
    expect([a.state, b.state]).toEqual(['editing', 'editing']);
  });
});
