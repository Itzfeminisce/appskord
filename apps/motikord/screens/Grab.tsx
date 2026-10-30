import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui';
import { useRouter } from '../entrypoints/sidepanel/router';
import { grabBlocked, KIND_NAMES, type PageInfo, type Pick } from '../lib/grab/pick';
import { picksToAssets, withPicks } from '../lib/grab/toRecipe';
import { HOSTS, requestHost } from '../lib/hostAccess';
import { draft, runner, useSettings } from '../lib/makeClip';
import { mediaPath, putMedia } from '../lib/media';
import { onMessage } from '../lib/messages';
import { BackButton } from './Setup';
import { GrabNotAllowed, GrabNothingPicked } from './StatesCreate';

const RIGHTS_NOTE = 'Pictures from a website may belong to someone else. Use them only if you have the right to.';
const SCRIPT = '/content-scripts/grab.js';

type Phase = 'starting' | 'picking' | 'done' | 'not-allowed';

const newId = () => globalThis.crypto?.randomUUID?.() ?? `g-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Runs the picker in the tab you are on. Needs the click that opened this screen (activeTab); Chrome's own pages, the Web Store and PDFs refuse it. */
async function inject(): Promise<number | undefined> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || grabBlocked(tab.url)) return undefined;
  try {
    await browser.scripting.executeScript({ target: { tabId: tab.id }, files: [SCRIPT] });
    return tab.id;
  } catch (error) {
    console.warn('Motikord: could not start picking on this page', error);
    return undefined;
  }
}

const tell = (tabId: number | undefined, message: { type: 'grab/stop' } | { type: 'grab/remove'; id: string }) => {
  if (tabId === undefined) return;
  browser.tabs.sendMessage(tabId, message).catch(() => undefined);
};

function Row({ pick, last, onRemove }: { pick: Pick; last: boolean; onRemove: () => void }) {
  const picture = pick.kind === 'image' || pick.kind === 'logo';
  const word = KIND_NAMES[pick.kind];
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 14px', borderBottom: last ? 0 : '1px solid #EFEFF1' }}>
      <span className="mono" style={{ fontSize: 11, color: 'var(--muted)', width: 64, flexShrink: 0 }}>{word}</span>
      {picture && (
        <span style={{ width: pick.kind === 'logo' ? 32 : 44, height: 32, borderRadius: pick.kind === 'logo' ? 16 : 6, background: '#F4F4F5', overflow: 'hidden', flexShrink: 0 }}>
          {pick.dataUrl && <img src={pick.dataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: pick.kind === 'logo' ? 'contain' : 'cover' }} />}
        </span>
      )}
      <span style={{ fontSize: 13, fontWeight: picture ? 400 : 600, flexGrow: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
        {picture || pick.kind === 'table' ? pick.name : pick.text}
      </span>
      <button type="button" aria-label={`Remove ${word.toLowerCase()}`} onClick={onRemove}
        style={{ width: 30, height: 30, border: 0, borderRadius: 8, background: 'transparent', color: 'var(--muted)', display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  );
}

export default function Grab() {
  const { navigate, replace } = useRouter();
  const settings = useSettings();
  const [phase, setPhase] = useState<Phase>('starting');
  const [picks, setPicks] = useState<Pick[]>([]);
  const page = useRef<PageInfo | undefined>(undefined);
  const tab = useRef<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const off = onMessage({
      'grab/picks': (msg, sender) => {
        if (!alive || sender.tab?.id !== tab.current) return;
        page.current = msg.page;
        setPicks(msg.picks);
        setPhase(msg.done ? 'done' : 'picking');
      },
      'grab/cancel': (_msg, sender) => { if (alive && sender.tab?.id === tab.current) replace('Home'); },
    });
    void inject().then((id) => {
      if (!alive) { tell(id, { type: 'grab/stop' }); return; }
      tab.current = id;
      setPhase(id === undefined ? 'not-allowed' : 'picking');
    });
    return () => { alive = false; off(); tell(tab.current, { type: 'grab/stop' }); };
  }, [replace]);

  const remove = (id: string) => {
    setPicks((now) => now.filter((p) => p.id !== id));
    tell(tab.current, { type: 'grab/remove', id });
  };

  const make = () => {
    if (picks.length === 0 || !page.current || busy) return;
    setBusy(true);
    const info = page.current;
    // Chrome only asks inside the click, so the request goes out before anything is awaited.
    const access = settings?.ai === 'local' ? Promise.resolve('granted' as const) : requestHost(HOSTS.groq);
    tell(tab.current, { type: 'grab/stop' });
    const stored = picksToAssets(picks, info, { id: newId, put: putMedia });
    void Promise.all([access, stored]).then(([a, { assets }]) => {
      const d = draft.get();
      draft.set({ prompt: withPicks(d.prompt, picks, info), attached: [...d.attached, ...assets] });
      navigate('Making');
      return runner.start(draft.get(), { access: a });
    }).catch((error: unknown) => {
      console.error('Motikord: could not make a clip from these picks', error);
      setBusy(false);
    });
  };

  const hasPicture = picks.some((p) => p.kind === 'image' || p.kind === 'logo');
  const ready = picks.length > 0;

  return (
    <main data-frame="Grab" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '14px 16px 0 24px' }}>
        <BackButton onBack={() => replace('Home')} />
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>From this page</h1>
      </div>
      {phase === 'not-allowed' ? (
        <div style={{ margin: '14px 16px 0' }}><GrabNotAllowed /></div>
      ) : (
        <>
          <p style={{ margin: '6px 24px 0', fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>Each pick becomes part of a scene. Text from a pick goes to the AI only when you make the clip.</p>
          <div style={{ margin: '14px 16px 0' }}>
            {ready ? (
              <div style={{ borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column' }}>
                {picks.map((p, i) => <Row key={p.id} pick={p} last={i === picks.length - 1} onRemove={() => remove(p.id)} />)}
              </div>
            ) : phase !== 'starting' && <GrabNothingPicked />}
          </div>
          {hasPicture && <div style={{ margin: '12px 16px 0', padding: '12px 14px', borderRadius: 12, background: 'var(--warning-bg)', border: '1px solid var(--warning-line)', fontSize: 12, lineHeight: 1.45, color: '#78350F' }}>{RIGHTS_NOTE}</div>}
        </>
      )}
      <div style={{ flexGrow: 1 }} />
      {phase !== 'not-allowed' && (
        <div style={{ padding: 16 }}>
          <Button block disabled={!ready || busy} aria-disabled={!ready || busy} onClick={make} style={{ height: 48, fontSize: 15, fontWeight: 600, borderRadius: 12 }}>Make clip from these</Button>
        </div>
      )}
    </main>
  );
}
