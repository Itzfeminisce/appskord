import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './style.css';
import { browserDeps } from './browserDeps';
import type { EditorSlots } from './Editor';
import { LayoutPanel } from './inspector/Layout';
import { EditorApp } from './router';
import { captionsSlots } from './inspector/slots';
import { timelineSlots } from './timeline/slots';
import { transcriptSlots } from './transcript';
import { mediaSlots } from './voiceover';

const Timeline = timelineSlots.timeline!;
const Aside = transcriptSlots.aside;
// Each task's inspector fills its own tabs; T7's also owns the selection header.
const slots = {
  ...transcriptSlots,
  ...timelineSlots,
  inspector: (p) => ({ ...timelineSlots.inspector?.(p), panels: { ...timelineSlots.inspector?.(p).panels, ...captionsSlots.inspector?.(p).panels, Layout: <LayoutPanel {...p} /> } }),
  // Add media and Voiceover live beside the timeline; a take's panel shares the inspector cover with Clean up.
  timeline: (p) => <><Timeline {...p} /><mediaSlots.Host {...p} /></>,
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
