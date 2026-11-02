import type { CSSProperties, ReactNode } from 'react';
import type { CaptionStyle } from '@/lib/project/types';
import { setCaptions } from '@/lib/project/ops';
import type { SlotProps } from '../components/slots';
import { Seg } from '../timeline/controls';
import { C, Icon, ICONS } from '../ui';

const STYLES = [
  { value: 'clean', label: 'Clean', aa: { fontSize: 12, fontWeight: 500 } },
  { value: 'bold', label: 'Bold', aa: { fontSize: 13, fontWeight: 800, padding: '0 4px', background: '#111114', borderRadius: 3 } },
  { value: 'word', label: 'Word by word', aa: { fontSize: 12, fontWeight: 700 } },
] as const;
const POSITIONS = [{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }] as const;

/** Caption size in px at 1080p; the slider's ends and the letter it shows. */
export const SIZE_MIN = 32;
export const SIZE_MAX = 80;
export const sizeLetter = (px: number) => (px < 42 ? 'S' : px < 60 ? 'M' : 'L');

const HEAD: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11.5, fontWeight: 600, color: C.secondary };
const Head = ({ children }: { children: ReactNode }) => <div style={HEAD}><span>{children}</span></div>;

export interface CaptionsPanelProps extends SlotProps {
  /** T15 fills Translate. Without it the button shows its "needs AI" state. */
  onTranslate?: () => void;
}

/** The Captions tab: every choice is one `setCaptions` step on the current cut. */
export function CaptionsPanel({ project, cut, readOnly, edit, onTranslate }: CaptionsPanelProps) {
  const c = cut.captions;
  const set = (patch: Partial<CaptionStyle>) => edit((p) => setCaptions(p, { patch }));
  const languages = Object.keys(project.translations);
  return (
    <>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: readOnly ? 'default' : 'pointer' }}>
        <span style={{ flexGrow: 1, fontSize: 13 }}>
          Show captions
          <span style={{ display: 'block', fontSize: 11.5, color: C.muted, marginTop: 2, lineHeight: 1.4 }}>Made from your transcript. Fix a word there and it is fixed here.</span>
        </span>
        <input type="checkbox" role="switch" aria-label="Show captions" checked={c.show} disabled={readOnly} onChange={(e) => set({ show: e.target.checked })}
          style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />
        <span aria-hidden="true" style={{ width: 34, height: 20, borderRadius: 10, flexShrink: 0, position: 'relative', background: c.show ? C.accent : C.line }}>
          <span style={{ position: 'absolute', top: 2, ...(c.show ? { right: 2 } : { left: 2 }), width: 16, height: 16, borderRadius: '50%', background: '#FFFFFF' }} />
        </span>
      </label>

      <Head>Style</Head>
      <div role="radiogroup" aria-label="Style" style={{ display: 'flex', gap: 8 }}>
        {STYLES.map((s) => (
          <button key={s.value} type="button" role="radio" aria-checked={c.style === s.value} disabled={readOnly} onClick={() => set({ style: s.value })}
            style={{ flex: 1, height: 58, borderRadius: 9, background: C.ground, border: `1.5px solid ${c.style === s.value ? C.accentText : C.line}`, color: C.text, fontFamily: 'inherit',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: readOnly ? 'default' : 'pointer' }}>
            {s.value === 'word'
              ? <span style={s.aa}>A<span style={{ color: '#FDBA74' }}>a</span></span>
              : <span style={s.aa}>Aa</span>}
            <span style={{ fontSize: 11, color: C.secondary }}>{s.label}</span>
          </button>
        ))}
      </div>

      <Head>Position</Head>
      <Seg label="Position" options={POSITIONS} value={c.position} onChange={(position) => !readOnly && set({ position })} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <label htmlFor="caption-size" style={{ fontSize: 12, color: C.secondary, width: 74, flexShrink: 0 }}>Size</label>
        <input id="caption-size" type="range" min={SIZE_MIN} max={SIZE_MAX} step={2} value={c.size} disabled={readOnly}
          aria-valuetext={sizeLetter(c.size)} onChange={(e) => set({ size: Number(e.target.value) })} style={{ flexGrow: 1, accentColor: C.accentText }} />
        <span style={{ fontFamily: "'Geist Mono Variable', 'Geist Mono', monospace", fontSize: 11.5, color: C.text, width: 40, textAlign: 'right' }}>{sizeLetter(c.size)}</span>
      </div>

      <Head>Language</Head>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flexGrow: 1, position: 'relative', display: 'flex' }}>
          <select aria-label="Language" value={c.language ?? ''} disabled={readOnly} onChange={(e) => set({ language: e.target.value || undefined })}
            style={{ flexGrow: 1, height: 32, padding: '0 28px 0 10px', borderRadius: 8, border: `1px solid ${C.line}`, background: C.raised, color: C.text, fontFamily: 'inherit', fontSize: 12.5, appearance: 'none' }}>
            <option value="">English (spoken)</option>
            {languages.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <span aria-hidden="true" style={{ position: 'absolute', right: 8, top: 9, pointerEvents: 'none', color: C.secondary }}><Icon size={14}>{ICONS.down}</Icon></span>
        </div>
        <button type="button" disabled={readOnly || !onTranslate} title={onTranslate ? undefined : 'Turn on AI edits'} onClick={onTranslate}
          style={{ height: 32, padding: '0 12px', borderRadius: 8, background: C.raised, color: C.text, border: `1px solid ${C.line}`, fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
            display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', boxSizing: 'border-box', opacity: onTranslate && !readOnly ? 1 : 0.5, cursor: onTranslate && !readOnly ? 'pointer' : 'default' }}>
          <Icon size={15}>{ICONS.ai}</Icon>Translate
        </button>
      </div>
      <p style={{ margin: 0, fontSize: 11.5, color: C.muted, lineHeight: 1.45 }}>Burn captions into the video or save them as SRT or VTT when you export.</p>
    </>
  );
}
