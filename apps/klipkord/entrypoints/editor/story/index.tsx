import { useEffect, useSyncExternalStore } from 'react';
import { cardTemplateName } from '@/lib/render/layers/card';
import type { InspectorProps } from '../components/Inspector';
import type { SlotProps } from '../components/slots';
import { BrandKit } from '../dialogs/BrandKit';
import { CardFields } from './CardPanel';
import { registerTimelineAction, timelineState } from '../timeline/store';
import { saveBrand } from './brand';
import { OverlayHandles } from './Handles';
import { OverlayPanel } from './OverlayPanel';
import { StoryPanel } from './Panel';
import { OVERLAY_NAMES, setStory, storyState, subscribeStory } from './store';

const useStory = () => useSyncExternalStore(subscribeStory, storyState);

/** Mounted beside the timeline: "Text or card" (T) opens the panel; the brand kit dialog draws here. */
function Host() {
  const s = useStory();
  useEffect(() => registerTimelineAction('text', () => setStory({ panel: !storyState().panel })), []);
  return s.brandKit ? <BrandKit onClose={() => setStory({ brandKit: false })} onSave={saveBrand} /> : null;
}

/** The Text and cards panel covers the inspector while it is open. */
function Cover(p: SlotProps) {
  const s = useStory();
  return s.panel ? <StoryPanel {...p} /> : null;
}

/** Fills T7's selection header for one card: its template's name, slots and style pack. */
function cardInspector(p: SlotProps, base: Pick<InspectorProps, 'selection'> | undefined, id: string): Pick<InspectorProps, 'selection'> | undefined {
  const card = p.cut.cards.find((x) => x.id === id);
  if (!card || !base?.selection) return base;
  const same = p.cut.cards.filter((x) => x.template === card.template).sort((a, b) => a.at - b.at);
  return {
    selection: {
      ...base.selection, name: cardTemplateName(card.template), index: same.findIndex((x) => x.id === card.id) + 1, count: same.length,
      body: <div key={card.id} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}><CardFields p={p} card={card} /></div>,
    },
  };
}

/** Fills T7's selection header for one overlay or card: its name and its settings. */
function inspector(p: SlotProps, base: Pick<InspectorProps, 'selection'> | undefined): Pick<InspectorProps, 'selection'> | undefined {
  const selection = base?.selection;
  const selected = timelineState().selected;
  if (selection && selected?.kind === 'cards' && selected.ids.length === 1) return cardInspector(p, base, selected.ids[0]!);
  if (!selection || selected?.kind !== 'overlays' || selected.ids.length !== 1) return base;
  const o = p.cut.overlays.find((x) => x.id === selected.ids[0]);
  if (!o) return base;
  // "{i} of {n}" counts this kind's overlays in time order, as the other selected blocks do.
  const same = p.cut.overlays.filter((x) => x.kind === o.kind).sort((a, b) => a.at - b.at);
  return {
    selection: {
      ...selection, name: OVERLAY_NAMES[o.kind], index: same.findIndex((x) => x.id === o.id) + 1, count: same.length,
      body: <div key={o.id} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}><OverlayPanel p={p} o={o} /></div>,
    },
  };
}

/** T14's part of the editor: the Text and cards panel, overlay settings, preview handles and the brand kit. */
export const storySlots = { Host, Cover, Handles: OverlayHandles, inspector, subscribe: subscribeStory };
