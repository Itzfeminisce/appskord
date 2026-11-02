// Pieces the brief, its agenda editor, the brief tab and the look back share.
import type { ReactNode } from 'react';
import { SOURCE_LABEL } from '@/lib/memory/agenda';
import type { AgendaItem } from '@/lib/memory/types';
import { BrandMark } from '../../components/TopBar';
import { BackIcon, SearchIcon, SlidersIcon } from '../../components/v4/icons';
import { useRouter } from '../../router';
import '../../components/v4/shell.css';
import './brief.css';

const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
export const QuestionMark = () => <svg {...base} width="12" height="12" strokeWidth="2.4"><path d="M9 9.5a3 3 0 015.5 1.5c0 2-2.5 2.5-2.5 4M12 19h.01" /></svg>;
export const ArrowIcon = () => <svg {...base} width="12" height="12" strokeWidth="2.4"><path d="M4 12h13M12 6l6 6-6 6" /></svg>;
export const DiamondIcon = () => <svg {...base} width="12" height="12" strokeWidth="2.4"><path d="M12 3l9 9-9 9-9-9z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></svg>;
export const TickIcon = () => <svg {...base} width="16" height="16" strokeWidth="2.4" stroke="#1A6B40"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
export const GripIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    {[6, 12, 18].flatMap((y) => [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.8" />))}
  </svg>
);
export const RemoveIcon = () => <svg {...base} width="16" height="16" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>;
export const PlusIcon = () => <svg {...base} width="16" height="16" strokeWidth="2.2"><path d="M12 5v14M5 12h14" /></svg>;
export const DownloadIcon = () => <svg {...base} width="16" height="16" strokeWidth="2.2"><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></svg>;

const TINTS: [string, string][] = [['#DDE3FF', '#2E2A8A'], ['#DDF1E6', '#17603A'], ['#FDE7D3', '#8A4B00']];
/** A steady tint per name, as the brief and look back frames draw people. */
export function briefTint(name: string): { background: string; color: string } {
  const [background, color] = TINTS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % TINTS.length]!;
  return { background, color };
}
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '') + (words.length > 1 ? words.at(-1)![0] : '')).toUpperCase();
}

/** 28 px initials; a dashed ring for someone Rekord does not know yet. */
export function Face({ name, known = true, size = 28 }: { name: string; known?: boolean; size?: number }) {
  return (
    <span aria-hidden="true" className={known ? 'bp-face' : 'bp-face bp-face-new'} style={{ ...(known ? briefTint(name) : {}), width: size, height: size }}>
      {initialsOf(name)}
    </span>
  );
}

export type ChipTone = 'promise' | 'late' | 'question' | 'decision' | 'plain' | 'you' | 'new';
export function Pill({ tone, children, className }: { tone: ChipTone; children: ReactNode; className?: string }) {
  return <span className={`bp-chip bp-chip-${tone}${className ? ` ${className}` : ''}`}>{children}</span>;
}

/** The agenda source tag, with the kind's icon where the frames draw one. */
export function SourceTag({ source }: { source: AgendaItem['source'] }) {
  if (source === 'promise') return <Pill tone="promise"><ArrowIcon />{SOURCE_LABEL.promise}</Pill>;
  if (source === 'question') return <Pill tone="question"><QuestionMark />{SOURCE_LABEL.question}</Pill>;
  return <Pill tone={source === 'you' ? 'you' : 'plain'}>{SOURCE_LABEL[source]}</Pill>;
}

/** The dark record button with its red dot. */
export function RecordButton({ label, onClick, tall = false, dot = true }: { label: string; onClick: () => void; tall?: boolean; dot?: boolean }) {
  return (
    <button type="button" className={tall ? 'bp-record bp-record-tall' : 'bp-record'} onClick={onClick}>
      {dot && <span className="bp-dot" />}
      {label}
    </button>
  );
}

/** The 56 px header with a back button before the Rekord mark. */
export function BackHeader({ label, onBack }: { label: string; onBack: () => void }) {
  const { navigate } = useRouter();
  return (
    <header className="bp-head">
      <div className="bp-head-left">
        <button type="button" className="v4-icon" aria-label={label} onClick={onBack}><BackIcon /></button>
        <div className="brand"><BrandMark />Rekord</div>
      </div>
      <div className="v4-head-icons">
        <button type="button" className="v4-icon" aria-label="Ask all meetings" onClick={() => navigate('askall')}><SearchIcon /></button>
        <button type="button" className="v4-icon" aria-label="Settings" onClick={() => navigate('settingsMemory')}><SlidersIcon /></button>
      </div>
    </header>
  );
}
