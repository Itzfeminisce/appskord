import { useEffect, useState, type ReactNode } from 'react';
import { PROVIDER_IDS, PROVIDERS } from '../lib/providers';
import { useRouter } from '../entrypoints/sidepanel/router';
import { getBrandKit } from '../lib/db';
import { chooseFolder } from '../lib/folder';
import { loadKeys } from '../lib/keys';
import { sourcesSummary } from '../lib/media/sources/summary';
import { getSettings, onSettingsChanged, updateSettings, type SettingsPatch } from '../lib/settings';
import type { BrandKit, FileKind, Provider, Quality, Settings as SettingsData } from '../lib/types';
import { CODE_URL } from './Privacy';
import { BackButton, probeMachine } from './Setup';
import { ModelBuiltIn, ModelField } from './SettingsModel';
import { NoBuiltInAi } from './StatesSetup';
import { voiceSettingsLine } from './StatesVoice';
import { voiceLanguage, voiceLanguageOptions, useVoicePath } from '../lib/voice/useVoice';

const KINDS: [FileKind, string][] = [['mp4', 'MP4'], ['webm', 'WebM'], ['webm-alpha', 'See-through WebM'], ['gif', 'GIF']];
const QUALITIES: Quality[] = ['1080p', '720p'];

function Section({ title, children, first: top }: { title?: string; children: ReactNode; first?: boolean }) {
  return (
    <>
      {title && <h2 style={{ margin: top ? '14px 24px 8px' : '22px 24px 8px', fontSize: 13, fontWeight: 600 }}>{title}</h2>}
      <div style={{ margin: title ? '0 16px' : '22px 16px 0', borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column' }}>{children}</div>
    </>
  );
}

const rowStyle = { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', border: 0, borderTop: '1px solid #EFEFF1', color: 'inherit', textDecoration: 'none', font: 'inherit', background: 'none', width: '100%', textAlign: 'left', cursor: 'pointer', boxSizing: 'border-box' } as const;
const first = { borderTop: 0 } as const;
const text = (title: string, hint?: ReactNode) => (
  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flexGrow: 1 }}>
    <span style={{ fontSize: 13 }}>{title}</span>
    {hint && <span style={{ fontSize: 12, lineHeight: 1.4, color: 'var(--muted)' }}>{hint}</span>}
  </span>
);
const chevron = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}><path d="M9 6l6 6-6 6" /></svg>;
const selectStyle = { height: 32, borderRadius: 8, border: '1px solid #E0E0E4', background: 'var(--surface)', font: '12px var(--font)', color: 'var(--ink)', maxWidth: 190, minWidth: 0 } as const;
const btn2 = { height: 32, padding: '0 12px', border: '1px solid #E0E0E4', borderRadius: 9, background: 'var(--surface)', font: '600 12px var(--font)', color: 'var(--ink)', cursor: 'pointer', flexShrink: 0 } as const;

/** A toggle, accent when on. The real checkbox stays for keyboards and screen readers. */
function Switch({ label, hint, checked, onChange, top }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; top?: boolean }) {
  return (
    <label style={{ ...rowStyle, ...(top ? first : null) }}>
      {text(label, hint)}
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ position: 'absolute', opacity: 0, width: 1, height: 1, margin: 0 }} />
      <span aria-hidden="true" style={{ position: 'relative', width: 34, height: 20, borderRadius: 999, background: checked ? 'var(--accent)' : '#DCDCE0', flexShrink: 0, transition: 'background 150ms' }}>
        <span style={{ position: 'absolute', top: 2, left: checked ? 16 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(16,16,20,0.2)', transition: 'left 150ms' }} />
      </span>
    </label>
  );
}

function Status({ ready, children }: { ready: boolean; children: string }) {
  const c = ready ? 'var(--success-ink)' : 'var(--faint)';
  return <span style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 5, color: c }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: ready ? 'var(--success-ink)' : '#C8C8CE' }} />{children}</span>;
}

const tick = <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" style={{ position: 'absolute', top: 10, right: 10 }}><circle cx="12" cy="12" r="10" fill="var(--accent)" /><path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const screen = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="11" rx="1.5" /><path d="M2 19h20" /></svg>;

function Tile({ on, mono, name, status, wide, disabled, onPick }: { on: boolean; mono: ReactNode; name: string; status: ReactNode; wide?: boolean; disabled?: boolean; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={on} disabled={disabled} onClick={onPick}
      style={{ position: 'relative', display: 'flex', flexDirection: wide ? 'row' : 'column', alignItems: wide ? 'center' : 'flex-start', gap: wide ? 10 : 8, padding: 12, borderRadius: 12, border: on ? '1.5px solid var(--accent)' : '1px solid var(--line)', background: on ? 'var(--tint)' : 'var(--surface)', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1, gridColumn: wide ? 'span 2' : undefined, font: 'inherit', color: 'inherit', textAlign: 'left', minWidth: 0 }}>
      <span className="mono" style={{ width: 28, height: 28, borderRadius: 8, background: wide ? '#F1F1F3' : on ? 'var(--accent)' : 'var(--ink)', color: wide ? 'var(--ink)' : '#fff', fontSize: 11, fontWeight: 500, display: 'grid', placeItems: 'center', flexShrink: 0 }}>{mono}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: wide ? 2 : 8, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{name}</span>
        {status}
      </span>
      {on && tick}
    </button>
  );
}

/** "OpenAI, Groq and Pexels keys": the keys Penv Cloud gave, the chosen provider first. */
export function penvKeysLine(provider: Provider, keys: Record<string, string>): string {
  const have = [provider, ...PROVIDER_IDS.filter((p) => p !== provider && keys[PROVIDERS[p].keyName])].map((p) => PROVIDERS[p].label);
  return `${[...have, 'Pexels'].slice(0, -1).join(', ')} and Pexels keys`;
}

export default function Settings() {
  const { back, navigate } = useRouter();
  const [s, setS] = useState<SettingsData | null>(null);
  const voicePath = useVoicePath();
  const [kit, setKit] = useState<BrandKit | undefined>();
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [builtInAi, setBuiltInAi] = useState<boolean | null>(null);

  useEffect(() => {
    getSettings().then(setS).catch((error: unknown) => console.error('Motikord: could not read settings', error));
    getBrandKit().then(setKit).catch((error: unknown) => console.error('Motikord: could not read the brand kit', error));
    loadKeys().then(setKeys).catch((error: unknown) => console.error('Motikord: could not read keys', error));
    probeMachine().then((m) => setBuiltInAi(m.builtInAi)).catch((error: unknown) => console.error('Motikord: could not check this computer', error));
    return onSettingsChanged(setS);
  }, []);

  if (!s) return null;
  const sources = sourcesSummary(s.media, { pexels: keys.PEXELS_API_KEY, pixabay: keys.PIXABAY_API_KEY, freesound: keys.FREESOUND_API_KEY, jamendo: keys.JAMENDO_CLIENT_ID, unsplash: keys.UNSPLASH_ACCESS_KEY });
  const set = (patch: SettingsPatch) => { updateSettings(patch).catch((error: unknown) => console.error('Motikord: could not save settings', error)); };
  const change = async () => {
    try { await chooseFolder(); } catch (error) { console.error('Motikord: could not choose the save folder', error); }
  };
  const version = browser.runtime.getManifest().version;
  const connected = s.keySource === 'penv-app';
  const provider = s.provider;

  return (
    <main data-frame="Settings" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '16px 16px 0' }}>
        <BackButton onBack={back} />
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Settings</h1>
      </div>

      <h2 style={{ margin: '14px 24px 8px', fontSize: 13, fontWeight: 600 }}>AI that writes your clips</h2>
      <div style={{ margin: '0 16px', padding: 14, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div role="radiogroup" aria-label="AI that writes your clips" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {PROVIDER_IDS.map((p) => {
            const ready = !!keys[PROVIDERS[p].keyName];
            return <Tile key={p} on={s.ai === 'cloud' && provider === p} mono={PROVIDERS[p].mono} name={PROVIDERS[p].label}
              status={<Status ready={ready}>{ready ? 'Ready' : 'Needs a key'}</Status>} onPick={() => set({ ai: 'cloud', provider: p })} />;
          })}
          <Tile wide on={s.ai === 'local'} mono={screen} name="On this computer" disabled={builtInAi === false}
            status={<Status ready={builtInAi === true}>Ready · nothing is sent</Status>} onPick={() => set({ ai: 'local' })} />
        </div>
        <div style={{ height: 1, background: '#EFEFF1', margin: '0 -14px' }} />
        {s.ai === 'cloud'
          ? <ModelField key={provider} provider={provider} saved={s.models[provider]} apiKey={keys[PROVIDERS[provider].keyName]}
              onSave={(m) => set({ models: { [provider]: m } })} onPasteKey={() => navigate('PasteKey')} onPenv={() => navigate('PenvConnect')} />
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><span style={{ fontSize: 13, fontWeight: 600 }}>Model</span><ModelBuiltIn /></div>}
      </div>
      {builtInAi === false && <div style={{ margin: '10px 16px 0' }}><NoBuiltInAi provider={provider} onUseGroq={() => set({ ai: 'cloud' })} /></div>}

      <Section title="Keys">
        <a href="#keys" onClick={(e) => { e.preventDefault(); navigate('PenvConnected'); }} style={{ ...rowStyle, ...first }}>
          <span className="mono" aria-hidden="true" style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--ink)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 500, flexShrink: 0 }}>pv</span>
          {text('Penv Cloud', penvKeysLine(provider, keys))}
          {connected && <Status ready>Connected</Status>}
          {chevron}
        </a>
        <a href="#paste" onClick={(e) => { e.preventDefault(); navigate('PasteKey'); }} style={{ ...rowStyle, color: 'var(--accent)', fontSize: 13, fontWeight: 500 }}>Paste a key instead</a>
      </Section>

      <Section title="Voice prompts">
        <Switch top label="Speak your prompt" hint="Shows the mic in the prompt box. Motikord only listens while the mic is lit." checked={s.voiceOn} onChange={(v) => set({ voiceOn: v })} />
        <label style={rowStyle}>
          {text('Language')}
          <select value={voiceLanguage(s.voiceLang)} onChange={(e) => set({ voiceLang: e.target.value })} style={selectStyle}>
            {voiceLanguageOptions(voiceLanguage(s.voiceLang)).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </label>
        <div style={{ ...rowStyle, cursor: 'default' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#15803D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
          {text(voiceSettingsLine(voicePath.path, voicePath.provider))}
        </div>
      </Section>

      <Section title="Clips">
        <a href="#brand" onClick={(e) => { e.preventDefault(); navigate('BrandKit'); }} style={{ ...rowStyle, ...first }}>
          {text('Brand kit')}
          <span style={{ display: 'flex', gap: 4 }} aria-hidden="true">
            {(kit?.colours ?? []).slice(0, 3).map((c, i) => <span key={i} style={{ width: 16, height: 16, borderRadius: 999, background: c.hex, border: '1px solid var(--line)' }} />)}
          </span>
          {chevron}
        </a>
        <div style={{ ...rowStyle, cursor: 'default' }}>
          {text('Save folder', s.folderName)}
          <button type="button" onClick={() => void change()} style={btn2}>Change</button>
        </div>
        <label style={rowStyle}>
          {text('Default export')}
          <select
            value={`${s.defaultExport.kind}|${s.defaultExport.quality}`}
            onChange={(e) => { const [kind, quality] = e.target.value.split('|') as [FileKind, Quality]; set({ defaultExport: { kind, quality } }); }}
            style={selectStyle}
          >
            {KINDS.flatMap(([kind, label]) => QUALITIES.map((q) => <option key={`${kind}|${q}`} value={`${kind}|${q}`}>{label} · {q} · {s.defaultAspect}</option>))}
          </select>
        </label>
        <Switch label="Keep the preview smooth" hint="Shows a lighter preview when needed. Exports are always full quality." checked={s.smoothPreview} onChange={(v) => set({ smoothPreview: v })} />
      </Section>

      <Section title="Free media">
        <a href="#media-sources" onClick={(e) => { e.preventDefault(); navigate('MediaSources'); }} style={{ ...rowStyle, ...first }}>
          {text('Media sources', sources.line)}
          <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>{`${sources.on} on`}</span>
        </a>
      </Section>

      <Section>
        <a href="#privacy" onClick={(e) => { e.preventDefault(); navigate('Privacy'); }} style={{ ...rowStyle, ...first }}>
          {text('Where your data goes')}{chevron}
        </a>
      </Section>

      <div style={{ flexGrow: 1 }} />
      <div style={{ padding: '12px 24px 18px', marginTop: 20, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--faint)' }}>
        <span>Motikord {version}</span>
        <a href={CODE_URL} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', fontWeight: 500 }}>Open source on GitHub</a>
      </div>
    </main>
  );
}
