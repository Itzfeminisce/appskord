import { useState } from 'react';
import { PACKS_V3, type PackId } from '../../lib/look/packs';
import { RESTYLE } from '../../lib/restyle/restyle';
import { Switch } from '../settings/ui';
import { StateCard } from '../states/StatesV3';
import { useV3 } from '../settings/store';

// RestyleV2: "Restyle with v3 motion" over the editor. Same words, scenes and media; the v2 version stays in Changes.

export interface RestyleV2Props {
  name: string;
  /** "21 s · 9:16 · Bold". */
  meta: string;
  /** The clip's own pack, kept unless another is picked. */
  packId: PackId;
  /** "Restyle": the pack and whether to show each key frame first. May reject; the dialog then shows restyle-failed. */
  onRestyle?: (o: { packId: PackId; keyFramesFirst: boolean }) => Promise<void> | void;
  onClose?: () => void;
}

const group = (title: string, items: readonly string[], tick: boolean) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {items.map((i) => <li key={i} style={{ height: 26, padding: '0 10px', borderRadius: 999, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5, background: tick ? 'var(--success-bg)' : 'var(--tint)', color: tick ? 'var(--success-ink)' : 'var(--accent-hover)' }}>{tick && <span aria-hidden="true">✓</span>}{i}</li>)}
    </ul>
  </div>
);

export default function RestyleV2(p: RestyleV2Props) {
  const [v3, setV3] = useV3();
  const [pack, setPack] = useState<PackId>(p.packId);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const chosen = PACKS_V3.find((x) => x.id === pack)!;
  const own = PACKS_V3.find((x) => x.id === p.packId)!;

  const go = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await p.onRestyle?.({ packId: pack, keyFramesFirst: v3.keyFramesFirst });
    } catch (error) {
      console.error('Motikord: could not restyle the clip', error);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main data-frame="RestyleV2" style={{ flexGrow: 1, display: 'flex', justifyContent: 'center', padding: 16 }}>
      <section role="dialog" aria-modal="true" aria-labelledby="rs-title" aria-describedby="rs-sub" style={{ width: 840, maxWidth: '100%', background: 'var(--surface)', borderRadius: 20, boxShadow: '0 24px 64px rgba(16,16,20,0.30)', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <header style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ flexGrow: 1 }}>
            <h1 id="rs-title" style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{RESTYLE.title}</h1>
            <p id="rs-sub" style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--muted)' }}>{RESTYLE.line}</p>
          </div>
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, fontSize: 12 }}>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span style={{ height: 20, padding: '0 7px', borderRadius: 999, background: '#F1F1F3', fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>v2</span><b>{p.name}</b></span>
            <span className="mono" style={{ color: 'var(--muted)' }}>{p.meta}</span>
          </span>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <figure style={{ margin: 0, padding: 12, borderRadius: 12, background: 'var(--stage)', fontSize: 12 }}><figcaption style={{ fontWeight: 600 }}>{`Before · v2 ${own.name}`}</figcaption></figure>
          <figure style={{ margin: 0, padding: 12, borderRadius: 12, background: 'var(--tint)', fontSize: 12 }}><figcaption style={{ fontWeight: 600 }}>{`After · v3 ${chosen.name}`}</figcaption></figure>
        </div>

        <div role="radiogroup" aria-label="Pack" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Pack</span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{RESTYLE.packLine(own.name)}</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 6 }}>
            {PACKS_V3.map((x) => (
              <button key={x.id} type="button" role="radio" aria-checked={pack === x.id} onClick={() => setPack(x.id)}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '8px 4px', borderRadius: 10, cursor: 'pointer', font: '500 12px var(--font)', color: 'var(--ink)', background: 'var(--surface)', border: pack === x.id ? '2px solid var(--accent)' : '1px solid var(--line-input)' }}>
                <span aria-hidden="true" style={{ fontSize: 18, fontWeight: 600, fontFamily: x.fonts.display.family }}>Aa</span>
                {x.name}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {group('What changes', RESTYLE.changes, false)}
          {group('What stays', RESTYLE.stays, true)}
        </div>

        <div style={{ borderRadius: 12, border: '1px solid var(--line)' }}>
          <Switch label={RESTYLE.keyFrames} hint={RESTYLE.keyFramesLine} checked={v3.keyFramesFirst} onChange={(keyFramesFirst) => setV3({ keyFramesFirst })} style={{ border: 0 }} />
        </div>

        {failed && <StateCard id="restyle-failed" onAction={() => void go()} />}

        <footer style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)', flexGrow: 1 }}>Your v2 version stays in <b>Changes</b>.</span>
          <button type="button" onClick={p.onClose} style={{ height: 40, padding: '0 16px', border: '1px solid var(--line-input)', borderRadius: 10, background: 'var(--surface)', font: '500 13px var(--font)', cursor: 'pointer' }}>{RESTYLE.notNow}</button>
          <button type="button" disabled={busy} onClick={() => void go()} style={{ height: 40, padding: '0 18px', border: 0, borderRadius: 10, background: 'var(--accent)', color: '#fff', font: '600 13px var(--font)', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>{RESTYLE.go}</button>
        </footer>
      </section>
    </main>
  );
}
