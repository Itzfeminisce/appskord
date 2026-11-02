import { colourOf } from '@appskord/brand';
import { cardsReady } from '@/lib/render/layers/card';
import type { SlotProps } from '../components/slots';
import { StateCard } from '../states/StateCard';
import { Heading } from '../timeline/controls';
import { select } from '../timeline/store';
import { C, Icon, ICONS, iconButton } from '../ui';
import { useBrand } from './brand';
import { addOverlay, newOverlay } from './model';
import { OVERLAY_ICONS, OVERLAY_KINDS, OVERLAY_NAMES, setStory } from './store';

const ADD_BUTTON = {
  height: 30, padding: '0 9px', borderRadius: 8, border: `1px solid ${C.line}`, background: C.raised, color: C.text, fontFamily: 'inherit',
  fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
} as const;

/** The brand kit row: its main colour and Edit. */
function BrandRow() {
  const brand = useBrand();
  const main = brand ? colourOf(brand.kit, 'primary') ?? colourOf(brand.kit, 'text') : undefined;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 9, background: C.raised, border: `1px solid ${C.line}` }}>
      <span aria-hidden="true" style={{ width: 20, height: 20, borderRadius: 5, background: main ?? 'transparent', border: main ? 0 : `1px dashed ${C.line}`, boxSizing: 'border-box' }} />
      <span style={{ flexGrow: 1, fontSize: 12.5 }}>Brand kit</span>
      <button type="button" onClick={() => setStory({ brandKit: true })}
        style={{ border: 0, background: 'transparent', padding: 0, color: C.accentText, fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Edit</button>
    </div>
  );
}

/** The Text and cards panel (Cards frame): adds overlays at the playhead; cards wait for Motikord's templates. */
export function StoryPanel(p: SlotProps) {
  const add = (kind: (typeof OVERLAY_KINDS)[number]) => {
    if (p.readOnly) return;
    const overlay = newOverlay(p.cut, kind, p.out, p.recording.duration);
    p.edit((q) => addOverlay(q, overlay));
    setStory({ panel: false });
    select({ kind: 'overlays', ids: [overlay.id] });
  };
  return (
    <div role="region" aria-label="Text and cards" style={{ position: 'absolute', inset: 0, background: C.panel, display: 'flex', flexDirection: 'column', zIndex: 2 }}>
      <div style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px 0 6px', borderBottom: `1px solid ${C.line}` }}>
        <button type="button" aria-label="Back" title="Back" onClick={() => setStory({ panel: false })} style={iconButton(28)}><Icon>{ICONS.back}</Icon></button>
        <span style={{ fontSize: 13, fontWeight: 600, flexGrow: 1 }}>Text and cards</span>
      </div>
      <div style={{ display: 'flex', gap: 6, padding: '10px 14px 0', flexWrap: 'wrap' }}>
        {OVERLAY_KINDS.map((kind) => (
          <button key={kind} type="button" title={OVERLAY_NAMES[kind]} disabled={p.readOnly} onClick={() => add(kind)} style={{ ...ADD_BUTTON, opacity: p.readOnly ? 0.5 : 1 }}>
            <Icon size={13}>{OVERLAY_ICONS[kind]}</Icon>{OVERLAY_NAMES[kind]}
          </button>
        ))}
      </div>
      <div style={{ flexGrow: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Heading aside={<span style={{ fontWeight: 400, color: C.muted }}>from Motikord</span>}>Cards</Heading>
        {/* Title hook, End card and Logo sting draw through packages/scenes, which has not landed yet. */}
        {!cardsReady() && (
          <StateCard state="cards-not-ready" title="Cards are on the way"
            body="Title, end and logo cards arrive with Motikord's templates. Text, arrows and blur work now." style={{ minHeight: 120 }} />
        )}
        <BrandRow />
      </div>
    </div>
  );
}
