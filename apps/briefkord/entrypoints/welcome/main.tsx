/** Frame Welcome: the tab opened on install. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@/lib/ui/briefkord.css';
import './welcome.css';
import { sendIntent } from '@/lib/capture/intent';

const STEPS = [
  ['Pin Briefkord to the toolbar', 'Click the puzzle piece next to the address bar, then the pin beside Briefkord.'],
  ['Open the side panel and name a board', 'One board per topic or meeting. You can make more any time.'],
  ['Save pages, images and notes', '“Save this page” in the panel, or right-click an image or selected text.'],
] as const;

let windowId: number | undefined;
chrome.windows.getCurrent((win) => (windowId = win.id));

// Chrome opens the side panel only on a user gesture, so the window is known before the click.
function openPanel(route?: { route: string; search?: Record<string, string> }) {
  if (windowId !== undefined) chrome.sidePanel.open({ windowId }).catch((error: unknown) => console.error('Briefkord: could not open the side panel', error));
  if (route) void sendIntent(route);
}

function Welcome() {
  return (
    <div className="w-page">
      <main className="w-main">
        <span className="w-logo" aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
            <rect x="4" y="4" width="7" height="9" rx="2" fill="#FFFFFF" />
            <rect x="13" y="4" width="7" height="5" rx="2" fill="#FFFFFF" />
            <rect x="13" y="11" width="7" height="9" rx="2" fill="#14B8A6" />
            <rect x="4" y="15" width="7" height="5" rx="2" fill="#FFFFFF" />
          </svg>
        </span>
        <h1>Welcome to Briefkord</h1>
        <p className="w-lead">One board for every meeting. Save what you find while you browse, arrange it on a canvas or as an agenda, then walk through it.</p>
        <ol className="w-steps">
          {STEPS.map(([title, text], i) => (
            <li key={title}>
              <span className="w-num">{i + 1}</span>
              <span className="w-step-text">
                <strong>{title}</strong>
                <span>{text}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="w-actions">
          <button type="button" className="w-open" onClick={() => openPanel()}>
            Open the side panel
          </button>
          <span>AI is optional. Set it up later in Settings.</span>
        </div>
      </main>
      <aside className="w-art" aria-hidden="true">
        <span className="w-card w-flow">
          <span style={{ left: 20, top: 40, width: 64, height: 30, borderRadius: 8, border: '1.5px solid var(--bk-text)' }} />
          <span style={{ left: 108, top: 40, width: 64, height: 30, borderRadius: 8, border: '1.5px solid var(--bk-accent)', background: 'var(--bk-tint)' }} />
          <span style={{ left: 196, top: 40, width: 64, height: 30, borderRadius: 15, border: '1.5px solid var(--bk-text)' }} />
          <span style={{ left: 84, top: 54, width: 24, height: 1.5, background: 'var(--bk-text)' }} />
          <span style={{ left: 172, top: 54, width: 24, height: 1.5, background: 'var(--bk-text)' }} />
          <span style={{ left: 100, top: 110, width: 80, height: 50, borderRadius: 8, border: '1.5px solid var(--w-amber)', background: 'var(--bk-warn)' }} />
        </span>
        <span className="w-card w-link">
          <span className="w-link-top" />
          <span className="w-bar" style={{ margin: '16px 16px 0', width: '70%' }} />
          <span className="w-bar is-light" style={{ margin: '8px 16px 0', width: '46%' }} />
        </span>
        <span className="w-card w-note">
          <span className="w-note-bar" style={{ margin: '22px 18px 0', width: '74%' }} />
          <span className="w-note-bar is-light" style={{ margin: '10px 18px 0', width: '52%' }} />
        </span>
        <span className="w-card w-meeting">
          <span className="w-meeting-progress" />
          <span className="w-meeting-slide" />
        </span>
      </aside>
      <p className="w-privacy">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--bk-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
        Everything stays on this computer. No account, no tracking.{' '}
        <a
          href="#privacy"
          onClick={(event) => {
            event.preventDefault();
            openPanel({ route: '/settings', search: { show: 'privacy' } });
          }}
        >
          Where your data goes
        </a>
      </p>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Welcome />
  </StrictMode>,
);
