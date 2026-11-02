import type { SlotProps } from '../components/slots';
import { Heading } from '../timeline/controls';
import { select, useTimeline } from '../timeline/store';
import { C, Icon, ICONS, iconButton } from '../ui';
import { useBrand } from './brand';
import { CardFields, CardPicker } from './CardPanel';
import { addOverlay, newOverlay } from './model';
import { OVERLAY_ICONS, OVERLAY_KINDS, OVERLAY_NAMES, setStory } from './store';

const ADD_BUTTON = {
  height: 30, padding: '0 9px', borderRadius: 8, border: `1px solid ${C.line}`, background: C.raised, color: C.text, fontFamily: 'inherit',
  fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
} as const;

/** The brand kit row: the kit's logo as the swatch, and Edit. */
function BrandRow() {
  const brand = useBrand();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 9, background: C.raised, border: `1px solid ${C.line}` }}>
      <span aria-hidden="true" style={{ width: 20, height: 20, borderRadius: 5, background: brand?.logo ? '#FFFFFF' : 'transparent', border: brand?.logo ? 0 : `1px dashed ${C.line}`, boxSizing: 'border-box', overflow: 'hidden', display: 'flex' }}>
        {brand?.logo && <img src={brand.logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
      </span>
      <span style={{ flexGrow: 1, fontSize: 12.5 }}>Brand kit</span>
      <button type="button" onClick={() => setStory({ brandKit: true })}
        style={{ border: 0, background: 'transparent', padding: 0, color: C.accentText, fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Edit</button>
    </div>
  );
}

/** The Text and cards panel (Cards frame): adds overlays at the playhead, and Motikord's cards with their slots. */
export function StoryPanel(p: SlotProps) {
  const { selected } = useTimeline();
  const active = selected?.kind === 'cards' && selected.ids.length === 1 ? p.cut.cards.find((c) => c.id === selected.ids[0]) : undefined;
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
        <CardPicker p={p} active={active} />
        {active && <CardFields key={active.id} p={p} card={active} />}
        <BrandRow />
      </div>
    </div>
  );
}
