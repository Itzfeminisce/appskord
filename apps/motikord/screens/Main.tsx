import type { ReactNode } from 'react';
import { Button } from '../components/ui';
import { useRouter } from '../entrypoints/sidepanel/router';
import { Footer, Page } from './Setup';

const stroke = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'var(--accent)', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, style: { flexShrink: 0 } } as const;

function Point({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <li style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>{icon}{children}</li>;
}

const chip = (width: string, margin: string, bg: string, color: string, text: string, weight = 400) => (
  <span style={{ height: 18, borderRadius: 5, background: bg, width, marginLeft: margin, display: 'flex', alignItems: 'center', paddingLeft: 6, fontSize: 10, color, fontWeight: weight }}>{text}</span>
);

/** Welcome. */
export default function Main() {
  const { navigate } = useRouter();
  return (
    <Page frame="Main">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 24px 0' }}>
        <span style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--ink)', display: 'grid', placeItems: 'center' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M3 8.5h5M2 12h6M3 15.5h5" /><circle cx="15.5" cy="12" r="4.5" fill="var(--accent)" stroke="none" /></svg>
        </span>
        <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>Motikord</span>
      </div>

      <div aria-hidden="true" style={{ margin: '24px 24px 0', height: 196, borderRadius: 18, background: 'var(--ink)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 24, top: 22, width: 92, height: 152, borderRadius: 10, background: 'var(--tint-strong)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: 10, gap: 4 }}>
          <span style={{ width: 44, height: 6, borderRadius: 3, background: 'var(--accent)' }} />
          <span style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.1, color: 'var(--ink)' }}>Fresh sourdough</span>
        </div>
        <div style={{ position: 'absolute', left: 132, top: 22, right: 22, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="mono" style={{ fontSize: 10, color: '#A1A1AA' }}>Scene 1 · Promo · 9:16</span>
          {chip('82%', '0', 'var(--accent)', '#fff', 'Title · Rise', 500)}
          {chip('64%', '14%', '#3F3F46', '#E4E4E7', 'Photo · Slow zoom')}
          {chip('50%', '30%', '#3F3F46', '#E4E4E7', 'Subtitle · Fade')}
          {chip('100%', '0', '#27272A', '#A1A1AA', 'Music · Sunny morning')}
        </div>
        <span style={{ position: 'absolute', left: 132, right: 22, bottom: 20, height: 2, background: '#3F3F46' }} />
        <span style={{ position: 'absolute', left: 196, bottom: 14, width: 2, height: 14, background: '#F9A8D4' }} />
      </div>

      <div style={{ padding: '24px 24px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h1 style={{ margin: 0, fontSize: 26, lineHeight: 1.2, fontWeight: 600, letterSpacing: '-0.02em' }}>Short animated clips, made on your computer</h1>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--muted)' }}>Type what you want, pick something on a page, or drop in your own media. Motikord makes the clip, and you change it with words or by hand.</p>
      </div>

      <ul style={{ listStyle: 'none', margin: '20px 24px 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13, lineHeight: 1.45, color: '#2A2B30' }}>
        <Point icon={<svg {...stroke}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9.5v5l4-2.5z" /></svg>}>Promos, quotes, chart reveals, logo intros, captions and social posts</Point>
        <Point icon={<svg {...stroke}><path d="M4 5h16v11H9l-5 4z" /></svg>}>Change it by asking: “slower”, “bigger title”, “use my brand colours”</Point>
        <Point icon={<svg {...stroke}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>}>Your clips and media never leave your computer</Point>
      </ul>

      <Footer>
        <Button block onClick={() => navigate('Setup')}>Get started</Button>
        <a href="#privacy" onClick={(e) => { e.preventDefault(); navigate('Privacy'); }} style={{ textAlign: 'center', fontSize: 13, fontWeight: 500, textDecoration: 'none', marginTop: 4 }}>Where your data goes</a>
      </Footer>
    </Page>
  );
}
