import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { guessType } from '../../lib/ai/detectType';
import { listClips } from '../../lib/db';
import { useRouter } from '../../entrypoints/sidepanel/router';
import { requestPageAccess, useActiveTabUrl } from '../../lib/grab/access';
import { HOSTS, requestHost } from '../../lib/hostAccess';
import { getPackV3, PACKS_V3, type PackId } from '../../lib/look/packs';
import { canMake, draft, useDraft, useSettings } from '../../lib/makeClip';
import { send } from '../../lib/messages';
import { clipDuration } from '../../lib/render/drawFrame';
import { insertWords, LEVEL_BARS } from '../../lib/voice/listen';
import { useVoice } from '../../lib/voice/useVoice';
import { CLIP_TEMPLATES_V3 } from '../../lib/templates/v3/clips';
import type { Aspect, Clip } from '../../lib/types';
import { displayName } from '../../lib/yourMedia';
import { GrabAccessNotGiven, GrabNotAllowed, HomeFooter, Offline, PROMPT_EMPTY_HINT, PROMPT_PLACEHOLDER } from '../../screens/StatesCreate';
import { MIC_PATHS, VoiceFooter, VoiceStateCard } from '../../screens/StatesVoice';
import { HomeListening } from '../../screens/VoicePrompt';
import { MOOD_LABEL, PACE_LABEL } from '../../screens/LookSheet';
import { RecipeThumb, TYPE_NAMES } from '../../screens/Templates';
import { Button, IconButton } from '../ui';
import { HOME } from './copy';
import { flow, useFlow } from './flow';
import { clipKind, packNameOf, seconds } from './clips';
import { dismissNewCard, newCardShown } from './whatsNew';

const ASPECTS: Aspect[] = ['9:16', '1:1', '16:9'];
const icon = { width: 19, height: 19, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
const chevron = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>;
const row = { display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, padding: 0, border: 0, borderBottom: '1px solid #EFEFF1', background: 'none', font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' } as const;
const pill = { height: 32, padding: '0 12px', borderRadius: 999, border: '1px solid #E0E0E4', background: 'transparent', color: 'var(--ink)', font: '500 12px var(--font)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' } as const;
const link = { border: 0, background: 'none', padding: 0, font: '500 12px var(--font)', color: 'var(--accent)', cursor: 'pointer' } as const;

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

/** HomeV3: the prompt, the look, and Make clip, which goes to the key frames. */
export default function HomeV3() {
  const { navigate } = useRouter();
  const d = useDraft();
  const settings = useSettings();
  const state = useFlow();
  const [recent, setRecent] = useState<Clip[]>([]);
  const [card, setCard] = useState(false);
  const online = useOnline();
  const [grabBlocked, setGrabBlocked] = useState(false);
  const [grabDenied, setGrabDenied] = useState(false);
  // A not-allowed or not-given card is about one page; another tab clears it.
  const pageUrl = useActiveTabUrl(() => { setGrabBlocked(false); setGrabDenied(false); });
  const promptBox = useRef<HTMLTextAreaElement>(null);
  // Heard words go where the cursor was when Speak was pressed, never over typed text.
  const cursor = useRef(0);
  const voice = useVoice((words) => {
    const at = insertWords(draft.get().prompt, cursor.current, words);
    draft.set({ prompt: at.text });
    requestAnimationFrame(() => { const el = promptBox.current; if (el) { el.focus(); el.setSelectionRange(at.cursor, at.cursor); } });
  });
  const speak = () => {
    cursor.current = promptBox.current?.selectionStart ?? d.prompt.length;
    voice.start();
  };
  const listening = voice.ui.kind === 'listening' ? voice.ui : undefined;

  useEffect(() => {
    listClips().then((all) => setRecent(all.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3))).catch((error: unknown) => console.error('Motikord: could not list your clips', error));
    newCardShown().then(setCard).catch(() => undefined);
  }, []);

  const aspect = d.aspect ?? settings?.defaultAspect ?? '9:16';
  const forced = d.type ?? settings?.defaultType;
  const type = forced ?? guessType(d.prompt);
  const look = d.look ?? settings?.look ?? { style: 'auto' as const, pace: 'normal' as const, mood: 'upbeat' as const };
  const pack = getPackV3(state.packId);
  const ready = canMake(d) && !listening;

  const make = () => {
    // Chrome only asks inside the click, so the request goes out before anything is awaited.
    const access = settings?.ai === 'local' ? Promise.resolve('granted' as const) : requestHost(HOSTS[settings?.provider ?? 'groq']);
    // plan shows the planning state now, then waits for access; a refusal ends in plan-failed.
    void flow.plan({ ...draft.get(), aspect }, look, access);
    navigate('LookLock');
  };

  // Chrome grants a side-panel click no activeTab, so the page's site access is asked inside this click, before anything is awaited.
  const grab = () => {
    void requestPageAccess(pageUrl.current).then((access) => {
      // With no URL known the page is not known to be off limits, so that is a retry, not "not allowed".
      const blocked = access === 'blocked' && pageUrl.current !== undefined;
      setGrabBlocked(blocked);
      setGrabDenied(access === 'denied' || (access === 'blocked' && !blocked));
      if (access === 'granted') navigate('Grab');
    });
  };

  return (
    <main data-frame="HomeV3" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', paddingBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 16px 0 24px' }}>
        <span style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--ink)', display: 'grid', placeItems: 'center' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M3 8.5h5M2 12h6M3 15.5h5" /><circle cx="15.5" cy="12" r="4.5" fill="#BE185D" stroke="none" /></svg>
        </span>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em', flexGrow: 1 }}>Motikord</h1>
        <IconButton aria-label="Your clips" onClick={() => navigate('LibraryV3')} style={{ width: 40, height: 40 }}>
          <svg {...icon}><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></svg>
        </IconButton>
        <IconButton aria-label="Settings" onClick={() => navigate('SettingsV3')} style={{ width: 40, height: 40 }}>
          <svg {...icon}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1" /></svg>
        </IconButton>
      </div>

      {!online && settings?.ai !== 'local' && <div style={{ margin: '12px 16px 0' }}><Offline /></div>}
      {grabBlocked && <div style={{ margin: '12px 16px 0' }}><GrabNotAllowed /></div>}
      {grabDenied && <div style={{ margin: '12px 16px 0' }}><GrabAccessNotGiven onTryAgain={grab} /></div>}
      {voice.ui.kind === 'card' && (
        <div style={{ margin: '12px 16px 0' }}>
          <VoiceStateCard card={voice.ui.card} provider={voice.ui.provider ?? voice.provider}
            actions={{ onAllow: voice.allowMic, onTypeInstead: voice.dismiss, onOpenSettings: voice.openChromeSettings, onTryAgain: voice.tryAgain }} />
        </div>
      )}

      {card && (
        <section aria-label="New in Motikord" style={{ flexShrink: 0, margin: '14px 16px 0', padding: 14, borderRadius: 16, background: '#0B0B10', display: 'flex', gap: 12, alignItems: 'flex-start', position: 'relative', overflow: 'hidden', boxShadow: '0 12px 30px -14px rgba(11,11,16,0.6)' }}>
          <span aria-hidden="true" style={{ position: 'absolute', left: -40, top: -60, width: 220, height: 180, borderRadius: '50%', background: 'radial-gradient(closest-side, rgba(139,156,255,0.38), rgba(139,156,255,0))' }} />
          <svg aria-hidden="true" width="100%" height="100%" style={{ position: 'absolute', inset: 0, opacity: 0.14, mixBlendMode: 'overlay' }}><filter id="grain-new"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" /><feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.7 0" /></filter><rect width="100%" height="100%" filter="url(#grain-new)" /></svg>
          <div aria-hidden="true" style={{ position: 'relative', flexShrink: 0, width: 54, height: 92, borderRadius: 9, background: 'linear-gradient(180deg, #16161F, #0B0B10)', border: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden', transform: 'perspective(240px) rotateY(-14deg)', boxShadow: '10px 12px 22px -8px rgba(0,0,0,0.7), 0 0 24px -6px rgba(139,156,255,0.5)' }}>
            <span style={{ position: 'absolute', left: 7, right: 7, top: 30, height: 26, borderRadius: 6, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.16)', backdropFilter: 'blur(6px)' }} />
            <span style={{ position: 'absolute', left: 11, top: 36, fontWeight: 600, fontSize: 9, lineHeight: 1.05, letterSpacing: '-0.02em', color: '#F5F5F7' }}>Made<br />today</span>
            <span style={{ position: 'absolute', left: -20, top: 0, width: 18, height: '100%', background: 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.22), rgba(255,255,255,0))', transform: 'translateX(46px) skewX(-14deg)' }} />
            <span style={{ position: 'absolute', left: 7, bottom: 8, width: 22, height: 2, borderRadius: 1, background: '#8B9CFF', boxShadow: '0 0 8px #8B9CFF' }} />
          </div>
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1 }}>
            <span className="mono" style={{ fontSize: 11, letterSpacing: '0.06em', color: '#A5B1FF' }}>{HOME.newBadge}</span>
            <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em', color: '#F5F5F7' }}>{HOME.newTitle}</span>
            <span style={{ fontSize: 13, lineHeight: 1.45, color: '#B4B6C2' }}>{HOME.newLine}</span>
            <button type="button" onClick={() => navigate('WhatsNewV3')} style={{ marginTop: 6, alignSelf: 'flex-start', height: 36, padding: '0 12px 0 14px', gap: 6, borderRadius: 10, border: 0, background: '#F5F5F7', color: '#0B0B10', font: '600 13px var(--font)', display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              {HOME.seeWhatsNew}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          </div>
          <button type="button" aria-label="Dismiss" onClick={() => { setCard(false); dismissNewCard().catch((error: unknown) => console.error('Motikord: could not save that you dismissed this', error)); }}
            style={{ position: 'relative', width: 40, height: 40, margin: '-10px -10px 0 0', border: 0, borderRadius: 10, background: 'transparent', color: '#B4B6C2', display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0, flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </section>
      )}

      {listening ? (
        <HomeListening before={d.prompt.slice(0, cursor.current)} after={d.prompt.slice(cursor.current)}
          settled={listening.settled} interim={listening.interim} ms={listening.ms} levels={listening.levels.length ? listening.levels : Array.from({ length: LEVEL_BARS }, () => 0)}
          onDone={voice.done} onCancel={voice.cancel} />
      ) : (
      <div style={{ margin: '10px 16px 0', padding: 14, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{HOME.prompt}</span>
          <div style={{ position: 'relative' }}>
            <textarea ref={promptBox} aria-label="Describe your clip" rows={3} value={d.prompt} placeholder={PROMPT_PLACEHOLDER} onChange={(e) => draft.set({ prompt: e.target.value })}
              style={{ resize: 'none', border: '1px solid #E0E0E4', borderRadius: 12, padding: '10px 12px 44px', width: '100%', boxSizing: 'border-box', font: '14px/1.45 var(--font)', color: 'var(--ink)', outline: 'none', display: 'block' }} />
            {voice.enabled && <button type="button" aria-label="Speak your prompt" title="Speak your prompt" onClick={(e) => { e.preventDefault(); speak(); }}
              style={{ position: 'absolute', right: 8, bottom: 8, height: 32, padding: '0 12px 0 10px', border: 0, borderRadius: 999, background: '#FDF2F8', color: 'var(--accent-hover)', font: '600 12px/1 var(--font)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{MIC_PATHS}</svg>Speak
            </button>}
          </div>
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <button type="button" onClick={grab} style={pill}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4l7 17 2.5-7.5L21 11z" /></svg>{HOME.grab}
          </button>
          <button type="button" onClick={() => navigate('YourMedia')} style={pill}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>{HOME.yourMedia}
          </button>
          {d.attached.map((a) => (
            <span key={a.id} style={{ height: 28, padding: '0 4px 0 10px', borderRadius: 8, background: '#F4F4F5', fontSize: 12, display: 'flex', alignItems: 'center', gap: 2 }}>
              {displayName(a)}
              <button type="button" aria-label={`Remove ${a.name}`} onClick={() => draft.set({ attached: d.attached.filter((x) => x.id !== a.id) })}
                style={{ width: 28, height: 28, border: 0, background: 'transparent', color: 'var(--muted)', display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </span>
          ))}
        </div>
      </div>
      )}

      <div style={{ margin: '10px 16px 0', padding: '4px 14px 12px', borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column' }}>
        <button type="button" onClick={() => navigate('ClipType')} style={row}>
          <span style={{ fontSize: 13, flexGrow: 1 }}>{HOME.clipType}</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{TYPE_NAMES[type]}</span>
          {!forced && d.prompt.trim() !== '' && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-hover)', background: 'var(--tint-strong)', padding: '2px 8px', borderRadius: 999 }}>{HOME.detected}</span>}
          {chevron}
        </button>
        <button type="button" aria-label={`Look: ${lineOf(pack.name, look).replaceAll(' · ', ', ')}. Change the look`} onClick={() => navigate('LookSheet')} style={row}>
          <span style={{ fontSize: 13, flexGrow: 1 }}>{HOME.look}</span>
          <span aria-hidden="true" style={{ width: 14, height: 22, borderRadius: 3, background: TILES[pack.id].bg, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{lineOf(pack.name, look)}</span>
          {chevron}
        </button>
        <div role="radiogroup" aria-label="Style" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6, paddingBottom: 12, borderBottom: '1px solid #EFEFF1' }}>
          {PACKS_V3.map((p) => {
            const on = p.id === state.packId;
            return (
              <button key={p.id} type="button" role="radio" aria-checked={on} aria-label={p.name} onClick={() => flow.choosePack(p.id)}
                style={{ border: 0, background: 'none', padding: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'pointer', font: 'inherit', color: 'var(--ink)', minWidth: 0 }}>
                <span aria-hidden="true" style={{ width: '100%', height: 46, borderRadius: 9, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden', ...TILES[p.id].tile, background: TILES[p.id].bg, ...(on ? { outline: '2px solid var(--accent)', outlineOffset: 2 } : {}) }}>{TILES[p.id].face}</span>
                <span style={{ fontSize: 11, fontWeight: on ? 600 : 400, color: on ? 'var(--accent-hover)' : 'var(--muted)' }}>{p.name}</span>
              </button>
            );
          })}
        </div>
        <button type="button" aria-label={`Look guide: ${state.look.name}. Change the look guide`} onClick={() => navigate('LookBible')} style={row}>
          <span style={{ fontSize: 13, flexGrow: 1 }}>{HOME.lookGuide}</span>
          <span aria-hidden="true" style={{ display: 'flex' }}>{state.look.palette.slice(0, 3).map((c, i) => <span key={i} style={{ width: 12, height: 12, borderRadius: '50%', background: c, border: '1.5px solid #FFFFFF', marginLeft: i ? -4 : 0, boxShadow: '0 0 0 0.5px #D4D4D8' }} />)}</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{state.look.name}</span>
          {chevron}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 48, borderBottom: '1px solid #EFEFF1' }}>
          <span style={{ fontSize: 13, flexGrow: 1 }}>{HOME.startsAs}</span>
          <div role="radiogroup" aria-label="Size" style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 9, background: '#F1F1F3' }}>
            {ASPECTS.map((a) => (
              <button key={a} type="button" role="radio" aria-checked={aspect === a} onClick={() => draft.set({ aspect: a })} className="mono"
                style={{ height: 34, padding: '0 10px', borderRadius: 6, border: 0, boxShadow: aspect === a ? '0 1px 2px rgba(16,16,20,0.08)' : 'none', background: aspect === a ? 'var(--surface)' : 'transparent', fontSize: 12, fontWeight: aspect === a ? 500 : 400, color: aspect === a ? 'var(--ink)' : 'var(--muted)', cursor: 'pointer' }}>{a}</button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44 }}>
          <span style={{ fontSize: 13, flexGrow: 1 }}>{HOME.length}</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{HOME.auto}</span>
          <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>{HOME.upTo}</span>
        </div>
      </div>
      <span style={{ margin: '6px 20px 0', fontSize: 12, color: 'var(--muted)' }}>{HOME.sizes}</span>

      <div style={{ padding: '14px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Button block disabled={!ready} aria-disabled={!ready} onClick={make} style={{ height: 48, fontSize: 15, fontWeight: 600, borderRadius: 12, boxShadow: ready ? '0 6px 16px -6px rgba(190,24,93,0.55)' : 'none' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: -3, marginRight: 8 }}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>{HOME.make}
        </Button>
        {!ready && <span style={{ fontSize: 12, color: 'var(--faint)', textAlign: 'center' }}>{PROMPT_EMPTY_HINT}</span>}
      </div>

      <button type="button" onClick={() => navigate('TemplatesListV3')} style={{ margin: '12px 16px 0', minHeight: 56, padding: '8px 12px 8px 8px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 12, font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
        <span aria-hidden="true" style={{ display: 'flex', flexShrink: 0 }}>
          <span style={{ width: 26, height: 40, borderRadius: 6, background: 'radial-gradient(circle at 40% 20%, #2A2D48, #0B0B10 70%)', boxShadow: '0 2px 6px -2px rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 7, color: '#F5F5F7' }} data-glyph="Aa" />
          <span style={{ marginLeft: -6, width: 26, height: 40, borderRadius: 6, background: '#1F7A4D', border: '2px solid #FFFFFF', display: 'grid', placeItems: 'center', fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 800, fontSize: 9, color: '#FFD23F' }} data-glyph="3×" />
          <span style={{ marginLeft: -6, width: 26, height: 40, borderRadius: 6, background: '#2F6BFF', border: '2px solid #FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ width: 12, height: 5, borderRadius: 3, background: '#FFD60A', transform: 'rotate(-20deg)' }} /></span>
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, gap: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{HOME.startFromTemplate}</span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}><span className="mono">{CLIP_TEMPLATES_V3.length}</span> {HOME.readyMade}</span>
        </span>
        {chevron}
      </button>

      {recent.length > 0 && (
        <div style={{ padding: '18px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '0 4px' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{HOME.recent}</span>
            <button type="button" style={link} onClick={() => navigate('LibraryV3')}>{HOME.seeAll}</button>
          </div>
          {recent.map((c) => (
            <button key={c.id} type="button" onClick={() => { void send({ type: 'editor/open', clipId: c.id }); }}
              style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 8, borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--line)', font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
              <span style={{ flexShrink: 0, width: 30 }}><RecipeThumb recipe={c.recipe} height={52} /></span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.recipe.name}</span>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{[packNameOf(c), seconds(clipDuration(c.recipe)), clipKind(c) === 'v2' ? HOME.v2Made : undefined].filter(Boolean).join(' · ')}</span>
              </span>
              {chevron}
            </button>
          ))}
        </div>
      )}
      <div style={{ flexGrow: 1 }} />
      {listening
        ? <span style={{ padding: '12px 24px 16px', display: 'flex', justifyContent: 'center' }}><VoiceFooter path={voice.path} /></span>
        : settings && <span style={{ padding: '12px 24px 16px', display: 'flex', justifyContent: 'center' }}><HomeFooter by={settings.ai === 'local' ? 'builtin' : settings.provider} /></span>}
    </main>
  );
}

// Each pack's swatch tile, drawn as in the frames' Home.
const TILES: Record<PackId, { bg: string; tile?: CSSProperties; face: ReactNode }> = {
  clean: { bg: 'linear-gradient(160deg, #FFFFFF 35%, #F1F5F9)', tile: { border: '1px solid #E2E8F0', boxShadow: '0 4px 10px -6px rgba(15,23,42,0.25)' }, face: <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: 17, letterSpacing: '-0.03em', color: '#0F172A' }}>Aa<span style={{ color: '#2563EB' }}>.</span></span> },
  bold: { bg: '#0A0A0A', face: <span style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: 18, color: '#FACC15', letterSpacing: '-0.02em', transform: 'scaleX(1.15)' }}>AA</span> },
  playful: { bg: '#FFF7ED', tile: { border: '1px solid #FED7AA', gap: 3 }, face: <><span style={{ fontFamily: 'Fredoka, sans-serif', fontWeight: 600, fontSize: 17, color: '#1C1917' }}>Aa</span><span style={{ width: 9, height: 7, borderRadius: '50%', background: '#F97316' }} /><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#14B8A6', transform: 'translateY(-6px)' }} /></> },
  corporate: { bg: '#0F2A4A', tile: { flexDirection: 'column', gap: 3 }, face: <><span style={{ fontFamily: "'Source Serif 4', serif", fontWeight: 600, fontSize: 17, color: '#FFFFFF' }}>Aa</span><span style={{ width: 22, height: 2, background: '#38BDF8' }} /></> },
  studio: { bg: 'radial-gradient(circle at 30% 15%, #2A2D48, #0B0B10 70%)', face: <span style={{ fontWeight: 600, fontSize: 17, letterSpacing: '-0.03em', color: '#F5F5F7', textShadow: '0 0 12px rgba(139,156,255,0.8)' }}>Aa</span> },
  kinetic: { bg: '#1F7A4D', face: <><span style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '40%', background: '#E6E4DD' }} /><span style={{ position: 'relative', fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 800, fontSize: 22, letterSpacing: '-0.05em', color: '#111111', lineHeight: 1 }}>Aa</span><span style={{ position: 'absolute', left: 6, top: 6, width: 6, height: 6, background: '#FF5FA2' }} /></> },
  gloss: { bg: '#2F6BFF', tile: { gap: 4 }, face: <><span style={{ width: 22, height: 12, borderRadius: 999, background: 'linear-gradient(180deg, #FF8AB8, #FF3D8B 55%, #C81E63)', boxShadow: 'inset 0 2px 1px rgba(255,255,255,0.6), 0 3px 4px rgba(10,30,120,0.4)' }} /><span style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 700, fontSize: 15, color: '#FFFFFF' }}>Aa</span></> },
  soft: { bg: 'radial-gradient(circle at 70% 70%, rgba(228,87,46,0.35), rgba(228,87,46,0) 55%), #EFE6DA', face: <span style={{ fontFamily: 'Fraunces, serif', fontWeight: 600, fontStyle: 'italic', fontSize: 18, color: '#2B2620' }}>Aa</span> },
};

/** "Studio style · Normal pace · Calm". */
function lineOf(pack: string, look: { pace: keyof typeof PACE_LABEL; mood: keyof typeof MOOD_LABEL }): string {
  return `${pack} style · ${PACE_LABEL[look.pace]} pace · ${MOOD_LABEL[look.mood]}`;
}
