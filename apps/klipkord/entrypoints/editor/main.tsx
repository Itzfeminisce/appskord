import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './style.css';
import { browserDeps } from './browserDeps';
import { EditorApp } from './router';

// The editor tab: editor.html#/<recordingId>, opened from the side panel's Saved screen and Library.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EditorApp deps={browserDeps()} />
  </StrictMode>,
);
