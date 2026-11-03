/** Frame Dictate, mic-panel-permission: the side panel can't show Chrome's mic prompt, so this tab asks, tells the panel, and closes. */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@/lib/ui/briefkord.css';
import '@/lib/dictate/dictate.css';
import './mic.css';
import { MIC_MESSAGE, micSettingsUrl, openMic, type MicMessage } from '@/lib/dictate/recorder';

const tell = (allowed: boolean) => browser.runtime.sendMessage({ type: MIC_MESSAGE, allowed } satisfies MicMessage).catch(() => undefined);

const MicIcon = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);

function MicPage() {
  const [refused, setRefused] = useState(false);
  const [busy, setBusy] = useState(false);
  const allow = async () => {
    setBusy(true);
    const stream = await openMic();
    setBusy(false);
    // Only the permission was wanted: nothing is recorded here.
    for (const t of stream?.getTracks() ?? []) t.stop();
    await tell(!!stream);
    if (stream) window.close();
    else setRefused(true);
  };
  return (
    <main className="m-page">
      <div className="m-card">
        <span className="m-icon"><MicIcon size={24} /></span>
        <h1>Let Briefkord use your microphone</h1>
        <p>The side panel can’t ask for it, so Briefkord asks here. Then go back and speak into Quick note.</p>
        {refused ? (
          <div role="alert" className="bk-dict-alert">
            <span className="bk-dict-alert-line">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4 2.5 20h19z" /><path d="M12 10v4M12 17v.01" /></svg>
              <span>Briefkord can’t use the microphone. Allow it in Chrome’s site settings, then try again.</span>
            </span>
            <button type="button" className="bk-dict-alert-btn" onClick={() => void browser.tabs.create({ url: micSettingsUrl() })}>Open settings</button>
          </div>
        ) : (
          <button type="button" className="m-allow" disabled={busy} onClick={() => void allow()}>
            <MicIcon size={16} />
            Allow microphone
          </button>
        )}
        <div className="m-note">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /></svg>
          <span>Chrome asks once. Audio goes to your speech provider only while the mic is on.</span>
        </div>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MicPage />
  </StrictMode>,
);
