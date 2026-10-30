import { useRouter } from '../entrypoints/sidepanel/router';
import { BackButton } from './Setup';

const IDEAS = ['A 5-second logo intro from your logo file', 'A quote card from a line on any web page', 'A chart that grows from a table on any site'];

export default function LibraryEmpty() {
  const { replace } = useRouter();
  const home = () => replace('Home');
  return (
    <main data-frame="LibraryEmpty" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '16px 16px 0' }}>
        <BackButton onBack={home} />
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Your clips</h1>
      </div>
      <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 32px', gap: 14, textAlign: 'center' }}>
        <span style={{ width: 64, height: 64, borderRadius: 18, background: 'var(--ink)', display: 'grid', placeItems: 'center' }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M3 8.5h5M2 12h6M3 15.5h5" /><circle cx="15.5" cy="12" r="4.5" fill="#BE185D" stroke="none" /></svg>
        </span>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>No clips yet</h2>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--muted)' }}>Clips you make are kept here, on this computer.</p>
        <button type="button" onClick={home} style={{ width: '100%', height: 48, border: 0, borderRadius: 12, background: 'var(--accent)', color: '#fff', font: '600 15px var(--font)', cursor: 'pointer' }}>Make your first clip</button>
        <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: '14px 16px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left', fontSize: 13, lineHeight: 1.45, color: '#2A2B30', width: '100%' }}>
          <li className="mono" style={{ fontSize: 12, color: 'var(--faint)' }}>Ideas to try</li>
          {IDEAS.map((idea) => <li key={idea}>{idea}</li>)}
        </ul>
      </div>
    </main>
  );
}
