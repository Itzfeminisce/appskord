import { useState } from 'react';
import { Button, IconButton } from '../components/ui';
import { useRouter } from '../entrypoints/editor/router';
import { HOSTS, requestHost } from '../lib/hostAccess';

/** Free media, the first time a library is searched. Chrome shows its own prompt for the host. */
export default function AccessPrompt() {
  const { back, navigate, replace, canGoBack } = useRouter();
  const [busy, setBusy] = useState(false);

  const leave = () => (canGoBack ? back() : replace('Editor'));

  async function allow() {
    setBusy(true);
    const access = await requestHost(HOSTS.openverse);
    setBusy(false);
    if (access === 'granted') navigate('MediaSearch');
    else leave();
  }

  return (
    <main data-frame="AccessPrompt" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', maxWidth: 520, width: '100%', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 0' }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Free media</h1>
        <IconButton aria-label="Close" onClick={leave}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </IconButton>
      </div>
      <div style={{ margin: '24px 20px 0', padding: 24, borderRadius: 18, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
        <span aria-hidden="true" style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--tint-strong)', display: 'grid', placeItems: 'center' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
        </span>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Allow Motikord to search Openverse</h2>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--muted)' }}>Chrome asks once, the first time you search a library. Motikord sends only your search words. Files you pick are downloaded once and kept on this computer.</p>
        <Button block busy={busy} onClick={() => void allow()}>Allow and search</Button>
        <Button block variant="ghost" onClick={leave}>Not now</Button>
      </div>
    </main>
  );
}
