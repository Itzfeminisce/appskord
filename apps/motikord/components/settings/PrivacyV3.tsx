import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from '../../entrypoints/sidepanel/router';
import { PROVIDERS } from '../../lib/providers';
import { getSettings, onSettingsChanged } from '../../lib/settings';
import type { Settings } from '../../lib/types';
import { PRIVACY } from './copy';
import { useV3 } from './store';
import { backIcon, lockIcon } from './ui';

const pill = (text: string, on?: boolean) => (
  <span style={{ height: 22, padding: '0 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center', flexShrink: 0, background: on === false ? '#F1F1F3' : 'var(--success-bg)', color: on === false ? 'var(--muted)' : 'var(--success-ink)' }}>{text}</span>
);

function Group({ title, tag, children }: { title: string; tag: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} style={{ margin: '12px 16px 0', borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', overflow: 'hidden' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--line-soft)' }}>
        <span style={{ fontSize: 13, fontWeight: 600, flexGrow: 1 }}>{title}</span>
        {tag}
      </header>
      {children}
    </section>
  );
}

function Row({ title, line, on, state, last }: { title: string; line?: string; on?: boolean; state?: string; last?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 14px', borderBottom: last ? 0 : '1px solid var(--line-soft)' }}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{title}</span>
        {line && <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.45 }}>{line}</span>}
      </span>
      {state && pill(state, on)}
    </div>
  );
}

/** PrivacyV3: each kind of data and the only place it goes. The switches show what is on now. */
export default function PrivacyV3() {
  const { back } = useRouter();
  const [s, setS] = useState<Settings | null>(null);
  const [v3] = useV3();
  useEffect(() => {
    getSettings().then(setS).catch((error: unknown) => console.error('Motikord: could not read settings', error));
    return onSettingsChanged(setS);
  }, []);
  const critic = s?.critic ?? true;
  const state = (on: boolean) => (on ? PRIVACY.on : PRIVACY.off);

  return (
    <main data-frame="PrivacyV3" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', paddingBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '16px 16px 0' }}>
        <button type="button" aria-label="Back" onClick={back} className="icon-btn" style={{ width: 40, height: 40, borderRadius: 10, color: 'var(--ink)' }}>{backIcon}</button>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{PRIVACY.title}</h1>
      </div>
      <p style={{ margin: '12px 24px 0', fontSize: 14, lineHeight: 1.5, color: 'var(--muted)' }}>{PRIVACY.line}</p>

      <Group title={PRIVACY.stays} tag={pill(PRIVACY.neverUploaded)}>
        {PRIVACY.local.map((r, i) => <Row key={r.title} title={r.title} line={'line' in r ? r.line : undefined} last={i === PRIVACY.local.length - 1} />)}
      </Group>

      <Group title={PRIVACY.goes} tag={<span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{s ? PROVIDERS[s.provider].label : PRIVACY.groq}</span>}>
        {PRIVACY.ai.map((r, i) => (
          <Row key={r.title} title={r.title} line={r.line} last={i === PRIVACY.ai.length - 1}
            {...(i === PRIVACY.ai.length - 1 ? { on: critic, state: state(critic) } : {})} />
        ))}
      </Group>

      <Group title={PRIVACY.captions.group} tag={<span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{PRIVACY.captions.to}</span>}>
        <Row title={PRIVACY.captions.title} line={PRIVACY.captions.line} on={v3.captions} state={state(v3.captions)} last />
      </Group>

      <Group title={PRIVACY.voiceover.group} tag={<span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{PRIVACY.voiceover.to}</span>}>
        <Row title={PRIVACY.voiceover.title} line={PRIVACY.voiceover.line} on={v3.voiceover} state={state(v3.voiceover)} last />
      </Group>

      <div style={{ margin: '12px 16px 0', display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)' }}>
        <span style={{ color: 'var(--muted)' }}>{lockIcon}</span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{PRIVACY.keys}</span>
          <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.45 }}>{PRIVACY.keysLine}</span>
        </span>
      </div>
    </main>
  );
}
