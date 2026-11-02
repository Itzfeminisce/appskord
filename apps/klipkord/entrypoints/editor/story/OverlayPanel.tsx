import type { Overlay } from '@/lib/project/types';
import type { SlotProps } from '../components/slots';
import { clock } from '../format';
import { Heading, Seg, Slider, Switch } from '../timeline/controls';
import { C, MONO } from '../ui';
import { BLUR_AMOUNT, BLUR_STOPS, blurStop, changeOverlay, shownSpan, spanAt, wholeVideo } from './model';
import { OVERLAY_NAMES } from './store';

const BLUR_MODES = [{ value: 'blur', label: 'Blur' }, { value: 'pixelate', label: 'Pixelate' }, { value: 'solid', label: 'Solid' }] as const;
const MOTIONS = [{ value: 'fade', label: 'Fade' }, { value: 'pop', label: 'Pop' }, { value: 'none', label: 'None' }] as const;

/** The Overlays frame names the default strength "Strong"; other strengths show as a share. */

/** Blur Amount: a slider over the three stops, the stop's name beside it. */
function AmountSlider({ amount, disabled, onCommit }: { amount: number; disabled: boolean; onCommit: (amount: number) => void }) {
  const stop = BLUR_STOPS.findIndex((s) => s.value === blurStop(amount).value);
  const [shown, setShown] = useState(stop);
  useEffect(() => setShown(stop), [stop]);
  return (
    <Slider label="Amount" min={0} max={BLUR_STOPS.length - 1} step={1} value={shown} text={BLUR_STOPS[shown]!.label} disabled={disabled}
      onInput={setShown} onCommit={(i) => onCommit(BLUR_STOPS[i]!.amount)} />
  );
}

/** The words of a text or callout; one Undo step when the field is left. */
function TextField({ o, edit, readOnly }: { o: Overlay; edit: (patch: Partial<Overlay>) => void; readOnly: boolean }) {
  const [value, setValue] = useState(o.text ?? '');
  useEffect(() => setValue(o.text ?? ''), [o.id, o.text]);
  const commit = () => { if (value !== (o.text ?? '')) edit({ text: value }); };
  return (
    <input aria-label={OVERLAY_NAMES[o.kind]} value={value} readOnly={readOnly} autoFocus={!o.text}
      onChange={(e) => setValue(e.target.value)} onBlur={commit} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commit(); }}
      style={{ height: 34, borderRadius: 8, border: `1px solid ${C.line}`, background: C.ground, color: C.text, padding: '0 10px', fontFamily: 'inherit', fontSize: 13 }} />
  );
}

/** The inspector for one selected overlay (Overlays frame). */
export function OverlayPanel({ p, o }: { p: SlotProps; o: Overlay }) {
  const edit = (patch: Partial<Omit<Overlay, 'id'>>) => { if (!p.readOnly) p.edit((q) => changeOverlay(q, o.id, patch)); };
  const blur = o.blur ?? { mode: 'blur' as const, amount: BLUR_AMOUNT, follow: false };
  const [from, to] = shownSpan(p.cut, o);
  const whole = wholeVideo(o, p.recording.duration);
  return (
    <>
      {o.kind === 'blur' && (
        <>
          <Heading>Blur</Heading>
          <Seg label="Blur" options={BLUR_MODES} value={blur.mode} onChange={(mode) => edit({ blur: { ...blur, mode } })} />
          <AmountSlider amount={blur.amount} disabled={p.readOnly} onCommit={(amount) => { if (amount !== blur.amount) edit({ blur: { ...blur, amount } }); }} />
          <Switch label="Follow the element" sub="Tracks this box as the page scrolls. Tab recordings only." on={blur.follow}
            disabled={p.readOnly || (!p.project.events && !blur.follow)} onChange={(follow) => edit({ blur: { ...blur, follow } })} />
        </>
      )}
      {(o.kind === 'text' || o.kind === 'callout') && (
        <>
          <Heading>{OVERLAY_NAMES[o.kind]}</Heading>
          <TextField o={o} edit={edit} readOnly={p.readOnly} />
        </>
      )}
      <Heading>Timing</Heading>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 14px', fontSize: 12.5 }}>
        <span style={{ color: C.secondary }}>Shows</span><span style={{ fontFamily: MONO }}>{clock(from, true)} to {clock(to, true)}</span>
      </div>
      <Seg label="Timing" options={MOTIONS} value={o.motion} onChange={(motion) => edit({ motion })} />
      <Switch label="Keep for the whole video" on={whole} disabled={p.readOnly}
        onChange={(on) => edit(on ? { at: 0, end: p.recording.duration } : spanAt(p.cut, p.out, p.recording.duration))} />
    </>
  );
}
