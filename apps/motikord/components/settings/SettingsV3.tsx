import { useEffect, useState } from 'react';
import { canSeeImages } from '@appskord/llm';
import { useRouter } from '../../entrypoints/sidepanel/router';
import { loadKeys } from '../../lib/penv';
import { criticModelFor, pickedModel, PROVIDERS } from '../../lib/providers';
import { getSettings, onSettingsChanged, updateSettings, type SettingsPatch } from '../../lib/settings';
import type { LookStyle, Pace, Settings } from '../../lib/types';
import { appVersion } from '../../screens/Privacy';
import { STATES } from '../states/copy';
import { SETTINGS } from './copy';
import { getMachineResult, when, useV3, type MachineResult } from './store';
import { backIcon, chevron, last, lockIcon, Radio, rowStyle, Section, Segmented, Switch, Text } from './ui';

const STYLES = ['auto', 'clean', 'bold', 'playful', 'corporate', 'studio', 'kinetic', 'gloss', 'soft'] as const;
const V2_STYLES: readonly string[] = ['auto', 'clean', 'bold', 'playful', 'corporate'];
const PACES: readonly (readonly [Pace, string])[] = [['calm', 'Calm'], ['normal', 'Normal'], ['fast', 'Fast']];

/** The quality check's status line: whether the chosen model can see images. */
export function criticLine(s: Settings): { ready: boolean; text: string } {
  const model = criticModelFor(s.provider, pickedModel(s.provider, s.models[s.provider]).model);
  const ready = s.ai === 'cloud' && canSeeImages(s.provider, model);
  return { ready, text: ready ? SETTINGS.canSee : STATES['critic-not-available'].title };
}

const selectStyle = { height: 32, borderRadius: 8, border: '1px solid var(--line-input)', background: 'var(--surface)', font: '12px var(--font)', color: 'var(--ink)', maxWidth: 190 } as const;

/** SettingsV3: finishing, frame rate, preview quality, key frames first, voice and captions. */
export default function SettingsV3({ openCheck }: { openCheck?: () => void } = {}) {
  const { back, navigate } = useRouter();
  const [v3, setV3] = useV3();
  const [s, setS] = useState<Settings | null>(null);
  const [machine, setMachine] = useState<MachineResult | undefined>();
  const [penvKey, setPenvKey] = useState(false);

  useEffect(() => {
    getSettings().then(setS).catch((error: unknown) => console.error('Motikord: could not read settings', error));
    getMachineResult().then(setMachine).catch((error: unknown) => console.error('Motikord: could not read the machine check', error));
    loadKeys().then((k) => setPenvKey(!!k.OPENAI_API_KEY)).catch((error: unknown) => console.error('Motikord: could not read keys', error));
    return onSettingsChanged(setS);
  }, []);

  if (!s) return null;
  const set = (patch: SettingsPatch) => { updateSettings(patch).catch((error: unknown) => console.error('Motikord: could not save settings', error)); };
  // v2's own setting, which Home reads, follows: the four v2 styles as they are, a v3-only pack as 'auto'.
  const pickStyle = (style: (typeof STYLES)[number]) => { setV3({ style }); set({ look: { style: (V2_STYLES.includes(style) ? style : 'auto') as LookStyle } }); };
  // Until a v3 style is chosen, the select starts from v2's.
  const shownStyle = v3.style === 'auto' && V2_STYLES.includes(s.look.style) ? s.look.style : v3.style;
  const status = criticLine(s);
  const provider = PROVIDERS[s.provider].label;
  const captionsTo = s.provider === 'openai' ? 'OpenAI' : 'Groq';
  const check = openCheck ?? (() => { void browser.tabs.create({ url: browser.runtime.getURL('/check.html' as never) }); });

  return (
    <main data-frame="SettingsV3" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '16px 16px 0' }}>
        <button type="button" aria-label="Back" onClick={back} className="icon-btn" style={{ width: 40, height: 40, borderRadius: 10, color: 'var(--ink)' }}>{backIcon}</button>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{SETTINGS.title}</h1>
      </div>

      <Section title={SETTINGS.lookAndQuality} first>
        <label style={rowStyle}>
          <Text title={SETTINGS.defaultStyle} />
          <select aria-label={SETTINGS.defaultStyle} value={shownStyle} onChange={(e) => pickStyle(e.target.value as (typeof STYLES)[number])} style={selectStyle}>
            {STYLES.map((id) => <option key={id} value={id}>{id[0]!.toUpperCase() + id.slice(1)}</option>)}
          </select>
        </label>
        <div style={{ ...rowStyle, alignItems: 'center' }}>
          <Text title={SETTINGS.defaultPace} />
          <Segmented label={SETTINGS.defaultPace} value={s.look.pace} options={PACES} onChange={(pace) => set({ look: { pace } })} />
        </div>
        <Switch label={SETTINGS.qualityCheck} checked={s.critic} onChange={(critic) => set({ critic })}
          hint={<>{SETTINGS.qualityCheckLine(provider)}<span style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, color: status.ready ? 'var(--success-ink)' : 'var(--muted)' }}><span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: status.ready ? 'var(--success-ink)' : '#C8C8CE' }} />{status.text}</span></>} />
        <Switch label={SETTINGS.beatSync} hint={SETTINGS.beatSyncLine} checked={s.beatSync} onChange={(beatSync) => set({ beatSync })} />
        <Switch label={SETTINGS.aiImages} hint={SETTINGS.aiImagesLine} checked={s.aiImages} onChange={(aiImages) => set({ aiImages })} />
        <Switch label={SETTINGS.finishing} hint={SETTINGS.finishingLine} checked={v3.finishing} onChange={(finishing) => setV3({ finishing })} />

        <div role="radiogroup" aria-labelledby="fps-label" style={{ ...rowStyle, flexDirection: 'column', gap: 4 }}>
          <span id="fps-label" style={{ fontSize: 13, fontWeight: 600 }}>{SETTINGS.frameRate}</span>
          <Radio checked={v3.fps === 60} onSelect={() => setV3({ fps: 60 })}>{SETTINGS.fps60}</Radio>
          <Radio checked={v3.fps === 30} onSelect={() => setV3({ fps: 30 })}>{SETTINGS.fps30}</Radio>
          <button type="button" onClick={check} className="mono" style={{ border: 0, background: 'none', padding: 0, minHeight: 28, display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--success-ink)', cursor: 'pointer' }}>
            <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success-ink)' }} />
            {machine ? SETTINGS.machine(machine.fps60 ? 60 : 30, when(machine.at, Date.now())) : SETTINGS.machineNever}
          </button>
        </div>
        <div style={{ ...rowStyle, alignItems: 'center' }}>
          <Text title={SETTINGS.previewQuality} hint={SETTINGS.previewQualityLine} />
          <Segmented label={SETTINGS.previewQuality} value={v3.previewQuality} onChange={(previewQuality) => setV3({ previewQuality })}
            options={[['auto', 'Auto'], ['full', 'Full'], ['light', 'Light']]} />
        </div>
        <Switch label={SETTINGS.keyFrames} hint={SETTINGS.keyFramesLine} checked={v3.keyFramesFirst} onChange={(keyFramesFirst) => setV3({ keyFramesFirst })} style={last} />
      </Section>

      <Section title={SETTINGS.voiceAndCaptions}>
        <Switch label={SETTINGS.captions} hint={SETTINGS.captionsLine(captionsTo)} checked={v3.captions} onChange={(captions) => setV3({ captions })} />
        <Switch label={SETTINGS.voiceover} hint={SETTINGS.voiceoverLine} checked={v3.voiceover} onChange={(voiceover) => setV3({ voiceover })} style={v3.voiceover ? undefined : last} />
        {v3.voiceover && (
          <div style={{ ...rowStyle, ...last, background: 'var(--fill)', paddingLeft: 28, alignItems: 'center' }}>
            <span className="mono" aria-hidden="true" style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--ink)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 11, flexShrink: 0 }}>OA</span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flexGrow: 1 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{SETTINGS.keyTitle}</span>
              {s.keySource === 'penv-app' && penvKey && <span style={{ alignSelf: 'flex-start', height: 24, padding: '0 8px', borderRadius: 999, background: 'var(--success-bg)', border: '1px solid var(--success-line)', color: 'var(--success-ink)', fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center' }}>{SETTINGS.keyReady}</span>}
              <button type="button" onClick={() => navigate('PasteKey')} style={{ alignSelf: 'flex-start', border: 0, background: 'none', padding: 0, minHeight: 32, font: '500 13px var(--font)', color: 'var(--accent)', cursor: 'pointer' }}>{SETTINGS.pasteKey}</button>
            </span>
          </div>
        )}
      </Section>

      <div style={{ margin: '12px 16px 0', borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', overflow: 'hidden' }}>
        <button type="button" onClick={() => navigate('PrivacyV3')} style={{ ...rowStyle, ...last, alignItems: 'center', gap: 8, width: '100%', border: 0, background: 'none', font: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
          <span style={{ color: 'var(--muted)' }}>{lockIcon}</span>
          <span style={{ fontSize: 13, flexGrow: 1 }}>{SETTINGS.privacy}</span>
          <span style={{ color: 'var(--muted)' }}>{chevron}</span>
        </button>
      </div>

      <div style={{ flexGrow: 1 }} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '24px 16px 28px' }}>
        <span className="mono" style={{ fontSize: 12, color: 'var(--faint)' }}>Motikord {appVersion()}</span>
        <a href={SETTINGS.codeUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 500 }}>{SETTINGS.openSource}</a>
      </div>
    </main>
  );
}
