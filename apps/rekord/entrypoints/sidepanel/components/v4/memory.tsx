import type { ReactNode } from 'react';
import type { ItemKind } from '@/lib/memory/types';
import './memory.css';

const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export const PromiseIcon = () => <svg {...base} width="13" height="13" strokeWidth="2.2"><path d="M4 12h13M12 6l6 6-6 6" /></svg>;
export const DecisionIcon = () => <svg {...base} width="13" height="13" strokeWidth="2.2"><path d="M12 3l9 9-9 9-9-9z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></svg>;
export const QuestionIcon = () => <svg {...base} width="13" height="13" strokeWidth="2.2"><path d="M9 9a3 3 0 1 1 4.5 2.6c-1 .6-1.5 1.2-1.5 2.4M12 17.5v.01" /></svg>;
export const QuestionRingIcon = () => <svg {...base} width="13" height="13" strokeWidth="2.2"><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01" /></svg>;
export const PersonIcon = () => <svg {...base} width="13" height="13" strokeWidth="2.2"><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-4 3-6 7-6s7 2 7 6" /></svg>;
export const EditIcon = () => <svg {...base} width="16" height="16" strokeWidth="2"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>;
export const CloseIcon = () => <svg {...base} width="16" height="16" strokeWidth="2.2"><path d="M6 6l12 12M18 6L6 18" /></svg>;
export const PlayIcon = () => <svg {...base} width="14" height="14" strokeWidth="2"><path d="M8 5l11 7-11 7z" /></svg>;
export const ChevronIcon = () => <svg {...base} width="16" height="16" strokeWidth="2"><path d="M9 6l6 6-6 6" /></svg>;
export const MailIcon = () => <svg {...base} width="18" height="18" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3 8l9 6 9-6" /></svg>;
export const SendIcon = () => <svg {...base} width="18" height="18" strokeWidth="2"><path d="M4 12l16-8-6 16-2-7z" /></svg>;

export type Tone = ItemKind | 'person';
export const KIND_ICON: Record<Tone, () => ReactNode> = { promise: PromiseIcon, decision: DecisionIcon, question: QuestionIcon, person: PersonIcon };

/** The coloured group pill: "Promises" with the hand-off arrow. */
export function KindPill({ tone, children, icon }: { tone: Tone; children: ReactNode; icon?: () => ReactNode }) {
  const Icon = icon ?? KIND_ICON[tone];
  return <span className={`mem-pill mem-${tone}`}><Icon />{children}</span>;
}

export function Chip({ tone = 'plain', children }: { tone?: 'promise' | 'plain' | 'warn'; children: ReactNode }) {
  return <span className={`mem-chip mem-chip-${tone}`}>{children}</span>;
}

/** The proof: quote, then meeting · date · time, and a play button that opens the transcript there. */
export function QuoteBlock({ speaker, text, meta, onPlay }: { speaker: string; text: string; meta: string; onPlay: () => void }) {
  return (
    <div className="mem-quote">
      <span className="mem-quote-text">
        <span className="mem-quote-said">{`${speaker}: “${text}”`}</span>
        <span className="mem-quote-meta">{meta}</span>
      </span>
      <button type="button" className="mem-play" aria-label="Play from this moment" onClick={onPlay}>
        <span><PlayIcon /></span>
      </button>
    </div>
  );
}

/** A 44 px tap target around a 32 px pill, as the frames draw choice chips. */
export function ChoiceChip({ children, onClick, dark = false, label }: { children: ReactNode; onClick: () => void; dark?: boolean; label?: string }) {
  return (
    <button type="button" className="mem-choice" aria-label={label} onClick={onClick}>
      <span className={dark ? 'mem-choice-pill mem-choice-dark' : 'mem-choice-pill'}>{children}</span>
    </button>
  );
}
