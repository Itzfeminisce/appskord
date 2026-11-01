/** One editor tab edits a recording at a time; the others are read-only (open-elsewhere). */
export type SessionState = 'checking' | 'editing' | 'elsewhere';

type Signal = { id: string; from: string; type: 'take' | 'released' };

/** The part of navigator.locks the session uses. */
export type Locks = Pick<LockManager, 'request'>;

export interface EditorSession {
  readonly state: SessionState;
  subscribe(listener: (state: SessionState) => void): () => void;
  /** "Edit here": this tab edits; resolves once the other tab has saved and let go. */
  take(): Promise<void>;
  close(): void;
}

export interface SessionOptions {
  channel?: BroadcastChannel;
  locks?: Locks;
  /** How long "Edit here" waits for the editing tab to save before taking over anyway. */
  waitMs?: number;
  /** Runs before this tab lets go, so its last edits are saved for the tab taking over. */
  onTaken?: () => Promise<void>;
}

export const SESSION_CHANNEL = 'klipkord-editor';
export const lockName = (id: string) => `klipkord-editor:${id}`;

/**
 * The editing tab holds a Web Lock for the recording for as long as it edits, so two tabs opened together
 * cannot both edit and a closed tab always lets go. Read-only tabs wait in line for the lock and edit once it is free.
 */
export function joinSession(id: string, { channel = new BroadcastChannel(SESSION_CHANNEL), locks = navigator.locks, waitMs = 1000, onTaken }: SessionOptions = {}): EditorSession {
  const me = crypto.randomUUID();
  const name = lockName(id);
  const listeners = new Set<(state: SessionState) => void>();
  let state: SessionState = 'checking';
  let closed = false;
  let release: (() => void) | null = null;
  let queued: AbortController | null = null;
  let granted: (() => void) | null = null;
  let released: (() => void) | null = null;
  const set = (next: SessionState) => {
    if (closed || next === state) return;
    state = next;
    listeners.forEach((l) => l(state));
  };
  const post = (type: Signal['type']) => channel.postMessage({ id, from: me, type } satisfies Signal);

  // Held until close() or until another tab steals it.
  const hold = () => {
    if (closed) return undefined;
    set('editing');
    granted?.();
    return new Promise<void>((resolve) => { release = resolve; });
  };
  const lost = () => {
    release = null;
    if (closed) return;
    set('elsewhere');
    wait();
  };
  const wait = () => {
    const ctl = new AbortController();
    queued = ctl;
    locks.request(name, { signal: ctl.signal }, hold).catch(() => { if (!ctl.signal.aborted) lost(); });
  };

  const onMessage = (event: MessageEvent<Signal>) => {
    const s = event.data;
    if (!s || s.id !== id || s.from === me) return;
    if (s.type === 'take' && state === 'editing') {
      // Keep the lock while saving so no waiting tab slips in; the taker steals it after 'released'.
      set('elsewhere');
      void (onTaken?.() ?? Promise.resolve()).catch(() => undefined).then(() => post('released'));
    } else if (s.type === 'released') released?.();
  };
  channel.addEventListener('message', onMessage as EventListener);

  locks.request(name, { ifAvailable: true }, (lock) => {
    if (lock) return hold();
    if (!closed) {
      set('elsewhere');
      wait();
    }
    return undefined;
  }).catch(() => { if (!closed) lost(); });

  return {
    get state() { return state; },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    take() {
      if (state === 'editing' || closed) return Promise.resolve();
      return new Promise<void>((resolve) => {
        granted = () => { granted = null; resolve(); };
        const steal = () => {
          clearTimeout(timer);
          released = null;
          if (closed || state === 'editing') return;
          queued?.abort();
          queued = null;
          locks.request(name, { steal: true }, hold).catch(lost);
        };
        const timer = setTimeout(steal, waitMs);
        released = steal;
        post('take');
      });
    },
    close() {
      closed = true;
      queued?.abort();
      release?.();
      channel.removeEventListener('message', onMessage as EventListener);
      channel.close();
      listeners.clear();
    },
  };
}
