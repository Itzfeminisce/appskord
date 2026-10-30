import { useEffect, useState } from 'react';
import { guessType } from '../lib/ai/detectType';
import { Button, IconButton } from '../components/ui';
import { useRouter } from '../entrypoints/sidepanel/router';
import { listClips } from '../lib/db';
import { HOSTS, requestHost } from '../lib/hostAccess';
import { canMake, draft, runner, useDraft, useSettings } from '../lib/makeClip';
import { send } from '../lib/messages';
import { restoreKeys, wasDisconnected } from '../lib/penvApp';
import { formatLength, getTemplate } from '../lib/templates';
import type { Aspect, Clip } from '../lib/types';
import { displayName } from '../lib/yourMedia';
import { Offline, PROMPT_EMPTY_HINT, PROMPT_PLACEHOLDER } from './StatesCreate';
import { PenvDisconnected } from './StatesSetup';
import { RecipeThumb, TemplateCard, TYPE_NAMES, useUseTemplate } from './Templates';

const ASPECTS: Aspect[] = ['9:16', '1:1', '16:9'];
const STRIP = ['template-bold-quote', 'template-growing-bars', 'template-pulse-sting'];

const icon = { width: 19, height: 19, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
const pill = { height: 32, padding: '0 12px', borderRadius: 999, border: '1px solid #E0E0E4', background: 'transparent', color: 'var(--ink)', font: '500 12px var(--font)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' } as const;
const card = { padding: '4px 14px', borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column' } as const;
const link = { border: 0, background: 'none', padding: 0, font: '500 12px var(--font)', color: 'var(--accent)', cursor: 'pointer' } as const;

function when(at: number, now = Date.now()): string {
  const days = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

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

export default function Home() {
  const { navigate } = useRouter();
  const d = useDraft();
  const settings = useSettings();
  const online = useOnline();
  const useTemplate = useUseTemplate();
  const [recent, setRecent] = useState<Clip[]>([]);
  const [disconnected, setDisconnected] = useState(false);

  useEffect(() => {
    listClips().then((all) => setRecent(all.slice(0, 3))).catch((error: unknown) => console.error('Motikord: could not list your clips', error));
  }, []);
  // The keys are gone after a restart; load them again from Penv Cloud, then see whether it still lets us in.
  const source = settings?.keySource;
  const conn = settings?.penvApp;
  useEffect(() => {
    if (source !== 'penv-app') { setDisconnected(false); return; }
    restoreKeys(conn).then(() => wasDisconnected()).then(setDisconnected).catch((error: unknown) => console.error('Motikord: could not check Penv Cloud', error));
  }, [source, conn]);

  const aspect = d.aspect ?? settings?.defaultAspect ?? '9:16';
  const forced = d.type ?? settings?.defaultType;
  const type = forced ?? guessType(d.prompt);
  const ready = canMake(d);
  const templates = STRIP.map(getTemplate).filter((t) => t !== undefined);

  const make = () => {
    // Chrome only asks inside the click, so the request goes out before anything is awaited.
    const access = settings?.ai === 'local' ? Promise.resolve('granted' as const) : requestHost(HOSTS.groq);
    navigate('Making');
    void access.then((a) => runner.start(draft.get(), { access: a }));
  };

  return (
    <main data-frame="Home" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', paddingBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 16px 0 24px' }}>
        <span style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--ink)', display: 'grid', placeItems: 'center' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M3 8.5h5M2 12h6M3 15.5h5" /><circle cx="15.5" cy="12" r="4.5" fill="#BE185D" stroke="none" /></svg>
        </span>
        <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em', flexGrow: 1 }}>Motikord</span>
        <IconButton aria-label="Your clips" onClick={() => navigate('Library')} style={{ width: 40, height: 40 }}>
          <svg {...icon}><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></svg>
        </IconButton>
        <IconButton aria-label="Settings" onClick={() => navigate('Settings')} style={{ width: 40, height: 40 }}>
          <svg {...icon}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
        </IconButton>
      </div>

      {(!online && settings?.ai !== 'local') && <div style={{ margin: '12px 16px 0' }}><Offline /></div>}
      {disconnected && <div style={{ margin: '12px 16px 0' }}><PenvDisconnected onConnect={() => navigate('PenvConnect')} /></div>}

      <div style={{ margin: '14px 16px 0', padding: 14, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>What should the clip show?</span>
          <textarea aria-label="Describe your clip" rows={4} value={d.prompt} placeholder={PROMPT_PLACEHOLDER} onChange={(e) => draft.set({ prompt: e.target.value })}
            style={{ resize: 'none', border: '1px solid #E0E0E4', borderRadius: 12, padding: '10px 12px', font: '14px/1.45 var(--font)', color: 'var(--ink)', outline: 'none' }} />
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <button type="button" style={pill} onClick={() => navigate('Grab')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4l7 17 2.5-7.5L21 11z" /></svg>Grab from this page
          </button>
          <button type="button" style={pill} onClick={() => navigate('YourMedia')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>Your media
          </button>
        </div>
        {d.attached.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--muted)', marginRight: 2 }}>Attached</span>
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
        )}
      </div>

      <div style={{ ...card, margin: '10px 16px 0' }}>
        <button type="button" onClick={() => navigate('ClipType')} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', border: 0, borderBottom: '1px solid #EFEFF1', background: 'none', font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
          <span style={{ fontSize: 13, flexGrow: 1 }}>Clip type</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{TYPE_NAMES[type]}</span>
          {!forced && d.prompt.trim() !== '' && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-hover)', background: 'var(--tint-strong)', padding: '2px 8px', borderRadius: 999 }}>Detected</span>}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #EFEFF1' }}>
          <span style={{ fontSize: 13, flexGrow: 1 }}>Starts as</span>
          <div role="radiogroup" aria-label="Size" style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 9, background: '#F1F1F3' }}>
            {ASPECTS.map((a) => (
              <button key={a} type="button" role="radio" aria-checked={aspect === a} onClick={() => draft.set({ aspect: a })} className="mono"
                style={{ height: 28, padding: '0 10px', borderRadius: 6, border: 0, background: aspect === a ? 'var(--surface)' : 'transparent', boxShadow: aspect === a ? '0 1px 2px rgba(16,16,20,0.08)' : 'none', fontSize: 12, fontWeight: aspect === a ? 500 : 400, color: aspect === a ? 'var(--ink)' : 'var(--muted)', cursor: 'pointer' }}>
                {a}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0' }}>
          <span style={{ fontSize: 13, flexGrow: 1 }}>Length</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Auto</span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>up to 60 s</span>
        </div>
      </div>
      <span style={{ margin: '6px 20px 0', fontSize: 12, color: 'var(--faint)' }}>Every clip comes in all three sizes. This is the one you see first.</span>

      <div style={{ padding: '14px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Button block disabled={!ready} aria-disabled={!ready} onClick={make} style={{ height: 48, fontSize: 15, fontWeight: 600, borderRadius: 12 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>Make clip
        </Button>
        {!ready && <span style={{ fontSize: 12, color: 'var(--faint)', textAlign: 'center' }}>{PROMPT_EMPTY_HINT}</span>}
      </div>

      <div style={{ padding: '18px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '0 4px' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Or start from a template</span>
          <button type="button" style={link} onClick={() => navigate('Templates')}>See all</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          {templates.map((t) => <TemplateCard key={t.id} template={t} height={96} onUse={useTemplate} />)}
        </div>
      </div>

      {recent.length > 0 && (
        <div style={{ padding: '18px 16px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '0 4px' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Recent clips</span>
            <button type="button" style={link} onClick={() => navigate('Library')}>See all</button>
          </div>
          {recent.map((c) => (
            <button key={c.id} type="button" onClick={() => { void send({ type: 'editor/open', clipId: c.id }); }}
              style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 8, borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--line)', font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
              <span style={{ flexShrink: 0, width: 30 }}><RecipeThumb recipe={c.recipe} height={52} /></span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.recipe.name}</span>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{TYPE_NAMES[c.recipe.type]} · {formatLength(c.recipe.scenes.reduce((s, x) => s + x.durationMs, 0))} · {when(c.updatedAt)}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      <div style={{ flexGrow: 1 }} />
      {settings && <span style={{ padding: '12px 24px 16px', fontSize: 12, color: 'var(--faint)', textAlign: 'center' }}>{settings.ai === 'local' ? 'Chrome’s built-in AI writes the clip from your words. Everything stays on this computer.' : 'Groq writes the clip from your words. Your media stays on this computer.'}</span>}
    </main>
  );
}
