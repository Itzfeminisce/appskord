import type { ReactNode } from 'react';
import { PROVIDERS } from '../lib/providers';
import type { VoicePath } from '../lib/voice/path';
import type { VoiceCard } from '../lib/voice/useVoice';
import { languageName } from '../lib/voice/useVoice';
import type { Provider } from '../lib/types';
import { actionStyle } from './StatesSetup';

// StatesVoice frame: every voice prompt state. Strings are verbatim from the frame.

const secondary = { ...actionStyle, background: 'var(--surface)', color: 'var(--ink)', border: '1px solid #E0E0E4' } as const;
const svg = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', strokeWidth: 2, strokeLinecap: 'round' as const, 'aria-hidden': true, style: { flexShrink: 0 } };
export const MIC_PATHS = <><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></>;

type Tone = 'plain' | 'error' | 'warning';
const TONE: Record<Tone, { bg: string; line: string }> = {
  plain: { bg: 'var(--surface)', line: 'var(--line)' },
  error: { bg: 'var(--error-bg)', line: 'var(--error-line)' },
  warning: { bg: 'var(--warning-bg)', line: 'var(--warning-line)' },
};
const ICONS = {
  mic: <svg {...svg} stroke="#BE185D" strokeLinejoin="round">{MIC_PATHS}</svg>,
  cross: <svg {...svg} stroke="#B91C1C"><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></svg>,
  warn: <svg {...svg} stroke="#B45309" strokeLinejoin="round"><path d="M12 3.5l9.5 16.5h-19z" /><path d="M12 10v4.5M12 17.5v.01" /></svg>,
  info: <svg {...svg} stroke="#5F6168"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" /></svg>,
  spin: <svg {...svg} stroke="#BE185D" strokeWidth={2.4} style={{ flexShrink: 0, animation: 'spin 0.8s linear infinite' }}><path d="M12 3a9 9 0 1 0 9 9" /></svg>,
};

function Notice({ tone = 'plain', icon, title, children, actions, role = 'status' }: { tone?: Tone; icon: keyof typeof ICONS; title: string; children: ReactNode; actions?: ReactNode; role?: 'status' | 'alert' }) {
  const t = TONE[tone];
  return (
    <div role={role} data-state="voice" style={{ padding: 14, borderRadius: 14, background: t.bg, border: `1px solid ${t.line}`, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      {ICONS[icon]}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexGrow: 1, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>{children}</span>
        {actions && <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>{actions}</div>}
      </div>
    </div>
  );
}

export interface VoiceCardActions { onAllow?: () => void; onTypeInstead?: () => void; onOpenSettings?: () => void; onTryAgain?: () => void }

export function VoiceMicAccess({ onAllow, onTypeInstead }: VoiceCardActions) {
  return (
    <Notice icon="mic" title="Let Motikord hear you" actions={[<button key="a" type="button" onClick={onAllow} style={actionStyle}>Allow microphone</button>, <button key="b" type="button" onClick={onTypeInstead} style={secondary}>Type instead</button>]}>
      Chrome asks once for your microphone. Motikord only listens while the mic is lit and keeps no recording.
    </Notice>
  );
}
export function VoiceMicBlocked({ onOpenSettings, onTryAgain }: VoiceCardActions) {
  return (
    <Notice tone="error" role="alert" icon="cross" title="The microphone is blocked" actions={[<button key="a" type="button" onClick={onOpenSettings} style={actionStyle}>Open Chrome settings</button>, <button key="b" type="button" onClick={onTryAgain} style={secondary}>Try again</button>]}>
      Chrome is set to block it for Motikord. Allow it in Chrome’s settings for Motikord, then try again. You can still type.
    </Notice>
  );
}
export function VoiceNoMic({ onTryAgain }: VoiceCardActions) {
  return (
    <Notice tone="warning" role="alert" icon="warn" title="No microphone found" actions={<button type="button" onClick={onTryAgain} style={actionStyle}>Try again</button>}>
      Plug one in or check it’s turned on, then try again. You can still type.
    </Notice>
  );
}
export function VoiceNotHeard({ onTryAgain }: VoiceCardActions) {
  return (
    <Notice icon="info" title="Didn’t catch that" actions={<button type="button" onClick={onTryAgain} style={actionStyle}>Try again</button>}>
      Nothing was heard for 8 seconds. Move closer to the mic, or type instead.
    </Notice>
  );
}
export function VoiceGettingReady({ language = languageName() }: { language?: string }) {
  return (
    <Notice icon="spin" title="Getting voice typing ready…">
      {`Chrome downloads ${language} speech once. After that it works on this computer without the internet.`}
    </Notice>
  );
}
/** voice-transcribing: after Done, while the provider turns the recording into text. */
export function VoiceTranscribing() {
  return (
    <div role="status" data-state="voice" style={{ padding: '12px 14px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', gap: 12, alignItems: 'center' }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#BE185D" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0, animation: 'spin 0.8s linear infinite' }}><path d="M12 3a9 9 0 1 0 9 9" /></svg>
      <span style={{ fontSize: 13, color: 'var(--ink)' }}>Turning your words into text…</span>
    </div>
  );
}
/** voice-transcribe-failed: the typed text stays; Try again sends the same recording again. */
export function VoiceTranscribeFailed({ provider = 'groq', onTryAgain, onTypeInstead }: VoiceCardActions & { provider?: Provider }) {
  const name = PROVIDERS[provider].label;
  return (
    <Notice tone="warning" role="alert" icon="warn" title={`${name} couldn’t turn your voice into text`}
      actions={[<button key="a" type="button" onClick={onTryAgain} style={{ ...actionStyle, background: 'var(--ink)' }}>Try again</button>, <button key="b" type="button" onClick={onTypeInstead} style={secondary}>Type instead</button>]}>
      {`Your key may have been refused, or ${name} is busy or down. Anything you typed is still there.`}
    </Notice>
  );
}
export function VoiceUnavailable({ provider = 'groq' }: { provider?: Provider }) {
  return (
    <Notice icon="info" title="Voice typing isn’t available here">
      {`This computer can’t turn speech into text, and ${PROVIDERS[provider].label} doesn’t offer it. Type your prompt instead.`}
    </Notice>
  );
}

/** The card for a voice state, wired to the hook's actions. */
export function VoiceStateCard({ card, provider, actions }: { card: VoiceCard; provider: Provider; actions: VoiceCardActions }) {
  switch (card) {
    case 'voice-transcribing': return <VoiceTranscribing />;
    case 'voice-transcribe-failed': return <VoiceTranscribeFailed provider={provider} {...actions} />;
    case 'voice-mic-access': return <VoiceMicAccess {...actions} />;
    case 'voice-mic-blocked': return <VoiceMicBlocked {...actions} />;
    case 'voice-no-mic': return <VoiceNoMic {...actions} />;
    case 'voice-not-heard': return <VoiceNotHeard {...actions} />;
    case 'voice-getting-ready': return <VoiceGettingReady />;
    case 'voice-unavailable': return <VoiceUnavailable provider={provider} />;
  }
}

/** voice-footer: one line per way speech becomes text. */
export function voiceFooterLine(path: VoicePath): string {
  return path.kind === 'cloud'
    ? `Your voice goes to ${PROVIDERS[path.provider].label} to become text. Motikord keeps no recording.`
    : 'Speech becomes text on this computer. No recording is kept.';
}
export function VoiceFooter({ path }: { path: VoicePath }) {
  return (
    <span style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'center' }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#15803D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
      {voiceFooterLine(path)}
    </span>
  );
}

/** voice-settings-line: the last row of Settings "Voice prompts". */
export function voiceSettingsLine(path: VoicePath, provider: Provider): string {
  if (path.kind === 'local') return 'Speech becomes text on this computer.';
  if (path.kind === 'cloud') return `This computer can’t do it, so your voice goes to ${PROVIDERS[path.provider].label} to become text.`;
  return `Voice typing isn’t available with ${PROVIDERS[provider].label} on this computer.`;
}

const lines = (xs: ReactNode[]) => (
  <div style={{ padding: '12px 14px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: 'var(--muted)' }}>{xs}</div>
);

/** voice-mic-tab, as drawn: the mic tab's page with Chrome's own box over it. */
function MicTabPreview() {
  return (
    <div style={{ borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', overflow: 'hidden' }}>
      <div style={{ height: 30, background: '#F1F1F3', display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', fontSize: 11, color: 'var(--muted)' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />Motikord · Microphone</div>
      <div style={{ position: 'relative', padding: '70px 24px 28px', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', textAlign: 'center' }}>
        <div style={{ position: 'absolute', top: 10, left: 12, width: 220, padding: '10px 12px', borderRadius: 10, background: '#FFFFFF', boxShadow: '0 6px 20px rgba(16,16,20,0.18)', textAlign: 'left', fontSize: 11 }}>Chrome’s own box: “Use your microphones” · Allow</div>
        <span style={{ width: 44, height: 44, borderRadius: '50%', background: '#FDF2F8', color: 'var(--accent)', display: 'grid', placeItems: 'center' }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{MIC_PATHS}</svg></span>
        <span style={{ fontSize: 16, fontWeight: 600 }}>Allow your microphone</span>
        <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>Choose Allow in Chrome’s box. This tab closes by itself and you can speak in the side panel.</span>
      </div>
    </div>
  );
}

/** voice-editor, as drawn: the editor prompt box while listening. */
export function EditorListening({ settled, interim, onDone }: { settled: string; interim: string; onDone?: () => void }) {
  return (
    <div data-voice="listening" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ height: 46, boxSizing: 'border-box', borderRadius: 14, background: 'var(--surface)', border: '1.5px solid var(--accent)', boxShadow: '0 0 0 4px #FCE7F3', display: 'flex', alignItems: 'center', gap: 10, padding: '0 6px 0 8px' }}>
        <span style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent)', color: '#FFFFFF', display: 'grid', placeItems: 'center', flexShrink: 0 }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{MIC_PATHS}</svg></span>
        <span aria-live="polite" style={{ flexGrow: 1, minWidth: 0, fontSize: 14, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{settled}{settled && interim ? ' ' : ''}<span style={{ color: '#9A9CA3' }}>{interim}</span></span>
        <button type="button" onClick={onDone} style={{ height: 34, padding: '0 12px', border: 0, borderRadius: 10, background: 'var(--ink)', color: '#FFFFFF', font: '600 13px/1 var(--font)', cursor: 'pointer' }}>Done</button>
      </div>
      <span style={{ padding: '0 4px', fontSize: 12, color: 'var(--muted)' }}>Listening… Done puts the words in the box. Press send when they look right.</span>
    </div>
  );
}

const SHEET: [string, ReactNode][] = [
  ['voice-mic-access · Make a clip, Editor (first tap on the mic)', <VoiceMicAccess />],
  ['voice-mic-tab · small Motikord tab that shows Chrome’s prompt', <MicTabPreview />],
  ['voice-mic-blocked · Make a clip, Editor', <VoiceMicBlocked />],
  ['voice-no-mic · Make a clip, Editor', <VoiceNoMic />],
  ['voice-not-heard · Make a clip, Editor', <VoiceNotHeard />],
  ['voice-getting-ready · Make a clip, Editor (first use of a language)', <VoiceGettingReady />],
  ['voice-unavailable · Make a clip, Editor', <VoiceUnavailable />],
  ['voice-transcribing · Make a clip, Editor (after Done, cloud speech to text)', <VoiceTranscribing />],
  ['voice-transcribe-failed · Make a clip, Editor (key refused, busy or down)', <VoiceTranscribeFailed provider="openai" />],
  ['voice-editor · Editor prompt box while listening', <EditorListening settled="Make the title" interim="bigger and slower" />],
  ['voice-footer · while listening (one line per way speech becomes text)', lines([
    <span key="a"><strong style={{ color: 'var(--ink)', fontWeight: 600 }}>On this computer:</strong> {voiceFooterLine({ kind: 'local', download: false })}</span>,
    <span key="b"><strong style={{ color: 'var(--ink)', fontWeight: 600 }}>Groq or OpenAI:</strong> Your voice goes to {'{provider}'} to become text. Motikord keeps no recording.</span>,
  ])],
  ['voice-settings-line · Settings, Voice prompts (last row)', lines([
    <span key="a">{voiceSettingsLine({ kind: 'local', download: false }, 'groq')}</span>,
    <span key="b">{voiceSettingsLine({ kind: 'cloud', provider: 'groq' }, 'groq')}</span>,
    <span key="c">{voiceSettingsLine({ kind: 'unavailable' }, 'anthropic')}</span>,
  ])],
];

export default function StatesVoice() {
  return (
    <main data-frame="StatesVoice" style={{ padding: '20px 12px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {SHEET.map(([label, card]) => (
        <section key={label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 className="mono" style={{ margin: 0, padding: '0 4px', fontSize: 11, fontWeight: 500, color: 'var(--faint)' }}>{label}</h2>
          {card}
        </section>
      ))}
    </main>
  );
}
