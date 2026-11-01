/** One editor tab edits a recording at a time; the others are read-only (open-elsewhere). */
export type SessionState = 'checking' | 'editing' | 'elsewhere';

type Signal = { id: string; from: string; type: 'who' | 'mine' | 'take' | 'released' };

export interface EditorSession {
  readonly state: SessionState;
  subscribe(listener: (state: SessionState) => void): () => void;
  /** "Edit here": this tab edits; resolves once the other tab has saved and let go. */
  take(): Promise<void>;
  close(): void;
}

export interface SessionOptions {
  channel?: BroadcastChannel;
  /** How long to wait for another tab to answer. */
  waitMs?: number;
  /** Runs before this tab lets go, so its last edits are saved for the tab taking over. */
  onTaken?: () => Promise<void>;
}

export const SESSION_CHANNEL = 'klipkord-editor';

export function joinSession(id: string, { channel = new BroadcastChannel(SESSION_CHANNEL), waitMs = 300, onTaken }: SessionOptions = {}): EditorSession {
  const me = crypto.randomUUID();
  const listeners = new Set<(state: SessionState) => void>();
  let state: SessionState = 'checking';
  let released: (() => void) | null = null;
  const set = (next: SessionState) => {
    if (next === state) return;
    state = next;
    listeners.forEach((l) => l(state));
  };
  const post = (type: Signal['type']) => channel.postMessage({ id, from: me, type } satisfies Signal);

  const onMessage = (event: MessageEvent<Signal>) => {
    const s = event.data;
    if (!s || s.id !== id || s.from === me) return;
    if (s.type === 'who' && state === 'editing') post('mine');
    else if (s.type === 'mine' && state === 'checking') set('elsewhere');
    else if (s.type === 'take' && state === 'editing') {
      set('elsewhere');
      void (onTaken?.() ?? Promise.resolve()).catch(() => undefined).then(() => post('released'));
    } else if (s.type === 'released') released?.();
  };
  channel.addEventListener('message', onMessage as EventListener);
  post('who');
  const timer = setTimeout(() => { if (state === 'checking') set('editing'); }, waitMs);

  return {
    get state() { return state; },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    take() {
      set('editing');
      return new Promise<void>((resolve) => {
        const done = setTimeout(() => { released = null; resolve(); }, 1000);
        released = () => { clearTimeout(done); released = null; resolve(); };
        post('take');
      });
    },
    close() {
      clearTimeout(timer);
      channel.removeEventListener('message', onMessage as EventListener);
      channel.close();
      listeners.clear();
    },
  };
}
