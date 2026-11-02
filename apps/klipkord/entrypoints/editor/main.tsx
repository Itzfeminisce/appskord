import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './style.css';
import { browserDeps } from './browserDeps';
import { exportSlots } from './components/Exporting';
import type { EditorSlots } from './Editor';
import { LayoutPanel } from './inspector/Layout';
import { EditorApp } from './router';
import { captionsSlots, lookSlots } from './inspector/slots';
import { AutoZoomOnOpen, FocusStage } from './inspector/ZoomEdit';
import { timelineSlots } from './timeline/slots';
import { transcriptSlots } from './transcript';
import { mediaSlots } from './voiceover';

const Timeline = timelineSlots.timeline!;
const Aside = transcriptSlots.aside;
// Each task's inspector fills its own tabs; T7's also owns the selection header.
const slots = {
  ...transcriptSlots,
  ...timelineSlots,
  ...exportSlots,
  topBar: (p) => ({ ...timelineSlots.topBar?.(p), ...exportSlots.topBar?.(p) }),
  inspector: (p) => ({ ...timelineSlots.inspector?.(p), panels: { ...timelineSlots.inspector?.(p).panels, ...captionsSlots.inspector?.(p).panels, ...lookSlots.inspector?.(p).panels, Layout: <LayoutPanel {...p} /> } }),
  // Add media and Voiceover live beside the timeline (with T10's first-open autoZoom); a take's panel shares the inspector cover with Clean up.
  timeline: (p) => <><Timeline {...p} /><mediaSlots.Host {...p} /><AutoZoomOnOpen {...p} /></>,
  stage: FocusStage,
  aside: (p) => <><Aside {...p} /><mediaSlots.Cover /></>,
  subscribe: (onChange) => {
    const offs = [timelineSlots.subscribe?.(onChange), mediaSlots.subscribe(onChange)];
    return () => offs.forEach((off) => off?.());
  },
} satisfies EditorSlots;

// The editor tab: editor.html#/<recordingId>, opened from the side panel's Saved screen and Library.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EditorApp deps={browserDeps()} slots={slots} />
  </StrictMode>,
);
