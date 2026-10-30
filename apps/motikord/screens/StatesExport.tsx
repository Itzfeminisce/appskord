import type { CSSProperties, ReactNode } from 'react';
import { actionStyle } from './StatesSetup';

// StatesExport frame: every state of Export and Exporting. Each card's label in the frame is `<state-id> · <screen it appears on>`.

export const ghostAction: CSSProperties = { ...actionStyle, background: 'var(--surface)', color: 'var(--ink)', border: '1px solid #E0E0E4' };
const icon = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, style: { flexShrink: 0 } };
const TONES = {
  plain: { bg: 'var(--surface)', line: 'var(--line)' },
  warning: { bg: 'var(--warning-bg)', line: 'var(--warning-line)' },
  error: { bg: 'var(--error-bg)', line: 'var(--error-line)' },
} as const;

function Row({ tone = 'plain', glyph, title, children, actions, role }: { tone?: keyof typeof TONES; glyph: ReactNode; title: string; children: ReactNode; actions?: ReactNode; role?: 'status' | 'alert' }) {
  const t = TONES[tone];
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
const errorGlyph = <svg {...icon} stroke="var(--error-ink)"><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></svg>;

export function FolderNotPicked({ onChoose }: { onChoose?: () => void }) {
  return (
    <Row glyph={<svg {...icon} stroke="var(--accent)"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>}
      title="Choose where your clips are saved" actions={btn('Choose folder', onChoose)}>
      Pick a folder once. Every export lands there.
    </Row>
  );
}

export function FolderAccessLost({ folder = 'Motikord clips', onAllow, onChooseAnother }: { folder?: string; onAllow?: () => void; onChooseAnother?: () => void }) {
  return (
    <Row role="alert" tone="warning" glyph={<svg {...icon} stroke="#B45309"><path d="M12 3.5l9.5 16.5h-19z" /><path d="M12 10v4.5M12 17.5v.01" /></svg>}
      title={`Motikord needs your OK to save in “${folder}”`} actions={[btn('Allow', onAllow), btn('Choose another folder', onChooseAnother, ghostAction)]}>
      Chrome asks again after a restart. Nothing was lost.
    </Row>
  );
}

export function CreditLocked() {
  return (
    <div role="note" style={{ padding: '10px 14px', borderRadius: 12, background: 'var(--ink)', color: '#fff', fontSize: 12, lineHeight: 1.45 }}>
      This clip uses CC BY media, so credits.txt is always included. Remove that media to turn it off.
    </div>
  );
}

export function TypeNotes({ gif = true, seeThrough = true }: { gif?: boolean; seeThrough?: boolean }) {
  if (!gif && !seeThrough) return null;
  return (
    <div role="note" style={{ padding: '12px 14px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, lineHeight: 1.45, color: '#44464D' }}>
      {gif && <span><strong style={{ fontWeight: 600 }}>GIF:</strong> GIFs have no sound, so the music is left out.</span>}
      {seeThrough && <span><strong style={{ fontWeight: 600 }}>See-through WebM:</strong> The background is left out. Place it over other videos in your editor.</span>}
    </div>
  );
}

export interface SeveralRow { label: string; status: 'done' | 'running' | 'waiting'; percent: number }
export function ExportingSeveral({ rows, index }: { rows: SeveralRow[]; index: number }) {
  return (
    <div role="status" style={{ padding: '12px 14px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
      {rows.map((r, i) => (
        <span key={`${r.label}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', color: r.status === 'waiting' ? 'var(--faint)' : undefined }}>
          <span style={{ fontWeight: r.status === 'running' ? 600 : undefined }}>{r.label}</span>
          {r.status === 'done' && <span style={{ color: 'var(--success-ink)', fontWeight: 600 }}>Done</span>}
          {r.status === 'running' && <span style={{ fontFamily: 'var(--mono)' }}>{`${Math.floor(r.percent)}%`}</span>}
          {r.status === 'waiting' && <span>Waiting</span>}
        </span>
      ))}
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{`Exporting ${index + 1} of ${rows.length}`}</span>
    </div>
  );
}

export function DiskFull({ percent = 46, onAgain }: { percent?: number; onAgain?: () => void }) {
  return (
    <Row role="alert" tone="error" glyph={<svg {...icon} stroke="var(--error-ink)"><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></svg>}
      title="This computer is out of space" actions={btn('Export again', onAgain)}>
      {`The export stopped at ${Math.floor(percent)}%. Your clip is safe. Free up some space and export again.`}
    </Row>
  );
}

export function ExportFailed({ onRetry, onWebm }: { onRetry?: () => void; onWebm?: () => void }) {
  return (
    <Row role="alert" tone="error" glyph={errorGlyph} title="The export stopped" actions={[btn('Try again', onRetry), btn('Export as WebM', onWebm, ghostAction)]}>
      Chrome couldn’t make the video on this computer. Your clip is safe. Try again, or export as WebM.
    </Row>
  );
}

export function ExportSlow() {
  return (
    <div role="status" style={{ padding: '10px 14px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', gap: 10, alignItems: 'center' }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" /></svg>
      <span style={{ fontSize: 13, lineHeight: 1.45, color: '#44464D' }}>Exporting without the video chip, so this takes longer. Quality is the same.</span>
    </div>
  );
}

export function ExportCancelled() {
  return <div role="status" style={{ padding: '10px 14px', borderRadius: 12, background: 'var(--ink)', color: '#fff', fontSize: 13 }}>Export cancelled. Your clip is unchanged.</div>;
}

const label: CSSProperties = { margin: 0, padding: '0 4px', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 500, color: 'var(--faint)' };
function Section({ id, children }: { id: string; children: ReactNode }) {
  return <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><h2 style={label}>{id}</h2>{children}</section>;
}

/** Every state on one page, for review. */
export default function StatesExport() {
  return (
    <main data-frame="StatesExport" style={{ maxWidth: 400, width: '100%', margin: '0 auto', padding: '20px 12px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Section id="folder-not-picked · Export (first time)"><FolderNotPicked /></Section>
      <Section id="folder-access-lost · Export"><FolderAccessLost /></Section>
      <Section id="credit-locked · Export (credits checkbox)"><CreditLocked /></Section>
      <Section id="type-notes · Export (under File type)"><TypeNotes /></Section>
      <Section id="exporting-several · Exporting">
        <ExportingSeveral index={1} rows={[{ label: '9:16', status: 'done', percent: 100 }, { label: '1:1', status: 'running', percent: 38 }, { label: '16:9', status: 'waiting', percent: 0 }]} />
      </Section>
      <Section id="disk-full · Exporting"><DiskFull /></Section>
      <Section id="export-failed · Exporting"><ExportFailed /></Section>
      <Section id="export-slow · Exporting (no video chip)"><ExportSlow /></Section>
      <Section id="export-cancelled · Editor (toast)"><ExportCancelled /></Section>
    </main>
  );
}
