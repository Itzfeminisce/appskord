import type { ReactNode } from 'react';
import type { AiMode } from '../lib/types';
import { actionStyle, GroqAccess, PenvDisconnected } from './StatesSetup';

type Tone = 'plain' | 'warning' | 'error';
type Glyph = 'cross' | 'clock' | 'warn' | 'wifi-off' | 'info';

const TONE: Record<Tone, { bg: string; line: string }> = {
  plain: { bg: 'var(--surface)', line: 'var(--line)' },
  warning: { bg: 'var(--warning-bg)', line: 'var(--warning-line)' },
  error: { bg: 'var(--error-bg)', line: 'var(--error-line)' },
};

function Icon({ glyph }: { glyph: Glyph }) {
  const p = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, style: { flexShrink: 0 } };
  if (glyph === 'cross') return <svg {...p} stroke="#B91C1C"><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></svg>;
  if (glyph === 'clock') return <svg {...p} stroke="#B45309"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
  if (glyph === 'warn') return <svg {...p} stroke="#B45309"><path d="M12 3.5l9.5 16.5h-19z" /><path d="M12 10v4.5M12 17.5v.01" /></svg>;
  if (glyph === 'wifi-off') return <svg {...p} stroke="var(--muted)"><path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19v.01M3 3l18 18" /></svg>;
  return <svg {...p} stroke="var(--muted)"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" /></svg>;
}

const secondary = { ...actionStyle, background: 'var(--surface)', color: 'var(--ink)', border: '1px solid #E0E0E4' } as const;

/** The card every Make a clip, Making and Your media state shares. */
function Notice({ tone = 'plain', glyph, title, children, actions, role }: { tone?: Tone; glyph: Glyph; title: string; children: ReactNode; actions?: ReactNode; role?: 'status' | 'alert' }) {
  const t = TONE[tone];
  return (
    <div role={role} style={{ padding: 14, borderRadius: 14, background: t.bg, border: `1px solid ${t.line}`, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <Icon glyph={glyph} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexGrow: 1, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>{children}</span>
        {actions && <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>{actions}</div>}
      </div>
    </div>
  );
}

export const PROMPT_PLACEHOLDER = 'Describe your clip, like “a 10-second promo for my podcast”';
export const PROMPT_EMPTY_HINT = 'Describe your clip, grab something from a page, or add your media.';

export function MakingFailed({ onTryAgain, onTemplates }: { onTryAgain?: () => void; onTemplates?: () => void }) {
  return (
    <Notice tone="error" role="alert" glyph="cross" title="Motikord couldn’t make this clip"
      actions={[<button key="a" type="button" onClick={onTryAgain} style={actionStyle}>Try again</button>, <button key="b" type="button" onClick={onTemplates} style={secondary}>See templates</button>]}>
      The AI’s answer didn’t work, even on a second try. Your prompt is kept. Try again, or start from a template.
    </Notice>
  );
}
export function GroqBusy({ seconds = 20, onTryNow }: { seconds?: number; onTryNow?: () => void }) {
  return (
    <Notice tone="warning" role="status" glyph="clock" title="Groq is busy right now" actions={<button type="button" onClick={onTryNow} style={actionStyle}>Try now</button>}>
      {`You’ve reached Groq’s free limit for the moment. Motikord will try again in ${seconds} seconds.`}
    </Notice>
  );
}
export function GroqBusyRetried({ onTryNow }: { onTryNow?: () => void }) {
  return (
    <Notice tone="warning" role="status" glyph="clock" title="Groq is still busy" actions={<button type="button" onClick={onTryNow} style={actionStyle}>Try now</button>}>
      Motikord tried again and Groq is still at its free limit. Try now, or come back in a few minutes.
    </Notice>
  );
}
export function GroqDown({ onOpenSettings }: { onOpenSettings?: () => void }) {
  return (
    <Notice tone="warning" role="alert" glyph="warn" title="Groq isn’t responding" actions={<button type="button" onClick={onOpenSettings} style={actionStyle}>Open Settings</button>}>
      Your clips are safe, and you can still edit by hand and export. Or let Chrome’s built-in AI write clips for now.
    </Notice>
  );
}
export function KeyNeeded({ onPasteKey }: { onPasteKey?: () => void }) {
  return (
    <Notice tone="warning" role="alert" glyph="warn" title="Paste your key again" actions={<button type="button" onClick={onPasteKey} style={actionStyle}>Paste a key</button>}>
      A pasted key is kept only until Chrome closes. Your clips are safe, and you can still edit by hand and export.
    </Notice>
  );
}
export function Offline() {
  return (
    <Notice role="status" glyph="wifi-off" title="You’re offline">
      Making and changing clips with words needs the internet. Editing by hand, the bundled music and exports still work.
    </Notice>
  );
}
export function TooLong() {
  return (
    <Notice role="status" glyph="info" title="Clips can be up to 60 seconds">
      Motikord made a 60-second clip. For a longer idea, make two clips.
    </Notice>
  );
}
export function MediaUnsupported({ name }: { name: string }) {
  return (
    <Notice tone="error" role="alert" glyph="cross" title={`Motikord can’t use “${name}”`}>
      Add images, videos, music or font files. The others were added.
    </Notice>
  );
}
export function VideoWontPlay({ name }: { name: string }) {
  return (
    <Notice tone="error" role="alert" glyph="cross" title={`Chrome can’t play “${name}”`}>
      Save it as MP4 or WebM and add it again.
    </Notice>
  );
}

export function GrabNotAllowed() {
  return (
    <Notice role="status" glyph="info" title="Motikord can’t pick from this page">
      Chrome doesn’t let extensions read its own pages or the Web Store. Open another site and try again.
    </Notice>
  );
}
export function GrabPictureUnreadable({ onPickAnother }: { onPickAnother?: () => void }) {
  return (
    <Notice tone="warning" role="status" glyph="warn" title="Couldn’t read that picture" actions={<button type="button" onClick={onPickAnother} style={actionStyle}>Pick another</button>}>
      The page wouldn’t let Motikord copy it, so it isn’t in your clip. Your other picks are still here.
    </Notice>
  );
}
export function GrabNothingPicked() {
  return (
    <div style={{ padding: '12px 14px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>Nothing picked yet</span>
      <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>Click a headline, image, logo, quote or table on the page.</span>
    </div>
  );
}

/** The one line under Making that says where the prompt went. */
export function AiFooter({ ai }: { ai: AiMode | 'groq' | 'builtin' }) {
  const groq = ai === 'cloud' || ai === 'groq';
  return <span style={{ textAlign: 'center', fontSize: 12, color: 'var(--faint)' }}>{groq ? 'Only your prompt went to Groq. Your media stayed here.' : 'Written on this computer by Chrome’s built-in AI. Nothing was sent.'}</span>;
}

const SHEET: [string, ReactNode][] = [
  ['prompt-empty · Make a clip', (
    <div style={{ padding: '12px 14px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ height: 70, borderRadius: 10, border: '1px solid #E0E0E4', padding: '10px 12px', fontSize: 14, color: 'var(--faint)' }}>{PROMPT_PLACEHOLDER}</span>
      <span aria-disabled="true" style={{ height: 44, borderRadius: 12, background: '#DCDCE0', color: 'var(--muted)', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Make clip</span>
      <span style={{ fontSize: 12, color: 'var(--faint)', textAlign: 'center' }}>{PROMPT_EMPTY_HINT}</span>
    </div>
  )],
  ['making-failed · Making your clip', <MakingFailed />],
  ['groq-busy · Making your clip, Editor', <GroqBusy />],
  ['groq-busy-retried · Making your clip, Editor', <GroqBusyRetried />],
  ['groq-down · Make a clip, Editor', <GroqDown />],
  ['key-needed · Making your clip', <KeyNeeded />],
  ['penv-disconnected · Make a clip (banner)', <PenvDisconnected />],
  ['offline · Make a clip, Editor (banner)', <Offline />],
  ['too-long · Making your clip', <TooLong />],
  ['groq-access · first “Make clip” (Chrome asks once)', <GroqAccess />],
  ['grab-not-allowed · Grab from the page', <GrabNotAllowed />],
  ['grab-nothing-picked · Grab from the page', <GrabNothingPicked />],
  ['grab-picture-unreadable · Grab from the page', <GrabPictureUnreadable />],
  ['media-unsupported · Your media', <MediaUnsupported name="brochure.pdf" />],
  ['video-wont-play · Your media', <VideoWontPlay name="drone-shot.mov" />],
  ['ai-footer · Making your clip (one line per AI)', (
    <div style={{ padding: '12px 14px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: 'var(--muted)' }}>
      <span>Only your prompt went to Groq. Your media stayed here.</span>
      <span>Written on this computer by Chrome’s built-in AI. Nothing was sent.</span>
    </div>
  )],
];

/** Every Make a clip, Making and Your media state on one sheet. */
export default function StatesCreate() {
  return (
    <main data-frame="StatesCreate" style={{ padding: '20px 12px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {SHEET.map(([label, card]) => (
        <section key={label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 className="mono" style={{ margin: 0, padding: '0 4px', fontSize: 11, fontWeight: 500, color: 'var(--faint)' }}>{label}</h2>
          {card}
        </section>
      ))}
    </main>
  );
}
