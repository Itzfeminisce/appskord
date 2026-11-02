import { useMemo, useSyncExternalStore } from 'react';
import { draftWords, toDraft, withLengths, type Checked } from '@/lib/ai/ops';
import type { QuickWin } from '@/lib/project/suggest';
import type { Draft, Project } from '@/lib/project/types';
import type { Recording } from '@/lib/types';
import { units as unitsOf, type Unit } from '@/lib/wordCuts';

/** StatesWork states of the Ask AI and Translate panels. */
export type AiStatus = 'idle' | 'not-set-up' | 'thinking' | 'failed' | 'cant' | 'offline';

/** A highlight cut on trial: Discard deletes it and goes back to `back`. */
export interface Trial { cutId: string; back: string; request: string; labels: string[]; ops: Checked['ops'] }

export interface AiState {
  panel: 'ask' | 'translate' | null;
  status: AiStatus;
  /** The request in the bubble; Try again sends it again. */
  request: string;
  /** ai-thinking: changes planned so far. ai-cant: what the AI said it cannot do. */
  planned: number;
  cant: string;
  /** The model's valid reply, waiting as a draft; `off` holds the unticked rows. */
  reply: { request: string; checked: Pick<Checked, 'ops' | 'labels'> } | null;
  off: ReadonlySet<number>;
  trial: Trial | null;
  /** ai-applied: the toast, with the changes it applied. */
  applied: number | null;
  /** Provider label in the panel headers, once keys are read. */
  provider: string;
  /** Translate: the language being checked. */
  language: string | null;
}

const INITIAL: AiState = {
  panel: null, status: 'idle', request: '', planned: 0, cant: '', reply: null, off: new Set(), trial: null, applied: null, provider: '', language: null,
};

let state = INITIAL;
const listeners = new Set<() => void>();

export const aiState = (): AiState => state;
export function setAi(patch: Partial<AiState> | ((s: AiState) => Partial<AiState>)): void {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  listeners.forEach((l) => l());
}
export const resetAi = (): void => setAi(INITIAL);
export function subscribeAi(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}
export const useAi = (): AiState => useSyncExternalStore(subscribeAi, aiState, aiState);

export const openAsk = (): void => setAi((s) => ({ panel: 'ask', status: s.status === 'thinking' ? s.status : 'idle' }));
export const openTranslate = (): void => setAi({ panel: 'translate', status: 'idle' });

export const useUnits = (recording: Recording): Unit[] => useMemo(() => unitsOf(recording.transcript), [recording.transcript]);

/** The waiting draft over the latest project, rows ticked as the person left them. */
export function useDraft(project: Project, units: Unit[]): Draft | null {
  const { reply, off } = useAi();
  return useMemo(() => {
    if (!reply) return null;
    const d = toDraft(project, units, reply.request, reply.checked);
    return off.size ? withLengths(project, units, { ...d, changes: d.changes.map((c, i) => ({ ...c, on: !off.has(i) })) }) : d;
  }, [project, units, reply, off]);
}

/** Words the waiting draft would cut, for the transcript's orange. */
export function useDraftUnits(project: Project, recording: Recording): ReadonlySet<number> {
  const units = useUnits(recording);
  const draft = useDraft(project, units);
  return useMemo(() => (draft ? draftWords(project, units, draft) : new Set<number>()), [draft, project, units]);
}

// ---- AI rows for T6's SuggestedEdits, one ask per project ----

let wins: Record<string, QuickWin[]> = {};
const winListeners = new Set<() => void>();
export function setWins(id: string, list: QuickWin[]): void {
  wins = { ...wins, [id]: list };
  winListeners.forEach((l) => l());
}
export const winsOf = (id: string): QuickWin[] | undefined => wins[id];
export function useWins(id: string): QuickWin[] | undefined {
  return useSyncExternalStore((l) => { winListeners.add(l); return () => { winListeners.delete(l); }; }, () => wins[id], () => wins[id]);
}
