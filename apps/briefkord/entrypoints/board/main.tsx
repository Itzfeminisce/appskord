import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@appskord/platform/router';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@appskord/ui/tokens.css';
import '@appskord/ui/components.css';
import '@/lib/ui/briefkord.css';
import { createAppRouter } from './router';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={createAppRouter()} />
  </StrictMode>,
);
