import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@appskord/ui/tokens.css';
import '@appskord/ui/components.css';
import '../sidepanel/style.css';
import LookBack from './LookBack';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LookBack />
  </StrictMode>,
);
