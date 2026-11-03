/** Frame CardFillAI: the sparkle in a Details field writes it from the card's own text, or reworks what is in it. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { parseFill } from '@/lib/ai/parse';
import { fillPrompt, hasNoText, type FillField, type FillMode } from '@/lib/ai/prompts';
import { askAi } from '@/lib/ai/run';
import type { Card } from '@/lib/board/types';
import { askHost, openAiSettings } from './choice';
import { useAiRun } from './run';
import { AiState } from './States';

const SparkleIcon = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
    {size > 12 && <path d="M19 15v4M17 17h4" />}
  </svg>
);
const Spinner = () => (
  <svg className="bk-ai-spin" width="15" height="15" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="var(--bk-map-card)" />
    <path d="M12 3a9 9 0 0 1 9 9" stroke="var(--bk-accent)" />
  </svg>
);

const MENU: { mode: Exclude<FillMode, 'write'>; label: string }[] = [
  { mode: 'shorter', label: 'Make it shorter' },
  { mode: 'clearer', label: 'Make it clearer' },
  { mode: 'spelling', label: 'Fix spelling' },
];

export type FillState = 'working' | 'done' | undefined;

export interface FieldFillProps {
  card: Card;
  /** What each field holds now, saved or not. */
  values: Record<FillField, string>;
  set(field: FillField, text: string): void;
  /** Keep: saves the field as one step of the board's Undo. */
  keep(field: FillField, text: string): void;
}

/** One sparkle at a time across the panel's fields; only one error shows. */
export function useFieldFill({ card, values, set, keep }: FieldFillProps) {
  const [field, setField] = useState<FillField>();
  const [menu, setMenu] = useState<FillField>();
  const job = useRef<{ field: FillField; mode: FillMode; old: string }>(undefined);
  const live = useRef({ card, values });
  live.current = { card, values };

  const { phase, run, stop, setPhase } = useAiRun<string>(async (call) => {
    const j = job.current!;
    const now = live.current;
    const c = { ...now.card, title: now.values.title, say: now.values.say } as Card;
    return askAi(fillPrompt(c, j.field, j.mode, now.values[j.field]), (reply) => parseFill(reply, j.field), call);
  });

  const setLive = useRef(set);
  setLive.current = set;
  useEffect(() => {
    if (phase.kind === 'done' && job.current) setLive.current(job.current.field, phase.value);
  }, [phase]);

  const reset = useCallback(() => {
    stop();
    setField(undefined);
    setMenu(undefined);
  }, [stop]);
  useEffect(() => reset, [card.id, reset]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => !(e.target as Element).closest?.('.bk-fill-spark.is-open') && setMenu(undefined);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);

  // Called from a click: Chrome's site prompt goes first, before any await.
  const start = (f: FillField, mode: FillMode) => {
    const asked = askHost();
    setMenu(undefined);
    job.current = { field: f, mode, old: values[f] };
    setField(f);
    void run(asked);
  };

  /** Stop, Undo, Esc: the field goes back to what it held; nothing is saved. */
  const restore = () => {
    if (field && job.current && phase.kind !== 'failed') set(field, job.current.old);
    reset();
  };

  const keepIt = () => {
    if (field) keep(field, values[field]);
    setPhase({ kind: 'idle' });
    setField(undefined);
  };

  const busy = phase.kind === 'working' || phase.kind === 'done';
  const noText = hasNoText({ ...card, title: values.title, say: values.say } as Card);
  const state = (f: FillField): FillState => (field === f && busy ? (phase.kind as FillState) : undefined);

  const sparkle = (f: FillField): ReactNode => {
    if (state(f) === 'working') {
      return (
        <span className="bk-fill-spark">
          <button type="button" className="bk-fill-btn" disabled aria-busy="true" aria-label="Write this with AI"><Spinner /></button>
        </span>
      );
    }
    const off = noText || (busy && field !== f);
    const open = menu === f;
    const filled = !!values[f].trim();
    return (
      <span className={`bk-fill-spark${open ? ' is-open' : ''}`}>
        {!open && <span role="tooltip" className="bk-fill-tip">{noText ? 'This card has no text to work from' : 'Write this with AI'}</span>}
        <button
          type="button"
          className="bk-fill-btn"
          disabled={off}
          aria-label="Write this with AI"
          {...(filled ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': open } : {})}
          onClick={() => (filled ? setMenu(open ? undefined : f) : start(f, 'write'))}
        >
          <SparkleIcon />
        </button>
        {open && (
          <span role="menu" aria-label="Write this with AI" className="bk-fill-menu">
            {MENU.map((m) => (
              <button key={m.mode} type="button" role="menuitem" onClick={() => start(f, m.mode)}>{m.label}</button>
            ))}
          </span>
        )}
      </span>
    );
  };

  const stopButton = <button type="button" className="bk-btn-sm bk-fill-stop" onClick={restore}>Stop</button>;

  const chip = (f: FillField): ReactNode => state(f) === 'done' && <span className="bk-fill-chip"><SparkleIcon size={10} />AI</span>;

  const below = (f: FillField): ReactNode => {
    if (field !== f) return null;
    if (phase.kind === 'done') {
      return (
        <div className="bk-fill-keep">
          <button type="button" className="bk-fill-keep-btn is-primary" onClick={keepIt}>Keep</button>
          <button type="button" className="bk-fill-keep-btn" onClick={restore}>Undo</button>
        </div>
      );
    }
    if (phase.kind !== 'failed') return null;
    const again = () => job.current && start(f, job.current.mode);
    return (
      <div className="bk-fill-error">
        <AiState state={phase.state} provider={phase.provider} surface="card" actions={{ onRetry: again, onAskChrome: again, onPick: openAiSettings, onSettings: openAiSettings }} />
      </div>
    );
  };

  // Esc while the menu is open, working or before Keep: caught before the board's own Esc (which closes the panel).
  const onEsc = useRef<() => void>(undefined);
  onEsc.current = () => (menu ? setMenu(undefined) : restore());
  const listening = !!menu || busy;
  useEffect(() => {
    if (!listening) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onEsc.current?.();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [listening]);

  return { state, sparkle, stopButton, chip, below };
}
