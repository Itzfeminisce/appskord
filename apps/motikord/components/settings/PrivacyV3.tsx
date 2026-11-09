import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from '../../entrypoints/sidepanel/router';
import { PROVIDERS } from '../../lib/providers';
import { getSettings, onSettingsChanged } from '../../lib/settings';
import type { Settings } from '../../lib/types';
import { PRIVACY } from './copy';
import { useV3 } from './store';
import { backIcon, lockIcon } from './ui';

const pill = (text: string, on: boolean) => (
  <span style={{ height: 24, padding: '0 8px', boxSizing: 'border-box', borderRadius: 999, fontSize: 12, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0, background: on ? 'var(--success-bg)' : '#F4F4F5', border: `1px solid ${on ? 'var(--success-line)' : 'var(--line)'}`, color: on ? 'var(--success-ink)' : 'var(--muted)' }}>
    <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: on ? 'var(--success-ink)' : '#A1A1AA' }} />{text}
  </span>
);
const tagText = (text: string) => <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{text}</span>;
const glyph = (bg: string, ink: string, path: ReactNode) => (
  <span aria-hidden="true" style={{ width: 24, height: 24, flexShrink: 0, borderRadius: 7, background: bg, color: ink, display: 'grid', placeItems: 'center' }}>
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{path}</svg>
  </span>
);
const ICONS = {
  local: glyph('var(--success-bg)', 'var(--success-ink)', <><path d="M4 11l8-7 8 7v9H4z" /><path d="M10 20v-5h4v5" /></>),
  ai: glyph('var(--tint)', 'var(--accent)', <path d="M4 12l16-8-6 16-3-7z" />),
  captions: glyph('#F4F4F5', '#3F3F46', <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0012 0M12 17v4" /></>),
  voice: glyph('#F4F4F5', '#3F3F46', <path d="M4 12h2M8 8v8M12 5v14M16 8v8M20 12h-2" />),
};

function Group({ title, tag, icon, children }: { title: string; tag: ReactNode; icon: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 24px' }}>
        {icon}
        <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, flexGrow: 1 }}>{title}</h2>
        {tag}
      </header>
      <div style={{ margin: '0 16px', borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>{children}</div>
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
      {state && pill(state, on ?? false)}
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
      <p style={{ margin: '8px 24px 0', fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>{PRIVACY.line}</p>

      <Group title={PRIVACY.stays} icon={ICONS.local} tag={tagText(PRIVACY.neverUploaded)}>
        {PRIVACY.local.map((r, i) => <Row key={r.title} title={r.title} line={'line' in r ? r.line : undefined} last={i === PRIVACY.local.length - 1} />)}
      </Group>

      <Group title={PRIVACY.goes} icon={ICONS.ai} tag={tagText(s ? PROVIDERS[s.provider].label : PRIVACY.groq)}>
        {PRIVACY.ai.map((r, i) => (
          <Row key={r.title} title={r.title} line={r.line} last={false}
            {...(i === PRIVACY.ai.length - 1 ? { on: critic, state: state(critic) } : {})} />
        ))}
        <Row title={PRIVACY.aiImages.title} line={PRIVACY.aiImages.line} on={s?.aiImages ?? false} state={state(s?.aiImages ?? false)} last />
      </Group>

      <Group title={PRIVACY.captions.group} icon={ICONS.captions} tag={tagText(PRIVACY.captions.to)}>
        <Row title={PRIVACY.captions.title} line={PRIVACY.captions.line} on={v3.captions} state={state(v3.captions)} last />
      </Group>

      <Group title={PRIVACY.voiceover.group} icon={ICONS.voice} tag={tagText(PRIVACY.voiceover.to)}>
        <Row title={PRIVACY.voiceover.title} line={PRIVACY.voiceover.line} on={v3.voiceover} state={state(v3.voiceover)} last />
      </Group>

      <div style={{ margin: '16px 16px 0', display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--line)' }}>
        <span style={{ color: 'var(--muted)', marginTop: 1 }}>{lockIcon}</span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{PRIVACY.keys}</span>
          <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.45 }}>{PRIVACY.keysLine}</span>
        </span>
      </div>
    </main>
  );
}
