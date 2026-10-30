import { guessType } from '../lib/ai/detectType';
import { draft, useDraft, useRun, useSettings } from '../lib/makeClip';
import { updateSettings } from '../lib/settings';
import { useRouter } from '../entrypoints/sidepanel/router';
import type { ClipType as Type } from '../lib/types';
import { TYPE_NAMES, TYPE_ORDER } from './Templates';

const LINES: Record<Type, string> = {
  promo: 'A product, offer or event, ending with what to do next',
  quote: 'One line, big and readable, with who said it',
  chart: 'Numbers from a table that grow into a chart',
  explainer: 'A few steps or points, one scene each',
  logo: 'Your logo arrives with a short sting',
  captions: 'Words that appear in time, over your video or a colour',
  social: 'A short eye-catcher made for feeds',
};

const save = (patch: Parameters<typeof updateSettings>[0]) => { updateSettings(patch).catch((error: unknown) => console.error('Motikord: could not save settings', error)); };

/** The sheet over Home (and Making): which type the clip is made in. */
export default function ClipType() {
  const { back } = useRouter();
  const d = useDraft();
  const run = useRun();
  const settings = useSettings();
  // Detection runs on "Make clip"; until then a quick local guess stands in.
  const detected: Type = run.status !== 'idle' && run.typeBy && run.typeBy !== 'you' && run.typeBy !== 'settings' && run.type ? run.type : guessType(d.prompt);
  const chosen: Type = d.type ?? settings?.defaultType ?? detected;
  const always = !!settings?.defaultType;
  const pick = (t: Type) => {
    draft.set({ type: t });
    if (always) save({ defaultType: t });
  };
  return (
    <main data-frame="ClipType" style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: 'rgba(17,17,20,0.45)' }}>
      <button type="button" aria-label="Close" onClick={back} style={{ flexGrow: 1, border: 0, background: 'none', cursor: 'default' }} />
      <div role="dialog" aria-label="Clip type" style={{ borderRadius: '20px 20px 0 0', background: 'var(--surface)', padding: '10px 16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, background: '#DCDCE0' }} />
        <div style={{ padding: '4px 8px 0', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em' }}>Clip type</h1>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>Motikord picks one from what you give it. Choose another and the clip is made again in that style.</p>
        </div>
        <div role="radiogroup" aria-label="Clip type" style={{ display: 'flex', flexDirection: 'column' }}>
          {TYPE_ORDER.map((t) => (
            <label key={t} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '11px 8px', borderRadius: 12, background: chosen === t ? 'var(--tint)' : 'transparent', cursor: 'pointer' }}>
              <input type="radio" name="t" checked={chosen === t} onChange={() => pick(t)} style={{ accentColor: 'var(--accent)', width: 16, height: 16, margin: 0 }} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flexGrow: 1 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{TYPE_NAMES[t]}</span>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{LINES[t]}</span>
              </span>
              {detected === t && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-hover)', background: 'var(--tint-strong)', padding: '2px 8px', borderRadius: 999 }}>Detected</span>}
            </label>
          ))}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 8px 4px', borderTop: '1px solid #EFEFF1', cursor: 'pointer' }}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flexGrow: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Always use this type</span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Skips detection for new clips</span>
          </span>
          <input type="checkbox" role="switch" checked={always} onChange={(e) => save({ defaultType: e.target.checked ? chosen : undefined })} style={{ width: 36, height: 20, accentColor: 'var(--accent)', margin: 0 }} />
        </label>
        <button type="button" onClick={back} className="btn btn-primary btn-block">Done</button>
      </div>
    </main>
  );
}
