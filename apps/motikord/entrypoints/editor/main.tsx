import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@appskord/ui/tokens.css';
import '../../styles/tokens.css';
import '../../styles/fonts.css';
import { loadV3Fonts } from '../../lib/look/fonts';
import App from './App';

// The v3 packs' bundled fonts, for the pack tiles and previews.
void loadV3Fonts(document.fonts, location.origin + '/');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
