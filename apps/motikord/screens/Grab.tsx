import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui';
import { useRouter } from '../entrypoints/sidepanel/router';
import { grabBlocked, GRAB_PORT, KIND_NAMES, type PageInfo, type Pick } from '../lib/grab/pick';
import { picksToAssets, withPicks } from '../lib/grab/toRecipe';
import { HOSTS, requestHost } from '../lib/hostAccess';
import { draft, runner, useSettings } from '../lib/makeClip';
import { putMedia } from '../lib/media';
import { onMessage } from '../lib/messages';
import { BackButton } from './Setup';
import { GrabNotAllowed, GrabNothingPicked, GrabPictureUnreadable } from './StatesCreate';

const RIGHTS_NOTE = 'Pictures from a website may belong to someone else. Use them only if you have the right to.';
const SCRIPT = '/content-scripts/grab.js';

type Phase = 'starting' | 'picking' | 'done' | 'not-allowed';

const newId = () => globalThis.crypto?.randomUUID?.() ?? `g-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const isPicture = (p: Pick) => p.kind === 'image' || p.kind === 'logo';

/** Runs the picker in the tab you are on. The Home button asked for this site's access in its click; Chrome's own pages, the Web Store and PDFs refuse it. */
async function inject(): Promise<{ tabId?: number; blocked?: boolean }> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return {};
  if (grabBlocked(tab.url)) return { blocked: true };
  try {
    await browser.scripting.executeScript({ target: { tabId: tab.id }, files: [SCRIPT] });
    return { tabId: tab.id };
  } catch (error) {
    console.warn('Motikord: could not start picking on this page', error);
    return {};
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
          {pick.thumb && <img src={pick.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: pick.kind === 'logo' ? 'contain' : 'cover' }} />}
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
  // Each picture's bytes arrive once, apart from the list.
  const [data, setData] = useState<Record<string, string>>({});
  const dataRef = useRef(data);
  dataRef.current = data;
  const page = useRef<PageInfo | undefined>(undefined);
  const tab = useRef<number | undefined>(undefined);
  const port = useRef<Browser.runtime.Port | undefined>(undefined);
  const run = useRef(0);
  const [busy, setBusy] = useState(false);

  const hangUp = () => { port.current?.disconnect(); port.current = undefined; };

  /** Starts the picker (again) in the active tab, with nothing picked yet. */
  const begin = useCallback(async () => {
    const mine = ++run.current;
    hangUp();
    setPhase('starting'); setPicks([]); setData({});
    const { tabId, blocked } = await inject();
    if (mine !== run.current) { tell(tabId, { type: 'grab/stop' }); return; }
    tab.current = tabId;
    if (tabId === undefined) {
      if (blocked) setPhase('not-allowed'); else replace('Home');
      return;
    }
    // While this port is open the picker stays on the page; closing the panel or this screen ends it.
    const p = browser.tabs.connect(tabId, { name: GRAB_PORT });
    p.onDisconnect.addListener(() => {
      if (port.current !== p) return;
      port.current = undefined;
      // A picture still being read when the page went away will never arrive.
      setPicks((now) => now.map((x) => (isPicture(x) && !x.failed && dataRef.current[x.id] === undefined ? { ...x, failed: true } : x)));
    });
    port.current = p;
    setPhase('picking');
  }, [replace]);

  useEffect(() => {
    const fromPicker = (sender: Browser.runtime.MessageSender) => sender.id === chrome.runtime.id && tab.current !== undefined && sender.tab?.id === tab.current;
    const off = onMessage({
      'grab/picks': (msg, sender) => {
        if (!fromPicker(sender)) return;
        page.current = msg.page;
        setPicks(msg.picks);
        if (msg.done) setPhase('done'); else setPhase('picking');
      },
      'grab/data': (msg, sender) => { if (fromPicker(sender)) setData((now) => ({ ...now, [msg.id]: msg.dataUrl })); },
      'grab/cancel': (_msg, sender) => { if (fromPicker(sender)) replace('Home'); },
    });
    void begin();
    return () => { run.current++; off(); tell(tab.current, { type: 'grab/stop' }); hangUp(); };
  }, [begin, replace]);

  const remove = (id: string) => {
    setPicks((now) => now.filter((p) => p.id !== id));
    tell(tab.current, { type: 'grab/remove', id });
  };

  const shown = picks.filter((p) => !p.failed);
  const unreadable = picks.filter((p) => p.failed);
  // The button waits until every picture has its bytes or has failed.
  const reading = shown.some((p) => isPicture(p) && data[p.id] === undefined);

  const pickAnother = () => {
    for (const p of unreadable) remove(p.id);
    if (phase === 'done') void begin();
  };

  const make = () => {
    if (shown.length === 0 || !page.current || busy || reading) return;
    setBusy(true);
    const info = page.current;
    const withBytes = shown.map((p) => (data[p.id] ? { ...p, dataUrl: data[p.id] } : p));
    // Chrome only asks inside the click, so the request goes out before anything is awaited.
    const access = settings?.ai === 'local' ? Promise.resolve('granted' as const) : requestHost(HOSTS.groq);
    const stored = picksToAssets(withBytes, info, { id: newId, put: putMedia });
    void Promise.all([access, stored]).then(([a, { assets }]) => {
      const d = draft.get();
      draft.set({ prompt: withPicks(d.prompt, withBytes, info), attached: [...d.attached, ...assets] });
      navigate('Making');
      return runner.start(draft.get(), { access: a });
    }).catch((error: unknown) => {
      console.error('Motikord: could not make a clip from these picks', error);
      setBusy(false);
      // The picker is still on the page unless Done closed it; then it starts again so you can pick.
      if (phase === 'done') void begin();
    });
  };

  const hasPicture = shown.some(isPicture);
  const ready = shown.length > 0;
  const wait = busy || reading;

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
                {shown.map((p, i) => <Row key={p.id} pick={p} last={i === shown.length - 1} onRemove={() => remove(p.id)} />)}
              </div>
            ) : phase !== 'starting' && <GrabNothingPicked />}
          </div>
          {unreadable.length > 0 && <div style={{ margin: '12px 16px 0' }}><GrabPictureUnreadable onPickAnother={pickAnother} /></div>}
          {hasPicture && <div style={{ margin: '12px 16px 0', padding: '12px 14px', borderRadius: 12, background: 'var(--warning-bg)', border: '1px solid var(--warning-line)', fontSize: 12, lineHeight: 1.45, color: '#78350F' }}>{RIGHTS_NOTE}</div>}
        </>
      )}
      <div style={{ flexGrow: 1 }} />
      {phase !== 'not-allowed' && (
        <div style={{ padding: 16 }}>
          <Button block disabled={!ready || wait} aria-disabled={!ready || wait} aria-busy={wait} onClick={make} style={{ height: 48, fontSize: 15, fontWeight: 600, borderRadius: 12 }}>Make clip from these</Button>
        </div>
      )}
    </main>
  );
}
