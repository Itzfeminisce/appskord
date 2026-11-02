import { useEffect, useSyncExternalStore } from 'react';
import type { InspectorProps } from '../components/Inspector';
import type { SlotProps } from '../components/slots';
import { BrandKit } from '../dialogs/BrandKit';
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

/** Fills T7's selection header for one overlay: its kind's name and its settings. */
function inspector(p: SlotProps, base: Pick<InspectorProps, 'selection'> | undefined): Pick<InspectorProps, 'selection'> | undefined {
  const selection = base?.selection;
  const selected = timelineState().selected;
  if (!selection || selected?.kind !== 'overlays' || selected.ids.length !== 1) return base;
  const o = p.cut.overlays.find((x) => x.id === selected.ids[0]);
  if (!o) return base;
  return {
    selection: {
      ...selection, name: OVERLAY_NAMES[o.kind],
      body: <div key={o.id} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}><OverlayPanel p={p} o={o} /></div>,
    },
  };
}

/** T14's part of the editor: the Text and cards panel, overlay settings, preview handles and the brand kit. */
export const storySlots = { Host, Cover, Handles: OverlayHandles, inspector, subscribe: subscribeStory };
