import { useEffect, useState } from 'react';
import { guessType } from '../../lib/ai/detectType';
import { listClips } from '../../lib/db';
import { useRouter } from '../../entrypoints/sidepanel/router';
import { HOSTS, requestHost } from '../../lib/hostAccess';
import { getPackV3, PACKS_V3 } from '../../lib/look/packs';
import { canMake, draft, useDraft, useSettings } from '../../lib/makeClip';
import { send } from '../../lib/messages';
import { clipDuration } from '../../lib/render/drawFrame';
import { TEMPLATES } from '../../lib/templates';
import type { Aspect, Clip } from '../../lib/types';
import { displayName } from '../../lib/yourMedia';
import { PROMPT_EMPTY_HINT, PROMPT_PLACEHOLDER } from '../../screens/StatesCreate';
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
const row = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', border: 0, borderBottom: '1px solid #EFEFF1', background: 'none', font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' } as const;
const link = { border: 0, background: 'none', padding: 0, font: '500 12px var(--font)', color: 'var(--accent)', cursor: 'pointer' } as const;

/** HomeV3: the prompt, the look, and Make clip, which goes to the key frames. */
export default function HomeV3() {
  const { navigate } = useRouter();
  const d = useDraft();
  const settings = useSettings();
  const state = useFlow();
  const [recent, setRecent] = useState<Clip[]>([]);
  const [card, setCard] = useState(false);

  useEffect(() => {
    listClips().then((all) => setRecent(all.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3))).catch((error: unknown) => console.error('Motikord: could not list your clips', error));
    newCardShown().then(setCard).catch(() => undefined);
  }, []);

  const aspect = d.aspect ?? settings?.defaultAspect ?? '9:16';
  const forced = d.type ?? settings?.defaultType;
  const type = forced ?? guessType(d.prompt);
  const look = d.look ?? settings?.look ?? { style: 'auto' as const, pace: 'normal' as const, mood: 'upbeat' as const };
  const pack = getPackV3(state.packId);
  const ready = canMake(d);

  const make = () => {
    // Chrome only asks inside the click, so the request goes out before anything is awaited.
    const access = settings?.ai === 'local' ? Promise.resolve('granted' as const) : requestHost(HOSTS[settings?.provider ?? 'groq']);
    // plan shows the planning state now, then waits for access; a refusal ends in plan-failed.
    void flow.plan({ ...draft.get(), aspect }, look, access);
    navigate('LookLock');
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

      {card && (
        <section aria-label="New in Motikord" style={{ margin: '14px 16px 0', padding: 14, borderRadius: 16, background: '#0B0B10', display: 'flex', gap: 12, alignItems: 'flex-start', position: 'relative', overflow: 'hidden' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1 }}>
            <span className="mono" style={{ fontSize: 11, letterSpacing: '0.06em', color: '#A5B1FF' }}>{HOME.newBadge}</span>
            <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em', color: '#F5F5F7' }}>{HOME.newTitle}</span>
            <span style={{ fontSize: 13, lineHeight: 1.45, color: '#B4B6C2' }}>{HOME.newLine}</span>
            <button type="button" onClick={() => navigate('WhatsNewV3')} style={{ marginTop: 6, alignSelf: 'flex-start', height: 36, padding: '0 12px 0 14px', gap: 6, borderRadius: 10, border: 0, background: '#F5F5F7', color: '#0B0B10', font: '600 13px var(--font)', display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              {HOME.seeWhatsNew}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          </div>
          <button type="button" aria-label="Dismiss" onClick={() => { setCard(false); dismissNewCard().catch((error: unknown) => console.error('Motikord: could not save that you dismissed this', error)); }}
            style={{ width: 40, height: 40, margin: '-10px -10px 0 0', border: 0, borderRadius: 10, background: 'transparent', color: '#B4B6C2', display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0, flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </section>
      )}

      <div style={{ margin: '14px 16px 0', padding: 14, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{HOME.prompt}</span>
          <textarea aria-label="Describe your clip" rows={4} value={d.prompt} placeholder={PROMPT_PLACEHOLDER} onChange={(e) => draft.set({ prompt: e.target.value })}
            style={{ resize: 'none', border: '1px solid #E0E0E4', borderRadius: 12, padding: '10px 12px', width: '100%', boxSizing: 'border-box', font: '14px/1.45 var(--font)', color: 'var(--ink)', outline: 'none', display: 'block' }} />
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <button type="button" onClick={() => navigate('YourMedia')} style={{ height: 32, padding: '0 12px', borderRadius: 999, border: '1px solid #E0E0E4', background: 'transparent', color: 'var(--ink)', font: '500 12px var(--font)', cursor: 'pointer' }}>{HOME.yourMedia}</button>
          {d.attached.map((a) => (
            <span key={a.id} style={{ height: 28, padding: '0 6px 0 10px', borderRadius: 8, background: '#F4F4F5', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              {displayName(a)}
              <button type="button" aria-label={`Remove ${a.name}`} onClick={() => draft.set({ attached: d.attached.filter((x) => x.id !== a.id) })}
                style={{ width: 22, height: 22, border: 0, background: 'transparent', color: 'var(--muted)', display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </span>
          ))}
        </div>
      </div>

      <div style={{ margin: '10px 16px 0', padding: '4px 14px', borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column' }}>
        <button type="button" onClick={() => navigate('ClipType')} style={row}>
          <span style={{ fontSize: 13, flexGrow: 1 }}>{HOME.clipType}</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{TYPE_NAMES[type]}</span>
          {!forced && d.prompt.trim() !== '' && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-hover)', background: 'var(--tint-strong)', padding: '2px 8px', borderRadius: 999 }}>{HOME.detected}</span>}
          {chevron}
        </button>
        <button type="button" aria-label={`Look: ${lineOf(pack.name, look).replaceAll(' · ', ', ')}. Change the look`} onClick={() => navigate('LookSheet')} style={row}>
          <span style={{ fontSize: 13, flexGrow: 1 }}>{HOME.look}</span>
          <span style={{ fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{lineOf(pack.name, look)}</span>
          {chevron}
        </button>
        <div role="radiogroup" aria-label="Style" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '10px 0', borderBottom: '1px solid #EFEFF1' }}>
          {PACKS_V3.map((p) => {
            const on = p.id === state.packId;
            return (
              <button key={p.id} type="button" role="radio" aria-checked={on} aria-label={p.name} onClick={() => flow.choosePack(p.id)}
                style={{ width: 58, border: on ? '2px solid var(--accent)' : '1px solid var(--line-input)', borderRadius: 10, background: on ? 'var(--tint)' : 'var(--surface)', padding: '6px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'pointer', font: 'inherit', color: 'var(--ink)' }}>
                <span style={{ width: 40, height: 28, borderRadius: 6, background: p.colours[0], color: p.colours[1], display: 'grid', placeItems: 'center', font: `${p.fonts.display.weight} 14px '${p.fonts.display.family}', sans-serif` }}>Aa</span>
                <span style={{ fontSize: 11, fontWeight: on ? 600 : 400 }}>{p.name}</span>
              </button>
            );
          })}
        </div>
        <button type="button" aria-label={`Look guide: ${state.look.name}. Change the look guide`} onClick={() => navigate('LookBible')} style={row}>
          <span style={{ fontSize: 13, flexGrow: 1 }}>{HOME.lookGuide}</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{state.look.name}</span>
          {chevron}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #EFEFF1' }}>
          <span style={{ fontSize: 13, flexGrow: 1 }}>{HOME.startsAs}</span>
          <div role="radiogroup" aria-label="Size" style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 9, background: '#F1F1F3' }}>
            {ASPECTS.map((a) => (
              <button key={a} type="button" role="radio" aria-checked={aspect === a} onClick={() => draft.set({ aspect: a })} className="mono"
                style={{ height: 28, padding: '0 10px', borderRadius: 6, border: 0, background: aspect === a ? 'var(--surface)' : 'transparent', fontSize: 12, fontWeight: aspect === a ? 500 : 400, color: aspect === a ? 'var(--ink)' : 'var(--muted)', cursor: 'pointer' }}>{a}</button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0' }}>
          <span style={{ fontSize: 13, flexGrow: 1 }}>{HOME.length}</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{HOME.auto}</span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{HOME.upTo}</span>
        </div>
      </div>
      <span style={{ margin: '6px 20px 0', fontSize: 12, color: 'var(--faint)' }}>{HOME.sizes}</span>

      <div style={{ padding: '14px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Button block disabled={!ready} aria-disabled={!ready} onClick={make} style={{ height: 48, fontSize: 15, fontWeight: 600, borderRadius: 12 }}>{HOME.make}</Button>
        {!ready && <span style={{ fontSize: 12, color: 'var(--faint)', textAlign: 'center' }}>{PROMPT_EMPTY_HINT}</span>}
      </div>

      <button type="button" onClick={() => navigate('TemplatesListV3')} style={{ margin: '18px 16px 0', padding: 12, borderRadius: 16, border: '1px solid var(--line)', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 12, font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
        <span style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, gap: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{HOME.startFromTemplate}</span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{TEMPLATES.length} {HOME.readyMade}</span>
        </span>
        {chevron}
      </button>

      {recent.length > 0 && (
        <div style={{ padding: '18px 16px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
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
    </main>
  );
}

/** "Studio style · Normal pace · Calm". */
function lineOf(pack: string, look: { pace: keyof typeof PACE_LABEL; mood: keyof typeof MOOD_LABEL }): string {
  return `${pack} style · ${PACE_LABEL[look.pace]} pace · ${MOOD_LABEL[look.mood]}`;
}
