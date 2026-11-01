import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '../sidepanel/style.css';
import { player } from './router';

// The full-screen player window, opened from the side panel's full-screen button.
const query = new URLSearchParams(location.search);
const atMs = Number(query.get('atMs')) || 0;
const initial = { screen: 'Review' as const, params: { recordingId: query.get('recordingId') ?? undefined, atMs } };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <player.RouterProvider initial={initial} />
  </StrictMode>,
);
