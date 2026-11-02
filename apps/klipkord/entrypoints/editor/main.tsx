import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './style.css';
import { browserDeps } from './browserDeps';
import type { EditorSlots } from './Editor';
import { EditorApp } from './router';
import { captionsSlots } from './inspector/slots';
import { timelineSlots } from './timeline/slots';
import { transcriptSlots } from './transcript';

// Each task's inspector fills its own tabs; T7's also owns the selection header.
const slots: EditorSlots = {
  ...transcriptSlots,
  ...timelineSlots,
  inspector: (p) => ({ ...timelineSlots.inspector?.(p), panels: { ...timelineSlots.inspector?.(p).panels, ...captionsSlots.inspector?.(p).panels } }),
};

// The editor tab: editor.html#/<recordingId>, opened from the side panel's Saved screen and Library.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EditorApp deps={browserDeps()} slots={slots} />
  </StrictMode>,
);
