// Pieces the telling screens share: the dark bar, the level meter, "Cover these" and the state banners.
import type { ReactNode } from 'react';
import { bar, METER_BARS, mmss, PROMPT_COUNT, type PromptRow } from './tell';
import '../../components/v4/states.css';
import './tell.css';

const svg = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export const MicIcon = ({ size = 16 }: { size?: number }) => (
  <svg {...svg} width={size} height={size} strokeWidth="2"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
);
export const KeyboardIcon = ({ size = 15 }: { size?: number }) => (
  <svg {...svg} width={size} height={size} strokeWidth="2"><rect x="3" y="6" width="18" height="12" rx="2.5" /><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" /></svg>
);
export const BackArrow = () => <svg {...svg} width="18" height="18" strokeWidth="2"><path d="M15 5l-7 7 7 7" /></svg>;
export const PauseBars = () => <svg {...svg} width="18" height="18" strokeWidth="2.4"><path d="M9 5v14M15 5v14" /></svg>;
export const Tick = ({ size = 11 }: { size?: number }) => <svg {...svg} width={size} height={size} strokeWidth="3"><path d="M5 12l5 5 9-10" /></svg>;
export const SendIcon = () => <svg {...svg} width="16" height="16" strokeWidth="2.2"><path d="M12 19V5M6 11l6-6 6 6" /></svg>;

const b18 = { ...svg, width: 18, height: 18, strokeWidth: 2 };
export const BANNER_ICONS = {
  micOff: <svg {...b18}><path d="M3 3l18 18M9 9v2a3 3 0 0 0 5.1 2.1M15 10V6a3 3 0 0 0-5.7-1.3M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.5 2.5M12 18v3" /></svg>,
  info: <svg {...b18}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.5" /></svg>,
  done: <svg {...b18}><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></svg>,
  offline: <svg {...b18}><path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 4.5-2.5M19 13a10 10 0 0 0-3-2M2 9.5a15 15 0 0 1 4-2.5M22 9.5A15 15 0 0 0 11 5.5M12 20h.01" /></svg>,
  warn: <svg {...b18}><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17v.5" /></svg>,
  calendar: <svg {...b18}><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M4 10h16M9 3v4M15 3v4" /></svg>,
  clock: <svg {...b18}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>,
};

export interface Action { label: string; onClick: () => void; dark?: boolean }

/** A V41States banner: v4's banner look with up to two actions. */
export function Banner({ tone, icon, title, body, actions = [], alert = false, children }: {
  tone: 'warn' | 'alert' | 'plain'; icon: keyof typeof BANNER_ICONS; title: string; body?: ReactNode; actions?: Action[]; alert?: boolean; children?: ReactNode;
}) {
  return (
    <div role={alert ? 'alert' : 'status'} className={`st4-banner st4-${tone}`}>
      <span className="st4-icon">{BANNER_ICONS[icon]}</span>
      <span className="st4-text" style={{ flex: 1 }}>
        <span className="st4-title">{title}</span>
        {body && <span className="st4-body">{body}</span>}
        {children}
        {actions.length > 0 && (
          <div className="st4-actions">
            {actions.map((a) => <button key={a.label} type="button" className={a.dark ? 'st4-primary' : 'st4-light'} onClick={a.onClick}>{a.label}</button>)}
          </div>
        )}
      </span>
    </div>
  );
}

/** The microphone level, newest bar last. */
export function Meter({ levels, bars = METER_BARS }: { levels: number[]; bars?: number }) {
  const shown = [...Array(Math.max(0, bars - levels.length)).fill(0), ...levels.slice(-bars)] as number[];
  return (
    <span role="img" aria-label="Microphone level" className="ct-meter">
      {shown.map((l, i) => { const b = bar(l); return <span key={i} className={b.on ? 'on' : undefined} style={{ height: b.h }} />; })}
    </span>
  );
}

/** "Cover these": ticks with the time each was covered (`covered` label when typing). */
export function Prompts({ rows, covered, typing = false }: { rows: PromptRow[]; covered: number; typing?: boolean }) {
  return (
    <div className="ct-prompts-wrap">
      <section aria-label="Prompts" className="ct-prompts">
        <div className="ct-prompts-head"><h2>Cover these</h2><span className="ct-prompts-count">{`${covered} of ${PROMPT_COUNT}`}</span></div>
        <ol>
          {rows.map((r) => (
            <li key={r.prompt} className={`ct-prompt ct-prompt-${r.state}`}>
              <span className="ct-sr">{r.state === 'covered' ? 'Covered: ' : r.state === 'now' ? 'Talking about now: ' : 'Not yet: '}</span>
              {r.state === 'covered' ? <span className="ct-tick"><Tick /></span> : r.state === 'now' ? <span className="ct-spin" /> : <span className="ct-todo" />}
              <span className="ct-prompt-text">{r.text}</span>
              {r.state === 'now' && <span className="ct-now">Now</span>}
              {r.state === 'covered' && (typing ? <span className="ct-covered-label">Covered</span> : <span className="ct-prompt-at">{mmss(r.atMs ?? 0)}</span>)}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/** "Stop catching up?": Back while talking. */
export function LeaveDialog({ onKeep, onSave, onDiscard }: { onKeep: () => void; onSave: () => void; onDiscard: () => void }) {
  return (
    <div className="ct-scrim">
      <div role="dialog" aria-modal="true" aria-label="Stop catching up?" className="ct-dialog">
        <h3>Stop catching up?</h3>
        <p>What you said so far is kept. You can add more later.</p>
        <div className="ct-dialog-actions">
          <button type="button" className="ct-btn ct-btn-dark" onClick={onKeep} autoFocus>Keep talking</button>
          <button type="button" className="ct-btn" onClick={onSave}>Stop and save</button>
          <button type="button" className="ct-btn ct-btn-danger" onClick={onDiscard}>Discard</button>
        </div>
      </div>
    </div>
  );
}
