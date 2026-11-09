import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getKey, type KeyName } from '../../lib/settings';
import type { SpeechProvider } from '../../lib/voice/path';
import { transcribeCues } from '../../lib/voice/captions';
import { makeVoiceover, VOICES, type VoiceId } from '../../lib/voice/speech';
import { STATES } from '../states/copy';
import { clock } from './model';
import { useEditorV3 } from './context';
import { CAPTION_POSITION, CAPTION_STYLES, hasCaptions, scriptOf, writeCaptions, type CaptionStyle } from './CaptionsVoiceEdits';
import { C, Chip, hint, primaryButton, quietButton, Segmented, Switch } from './ui';

// The "Voice and captions" panel. Both features are off until switched on. Only the narration audio goes to
// speech-to-text; only the script goes to the voice provider. Keys come from the session store, never props.

export type CaptionsCard = 'captions-failed' | 'captions-no-key' | 'captions-no-voice';
export type VoiceCard = 'voiceover-failed' | 'voiceover-no-key';

export interface CaptionsVoiceProps {
  /** Who writes the narration down. */
  provider?: SpeechProvider;
  /** The clip's narration audio, if any. */
  narration?: Blob;
  lang?: string;
  /** Test seams: key lookup and fetch. */
  keyOf?: (name: KeyName) => Promise<string | undefined>;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Hands the made voice to the clip's audio; returns its length in ms. */
  onVoiceover?: (audio: Blob, voice: VoiceId) => Promise<number> | number;
  onChooseNarration?: () => void;
  /** Paste a key for this provider (both no-key cards): the speech provider for captions, OpenAI for the voice. */
  onAddKey?: (provider: SpeechProvider) => void;
  /** Connect Penv Cloud (captions-no-key). */
  onConnectPenv?: () => void;
  onSettings?: () => void;
  /** Defaults to closing the editor overlay. */
  onClose?: () => void;
}

const PROVIDER_NAME: Record<SpeechProvider, string> = { groq: 'Groq', openai: 'OpenAI' };

export function CaptionsVoice(p: CaptionsVoiceProps) {
  const ed = useEditorV3();
  const keyOf = p.keyOf ?? getKey;
  const provider = p.provider ?? 'groq';
  const [captions, setCaptions] = useState(() => hasCaptions(ed.state));
  const written = hasCaptions(ed.state);
  // Undo and redo change the clip under the switch; it follows.
  useEffect(() => { setCaptions(written); }, [written]);
  const [style, setStyle] = useState<CaptionStyle>('pop');
  const [capCard, setCapCard] = useState<CaptionsCard>();
  const [capBusy, setCapBusy] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [voice, setVoice] = useState<VoiceId>('warm');
  const [script, setScript] = useState('');
  const [voiceCard, setVoiceCard] = useState<VoiceCard>();
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [madeMs, setMadeMs] = useState<number>();
  const capAbort = useRef<AbortController | undefined>(undefined);
  const voiceAbort = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => { capAbort.current?.abort(); voiceAbort.current?.abort(); }, []);
  // A key added in the side panel clears the card that asked for it.
  const noKey = { cap: capCard === 'captions-no-key', voice: voiceCard === 'voiceover-no-key' };
  useEffect(() => {
    if (!noKey.cap && !noKey.voice) return;
    const recheck = () => {
      if (noKey.cap) void keyOf(provider).then((k) => { if (k) setCapCard((c) => (c === 'captions-no-key' ? undefined : c)); }).catch(() => undefined);
      if (noKey.voice) void keyOf('openai').then((k) => { if (k) setVoiceCard((c) => (c === 'voiceover-no-key' ? undefined : c)); }).catch(() => undefined);
    };
    const onChange = (_c: unknown, area: string) => { if (area === 'session') recheck(); };
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
    // keyOf is a stable seam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noKey.cap, noKey.voice, provider]);
  const begin = (ref: { current: AbortController | undefined }) => {
    ref.current?.abort();
    return (ref.current = new AbortController());
  };
  const text = (scene: number, layer: Parameters<typeof ed.text>[0]) => ed.text(layer, scene);

  const writeDown = async (chosen: CaptionStyle = style) => {
    setCapCard(undefined);
    if (!p.narration) { setCapCard('captions-no-voice'); return; }
    const key = await keyOf(provider);
    if (!key) { setCapCard('captions-no-key'); return; }
    const ctrl = begin(capAbort);
    setCapBusy(true);
    try {
      const cues = await transcribeCues(provider, key, p.narration, { lang: p.lang, fetch: p.fetch, signal: ctrl.signal, timeoutMs: p.timeoutMs });
      if (ctrl.signal.aborted) return;
      if (!cues.length) { setCapCard('captions-no-voice'); return; }
      ed.update((st) => writeCaptions(st, cues, chosen, 'Auto captions added'));
    } catch (error) {
      if (!ctrl.signal.aborted) {
        console.error('Motikord: could not write down the narration', error);
        setCapCard('captions-failed');
      }
    } finally {
      if (!ctrl.signal.aborted) setCapBusy(false);
    }
  };

  const toggleCaptions = (on: boolean) => {
    setCaptions(on);
    if (on) void writeDown();
    else { capAbort.current?.abort(); setCapBusy(false); setCapCard(undefined); ed.update((st) => writeCaptions(st, [], style, 'Auto captions removed')); }
  };
  const pickStyle = (s: CaptionStyle) => {
    setStyle(s);
    if (captions && hasCaptions(ed.state)) void writeDown(s);
  };

  const toggleVoice = async (on: boolean) => {
    setVoiceOn(on);
    setVoiceCard(undefined);
    if (!on) { voiceAbort.current?.abort(); setVoiceBusy(false); return; }
    if (!script) setScript(scriptOf(ed.state, text));
    if (!(await keyOf('openai'))) setVoiceCard('voiceover-no-key');
  };
  const make = async () => {
    if (!p.onVoiceover) return;
    setVoiceCard(undefined);
    const key = await keyOf('openai');
    if (!key) { setVoiceCard('voiceover-no-key'); return; }
    const ctrl = begin(voiceAbort);
    setVoiceBusy(true);
    try {
      const audio = await makeVoiceover(key, script, voice, { fetch: p.fetch, signal: ctrl.signal, timeoutMs: p.timeoutMs });
      if (ctrl.signal.aborted) return;
      const ms = await p.onVoiceover(audio, voice);
      if (!ctrl.signal.aborted) setMadeMs(ms);
    } catch (error) {
      if (!ctrl.signal.aborted) {
        console.error('Motikord: could not make the voiceover', error);
        setVoiceCard('voiceover-failed');
      }
    } finally {
      if (!ctrl.signal.aborted) setVoiceBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Voice and captions</span>
        <span style={{ fontFamily: "var(--mono, 'Geist Mono', monospace)", fontSize: 11, color: C.muted }}>Whole clip</span>
        <button type="button" aria-label="Close voice and captions" onClick={p.onClose ?? (() => ed.setOverlay(undefined))} style={{ width: 28, height: 28, border: 0, borderRadius: 7, background: 'transparent', cursor: 'pointer' }}>×</button>
      </div>
      <Card>
        <Row title="Auto captions" line={`Uses your narration. It goes to ${PROVIDER_NAME[provider]} to be written down.`} on={captions} onChange={toggleCaptions} />
        {captions && (
          <>
            <Segmented name="Caption style" options={CAPTION_STYLES} value={style} onChange={pickStyle} disabled={capBusy} />
            <span style={{ ...hint, display: 'flex', justifyContent: 'space-between' }}><span>Position</span><span>{CAPTION_POSITION}</span></span>
          </>
        )}
        {capCard === 'captions-failed' && (
          <Notice state="captions-failed" title="Your narration couldn’t be written down" line="Your clip is fine and plays without captions. Try again to add them." action="Try again" onAction={() => void writeDown()} />
        )}
        {capCard === 'captions-no-key' && (
          <Notice state="captions-no-key" title={STATES['captions-no-key'].title} line={STATES['captions-no-key'].line} action={STATES['captions-no-key'].action} action2={STATES['captions-no-key'].action2} onAction={p.onConnectPenv} onAction2={() => p.onAddKey?.(provider)} />
        )}
        {capCard === 'captions-no-voice' && (
          <Notice state="captions-no-voice" title="No speech found in the narration" line="Your clip is unchanged. Captions appear once the narration has someone speaking." action={p.onChooseNarration ? 'Choose narration' : undefined} onAction={p.onChooseNarration} />
        )}
      </Card>
      <Card>
        <Row title="AI voiceover" line="Only the script goes to OpenAI." on={voiceOn} onChange={(on) => void toggleVoice(on)} />
        {voiceOn && voiceCard !== 'voiceover-no-key' && (
          <>
            <textarea aria-label="Script" value={script} rows={5} onChange={(e) => setScript(e.currentTarget.value)}
              style={{ resize: 'vertical', border: `1px solid ${C.line}`, borderRadius: 8, padding: 8, font: `400 12px/1.4 ${C.font}`, color: C.ink }} />
            <div role="radiogroup" aria-label="Voice" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {VOICES.map((v) => (
                <Chip key={v.id} on={v.id === voice} onClick={() => setVoice(v.id)}>{v.name}</Chip>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {p.onVoiceover
                ? <button type="button" disabled={voiceBusy || !script.trim()} onClick={() => void make()} style={{ ...primaryButton, opacity: voiceBusy || !script.trim() ? 0.5 : 1 }}>Make voiceover</button>
                : <span style={hint}>Voiceover needs a clip audio track, which this clip does not have yet.</span>}
              {madeMs !== undefined && <span style={hint}>Ready · {clock(madeMs)}</span>}
            </div>
          </>
        )}
        {voiceCard === 'voiceover-failed' && (
          <Notice state="voiceover-failed" title="Your voiceover wasn’t made" line="Your script is kept as written. Try again to make the voice." action="Try again" onAction={p.onVoiceover ? () => void make() : undefined} />
        )}
        {voiceOn && voiceCard === 'voiceover-no-key' && (
          <Notice state="voiceover-no-key" title="AI voiceover needs an OpenAI key" line="Only your script goes to OpenAI. Your clip works fine without a voice." action="Add an OpenAI key" onAction={() => p.onAddKey?.('openai')} />
        )}
      </Card>
      <p style={{ margin: 0, fontSize: 11.5, color: '#5F6168' }}>
        Off by default. Change it in{' '}
        <a href="#settings" onClick={(e) => { e.preventDefault(); p.onSettings?.(); }} style={{ color: C.accent }}>Settings</a>.
      </p>
    </div>
  );
}

const Card = ({ children }: { children: ReactNode }) => (
  <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: '8px 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
);

function Row({ title, line, on, onChange }: { title: string; line: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 40 }}>
      <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        <span style={hint}>{line}</span>
      </span>
      <Switch name={title} on={on} onChange={onChange} />
    </div>
  );
}

function Notice({ state, title, line, action, action2, onAction, onAction2 }: { state: CaptionsCard | VoiceCard; title: string; line: string; action?: string; action2?: string; onAction?: () => void; onAction2?: () => void }) {
  return (
    <div role="alert" data-state={state} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: 10, background: C.stage }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
      <span style={hint}>{line}</span>
      <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {action && <button type="button" onClick={onAction} style={quietButton}>{action}</button>}
        {action2 && <button type="button" onClick={onAction2} style={quietButton}>{action2}</button>}
      </span>
    </div>
  );
}
