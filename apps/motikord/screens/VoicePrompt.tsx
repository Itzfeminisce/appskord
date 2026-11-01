import { Spinner } from '../components/ui';
import { formatTimer } from '../lib/voice/listen';
import { MIC_PATHS } from './StatesVoice';
import Home from './Home';

// VoicePrompt frame: Home's prompt card while listening.

export const VOICE_MAKE_HINT = 'Ready once you’re done speaking. You can edit the words first.';
export const VOICE_LISTEN_HINT = 'Say what the clip should show. Motikord stops when you pause for 3 seconds.';

export interface ListeningProps {
  before: string; after: string; settled: string; interim: string;
  ms: number; levels: number[]; transcribing?: boolean;
  onDone?: () => void; onCancel?: () => void;
}

export function HomeListening({ before, after, settled, interim, ms, levels, transcribing, onDone, onCancel }: ListeningProps) {
  const gap = (a: string, b: string) => (a && b && !/\s$/.test(a) ? ' ' : '');
  return (
    <>
      <div data-voice="listening" style={{ margin: '14px 16px 0', padding: 14, borderRadius: 16, background: 'var(--surface)', border: '1.5px solid var(--accent)', boxShadow: '0 0 0 4px #FCE7F3', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>What should the clip show?</span>
        <div aria-live="polite" style={{ minHeight: 96, borderRadius: 12, padding: '10px 12px', background: '#FDF2F8', fontSize: 14, lineHeight: 1.5, color: 'var(--ink)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {before}{gap(before, settled || interim)}{settled}{gap(settled, interim)}<span style={{ color: '#9A9CA3' }}>{interim}</span>
          <span style={{ display: 'inline-block', width: 2, height: 16, marginLeft: 2, verticalAlign: -3, background: 'var(--accent)' }} />
          {after && !/^\s/.test(after) ? ' ' : ''}{after}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ position: 'relative', width: 44, height: 44, flexShrink: 0, display: 'grid', placeItems: 'center' }}>
            <span style={{ position: 'absolute', inset: -6, borderRadius: '50%', background: '#FCE7F3', opacity: transcribing ? 0 : 1 }} />
            <span style={{ position: 'relative', width: 44, height: 44, borderRadius: '50%', background: transcribing ? '#F1BFD6' : 'var(--accent)', color: '#FFFFFF', display: 'grid', placeItems: 'center' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{MIC_PATHS}</svg>
            </span>
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600, display: 'flex', gap: 8, alignItems: 'baseline' }}>Listening…<span className="mono" style={{ fontSize: 11, fontWeight: 400, color: 'var(--faint)' }}>{formatTimer(ms)}</span></span>
            <span aria-hidden="true" style={{ display: 'flex', alignItems: 'center', gap: 3, height: 24 }}>
              {levels.map((l, i) => <span key={i} style={{ width: 3, height: Math.max(4, Math.round(4 + l * 20)), borderRadius: 2, background: 'var(--accent)', opacity: 0.5 + l * 0.5 }} />)}
            </span>
          </span>
          {transcribing
            ? <Spinner size={20} />
            : <button type="button" onClick={onDone} style={{ height: 34, padding: '0 14px', border: 0, borderRadius: 9, background: 'var(--ink)', color: '#FFFFFF', font: '600 13px/1 var(--font)', cursor: 'pointer' }}>Done</button>}
        </div>
      </div>
      <div style={{ margin: '8px 20px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--faint)' }}>{VOICE_LISTEN_HINT}</span>
        <button type="button" onClick={onCancel} style={{ border: 0, background: 'none', padding: 0, font: '500 12px var(--font)', color: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }}>Cancel</button>
      </div>
    </>
  );
}

/** Route screen (dev `?screen=VoicePrompt`): Home as drawn while listening, with the frame's words and no microphone. */
export default function VoicePrompt() {
  return <Home preview={{ settled: 'A 15-second promo for our new sourdough, warm and friendly,', interim: 'ending with order today', ms: 7_000 }} />;
}
