// V4States: the banners, inline states and cards that every v4 screen shows when something is waiting or wrong.
import type { ReactNode } from 'react';
import './states.css';

const svg = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
const ICONS = {
  info: <svg {...svg}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.5" /></svg>,
  warn: <svg {...svg}><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17v.5" /></svg>,
  off: <svg {...svg}><path d="M3 3l18 18M8.5 5.2A9 9 0 0121 12M5 8.5A9 9 0 003 12a9 9 0 009 9" /></svg>,
  done: <svg {...svg}><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></svg>,
};

export type BannerTone = 'promise' | 'warn' | 'alert' | 'plain';
export interface BannerAction { label: string; onClick: () => void; kind: 'primary' | 'light' | 'link' }

/** A banner: icon, title, optional line and one action. `alert` is announced at once; the rest are status. */
export function StateBanner({ tone, icon, title, body, action, alert = false }: {
  tone: BannerTone; icon: keyof typeof ICONS; title: string; body?: string; action?: BannerAction; alert?: boolean;
}) {
  return (
    <div role={alert ? 'alert' : 'status'} className={`st4-banner st4-${tone}`}>
      <span className="st4-icon">{ICONS[icon]}</span>
      <span className="st4-text">
        <span className="st4-title">{title}</span>
        {body && <span className="st4-body">{body}</span>}
        {action && (
          <div className="st4-actions">
            <button type="button" className={`st4-${action.kind}`} onClick={action.onClick}>{action.label}</button>
          </div>
        )}
      </span>
    </div>
  );
}

/** A centred empty card: "No people yet", "Nothing open. Every promise is kept.", "No briefs without a calendar". */
export function EmptyCard({ title, body, action }: { title: string; body: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="st4-empty">
      <span className="st4-empty-title">{title}</span>
      <span className="st4-empty-body">{body}</span>
      {action && <button type="button" className="st4-empty-btn" onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}

const MB = 1024 * 1024;

/** "Downloading search model · 9 of 22 MB" with its bar. */
export function ModelDownloadCard({ loaded, total }: { loaded: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  return (
    <div className="st4-card st4-download" role="status">
      <div className="st4-download-row"><span>Downloading search model</span><span className="st4-mono">{Math.round(loaded / MB)} of {Math.round(total / MB) || 22} MB</span></div>
      <div className="st4-bar" role="progressbar" aria-label="Search model" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><div style={{ width: `${pct}%` }} /></div>
      <span className="st4-download-note">You can keep using Rekord while it downloads.</span>
    </div>
  );
}

/** The search model failed to download: keyword search still works. */
export function ModelFailedBanner({ onRetry }: { onRetry: () => void }) {
  return <StateBanner alert tone="warn" icon="warn" title="The search model didn’t download" body="Keyword search still works." action={{ label: 'Try again', kind: 'light', onClick: onRetry }} />;
}

/** The play button found no such words near the quote's time: the transcript was edited since. */
export function QuoteMissingCard({ quote, caption, onOpen }: { quote: string; caption: string; onOpen: () => void }) {
  return (
    <div className="st4-card st4-quote">
      <div className="st4-quote-block">
        <span className="st4-quote-text">{quote}</span>
        <span className="st4-mono st4-quote-cap">{caption}</span>
      </div>
      <span className="st4-title">Quote not found in this transcript</span>
      <span className="st4-quote-body">The quote moved when the transcript was edited.</span>
      <button type="button" className="st4-link st4-quote-open" onClick={onOpen}>Open the meeting</button>
    </div>
  );
}

/** One labelled card on the V4States board (dev route only). */
export function BoardCard({ label, children }: { label: string; children: ReactNode }) {
  return <section className="st4-board-card"><h2>{label}</h2>{children}</section>;
}
