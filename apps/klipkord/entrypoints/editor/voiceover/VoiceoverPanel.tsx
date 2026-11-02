import { C, Icon, iconButton } from '../ui';
import { meterBars } from '@/lib/project/media';
import { clock } from '../format';
import { StateCard } from '../states/StateCard';
import { Switch, TL_ICONS } from '../timeline/controls';
import { cancelTake, stopTake } from './record';
import { setVoiceover, useVoiceover } from './state';

const STOP_ICON = <rect x="4" y="4" width="16" height="16" rx="2" />;

/** The recording pill over the preview: time, level and Stop. */
export function VoiceoverPill() {
  const v = useVoiceover();
  if (v.phase !== 'counting' && v.phase !== 'recording') return null;
  return (
    <div role="status" aria-label="Recording voiceover" style={{ position: 'fixed', top: 62, left: 'calc(320px + (100vw - 624px) / 2)', transform: 'translateX(-50%)', zIndex: 14, display: 'flex', alignItems: 'center', gap: 12, padding: '6px 6px 6px 14px', borderRadius: 999, background: C.panel, border: `1px solid ${C.line}`, boxShadow: '0 10px 30px rgba(0,0,0,0.4)', color: C.text }}>
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#DC2626' }} />
      <span style={{ fontSize: 13, fontWeight: 600 }}>Recording voiceover</span>
      <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 12.5, color: C.secondary }}>
        {v.phase === 'counting' ? String(v.count) : `${clock(v.elapsed)} / ${clock(v.total)}`}
      </span>
      <span aria-hidden="true" style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 16 }}>
        {meterBars(v.phase === 'recording' ? v.level : 0).map((h, i) => <span key={i} style={{ width: 3, height: h, borderRadius: 1, background: C.ok }} />)}
      </span>
      <button type="button" onClick={stopTake} style={{ height: 30, padding: '0 12px', borderRadius: 8, background: C.text, color: C.ground, border: 0, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
        <Icon size={15}>{STOP_ICON}</Icon><span>Stop</span>
      </button>
    </div>
  );
}

/** Covers the inspector while a take runs: the Voiceover frame's panel, or the no-mic card when the mic is blocked. */
export function VoiceoverPanel({ onAllowMic }: { onAllowMic(): void }) {
  const v = useVoiceover();
  if (v.phase === 'idle') return null;
  const close = () => { cancelTake(); setVoiceover({ phase: 'idle' }); };
  return (
    <div role="region" aria-label="Voiceover" style={{ position: 'absolute', inset: 0, zIndex: 5, display: 'flex', flexDirection: 'column', background: C.panel }}>
      <div style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px 0 6px', borderBottom: `1px solid ${C.line}` }}>
        <button type="button" aria-label="Back to the inspector" title="Back to the inspector" onClick={close} style={iconButton(28)}><Icon>{TL_ICONS.close}</Icon></button>
        <span style={{ color: C.accentText, display: 'flex' }}><Icon size={15}>{TL_ICONS.mic}</Icon></span>
        <span style={{ fontSize: 13, fontWeight: 600, flexGrow: 1 }}>Voiceover</span>
      </div>
      <div style={{ flexGrow: 1, overflow: 'hidden', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {v.phase === 'no-mic' ? (
          <StateCard state="no-mic" compact title="Klipkord can't hear your mic" body="Allow the microphone to record a voiceover."
            actions={[{ label: 'Allow mic', tone: 'primary', onClick: onAllowMic }]} />
        ) : (
          <>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: C.secondary }}>Voiceover</div>
            <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: C.secondary }}>
              {`Recording over ${clock(v.rangeFrom)} to ${clock(v.rangeTo)}. The video plays without sound so you can talk over it. Headphones stop the speakers bleeding in.`}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 14px', fontSize: 12.5 }}>
              <span style={{ color: C.secondary }}>Mic</span><span>{v.mic || 'Microphone'}</span>
              <span style={{ color: C.secondary }}>Original voice</span><span>Muted under the voiceover</span>
            </div>
            <Switch on={v.clean} label="Clean and level the voiceover" onChange={(clean) => setVoiceover({ clean })} />
            <Switch on={v.countIn} label="Count in 3 seconds" onChange={(countIn) => setVoiceover({ countIn })} />
            <p style={{ margin: 0, fontSize: 11.5, color: C.muted }}>Press V to stop. Each take is kept; pick one after.</p>
            {v.phase === 'recording' && <p style={{ margin: 0, fontSize: 11.5, color: C.muted }}>Closing this tab stops it. Chrome asks before the tab closes.</p>}
          </>
        )}
      </div>
    </div>
  );
}
