import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@appskord/platform/router';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@appskord/ui/tokens.css';
import '@appskord/ui/components.css';
import '@/lib/ui/briefkord.css';
import './board.css';
import './list/register';
import { createAppRouter } from './router';
import './diagram/register';
import './share/register';
import './ai/register';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={createAppRouter()} />
  </StrictMode>,
);
