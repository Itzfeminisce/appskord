import type { CSSProperties, ReactNode } from 'react';
import { actionStyle } from './StatesSetup';

// StatesMedia frame: every state of Free media. Each card's label in the frame is `<state-id> · <screen it appears on>`.

const ghostAction: CSSProperties = { ...actionStyle, background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line-strong)' };
const icon = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, style: { flexShrink: 0 } };

function Row({ tone = 'plain', glyph, title, children, actions, role }: { tone?: 'plain' | 'error'; glyph: ReactNode; title: string; children: ReactNode; actions?: ReactNode; role?: 'status' | 'alert' }) {
  const t = tone === 'error' ? { bg: 'var(--error-bg)', line: 'var(--error-line)' } : { bg: 'var(--surface)', line: 'var(--line)' };
  return (
    <div role={role} style={{ padding: 14, borderRadius: 14, background: t.bg, border: `1px solid ${t.line}`, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      {glyph}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexGrow: 1 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>{children}</span>
        {actions && <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>{actions}</div>}
      </div>
    </div>
  );
}

const btn = (text: string, onClick?: () => void, style: CSSProperties = actionStyle) => <button key={text} type="button" onClick={onClick} style={style}>{text}</button>;

export function MediaSearching() {
  return (
    <div role="status" style={{ padding: 12, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>Searching Openverse and Pexels…</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
        {[0, 1, 2].map((i) => <span key={i} style={{ height: 64, borderRadius: 8, background: 'var(--stage)' }} />)}
      </div>
    </div>
  );
}

export function MediaNoResults({ query, onClear }: { query: string; onClear?: () => void }) {
  return (
    <div style={{ padding: 14, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{`Nothing free to use for “${query}”`}</span>
      <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>Try fewer words, or search Videos or Music.</span>
      <button type="button" onClick={onClear} style={{ ...ghostAction, alignSelf: 'flex-start', marginTop: 4, background: 'var(--surface)' }}>Clear search</button>
    </div>
  );
}

export function MediaOffline({ onUseMedia }: { onUseMedia?: () => void }) {
  return (
    <Row role="status" glyph={<svg {...icon} stroke="var(--muted)"><path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19v.01M3 3l18 18" /></svg>}
      title="Search needs the internet" actions={btn('Use your media', onUseMedia, ghostAction)}>
      Your own media, media you added before and the bundled music still work.
    </Row>
  );
}

export function PexelsNeedsKey({ onAddKey }: { onAddKey?: () => void }) {
  return (
    <Row glyph={<svg {...icon} stroke="var(--accent)"><circle cx="8" cy="14" r="4" /><path d="M11 11l9-9M17 5l2 2M15 7l2 2" /></svg>}
      title="Pexels needs a free key"
      actions={[btn('Add a Pexels key', onAddKey), <a key="get" href="https://www.pexels.com/api/" target="_blank" rel="noreferrer" style={ghostAction}>Get one free</a>]}>
      Openverse results still show. Share a Pexels key in Penv Cloud, or paste one, to see Pexels photos and videos.
    </Row>
  );
}

export function LibraryDenied({ onAllow }: { onAllow?: () => void }) {
  return (
    <Row role="status" glyph={<svg {...icon} stroke="var(--muted)"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" /></svg>}
      title="Openverse search is off" actions={btn('Allow Openverse', onAllow)}>
      You chose Deny in Chrome, so nothing was sent. Allow it to search, or use your own media.
    </Row>
  );
}

export function MediaDownloadFailed({ what = 'photo', onRetry }: { what?: 'photo' | 'video' | 'track'; onRetry?: () => void }) {
  return (
    <Row role="alert" tone="error" glyph={<svg {...icon} stroke="var(--error-ink)"><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></svg>}
      title={`Couldn’t download this ${what}`} actions={btn('Try again', onRetry)}>
      The site that hosts it didn’t send the file. Try again, or pick another one.
    </Row>
  );
}

export function AllLicencesOn() {
  return (
    <div role="status" style={{ padding: '10px 14px', borderRadius: 12, background: 'var(--warning-bg)', border: '1px solid var(--warning-line)', fontSize: 12, lineHeight: 1.45, color: 'var(--warning-ink)' }}>
      Showing all licences. Share-alike and non-commercial media have extra rules. Check the licence before you use it.
    </div>
  );
}

/** Every state on one page, for review. */
export default function StatesMedia() {
  return (
    <main data-frame="StatesMedia" style={{ maxWidth: 400, width: '100%', margin: '0 auto', padding: '20px 12px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <MediaSearching />
      <MediaNoResults query="sourdough croissant bagel" />
      <MediaOffline />
      <PexelsNeedsKey />
      <LibraryDenied />
      <MediaDownloadFailed />
      <AllLicencesOn />
    </main>
  );
}
