import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@appskord/ui/tokens.css';
import '@appskord/ui/ModelPicker.css';
import '../../styles/tokens.css';
import '../../styles/fonts.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
