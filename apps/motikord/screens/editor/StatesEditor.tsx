import type { ReactNode } from 'react';
import type { SaveStatus } from '../../lib/editor/autosave';

// StatesEditor frame: the editor's loading, first-run, preview, media, save and undo states. T8 and T9 add theirs.

const actionStyle = {
  height: 34, padding: '0 12px', border: 0, borderRadius: 9, background: 'var(--ink)', color: '#fff',
  font: '600 13px/1 var(--font)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', cursor: 'pointer',
} as const;

const svg = (size: number) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', strokeLinecap: 'round' as const, 'aria-hidden': true, style: { flexShrink: 0 } });

/** Whole tab, while the clip, its fonts and media load. */
export function EditorLoading({ name }: { name: string }) {
  return (
    <div role="status" style={{ padding: '22px 14px', borderRadius: 14, background: 'var(--stage)', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
      <svg {...svg(22)} stroke="var(--accent)" strokeWidth={2.4} style={{ animation: 'spin 0.8s linear infinite' }}><path d="M12 3a9 9 0 1 0 9 9" /></svg>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{`Opening “${name}”…`}</span>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>Loading fonts and media</span>
    </div>
  );
}

export function FirstRun({ onDone }: { onDone?: () => void }) {
  return (
    <div role="dialog" aria-label="Change it with words or by hand" style={{ padding: 14, borderRadius: 14, background: 'var(--ink)', color: '#fff', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>Change it with words or by hand</span>
      <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--line-strong)' }}>Type what you want in the box under the clip, or click anything on it. Every change can be undone.</span>
      <button type="button" className="btn btn-primary" onClick={onDone} style={{ alignSelf: 'flex-start', marginTop: 4, height: 34, padding: '0 14px', borderRadius: 9, fontSize: 13, fontWeight: 600 }}>Got it</button>
    </div>
  );
}

export function PreviewLight() {
  return (
    <div role="status" style={{ padding: '10px 14px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', gap: 10, alignItems: 'center' }}>
      <svg {...svg(16)} stroke="var(--muted)" strokeWidth={2}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" /></svg>
      <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>Showing a lighter preview to stay smooth. Your export is full quality.</span>
    </div>
  );
}

function Alert({ tone, icon, title, children, action }: { tone: 'warning' | 'error'; icon: ReactNode; title: string; children: ReactNode; action: ReactNode }) {
  return (
    <div role="alert" style={{ padding: 14, borderRadius: 14, background: `var(--${tone}-bg)`, border: `1px solid var(--${tone}-line)`, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      {icon}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexGrow: 1 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>{children}</span>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>{action}</div>
      </div>
    </div>
  );
}

/** `scene` counts from 1, as the scenes list does. */
export function MediaMissing({ file, scene, onReplace }: { file: string; scene: number; onReplace?: () => void }) {
  return (
    <Alert
      tone="warning"
      icon={<svg {...svg(20)} stroke="#B45309" strokeWidth={2} strokeLinejoin="round"><path d="M12 3.5l9.5 16.5h-19z" /><path d="M12 10v4.5M12 17.5v.01" /></svg>}
      title="A file this clip uses is missing"
      action={<button type="button" onClick={onReplace} style={actionStyle}>Replace it</button>}
    >
      {`“${file}” was removed from your media. Scene ${scene} shows a grey box until you replace it.`}
    </Alert>
  );
}

export function SaveFailed({ onRetry }: { onRetry?: () => void }) {
  return (
    <Alert
      tone="error"
      icon={<svg {...svg(20)} stroke="var(--error-ink)" strokeWidth={2}><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></svg>}
      title="Motikord couldn’t save your last change"
      action={<button type="button" onClick={onRetry} style={actionStyle}>Try again</button>}
    >
      This computer is out of space. Keep this tab open, free up some space, and Motikord will save again.
    </Alert>
  );
}

/** The top bar's save-status. */
export function SaveStatusLine({ status }: { status: SaveStatus }) {
  if (status === 'failed') {
    return (
      <span role="status" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--error-ink)', fontWeight: 500 }}>
        <svg {...svg(13)} stroke="var(--error-ink)" strokeWidth={2.4}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16v.01" /></svg>Not saved: this computer is out of space
      </span>
    );
  }
  return (
    <span role="status" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, color: 'var(--faint)' }}>
      {status === 'saving'
        ? <svg {...svg(13)} stroke="var(--faint)" strokeWidth={2.4}><path d="M12 3a9 9 0 1 0 9 9" /></svg>
        : <svg {...svg(13)} stroke="var(--success-ink)" strokeWidth={2.4} strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
      {status === 'saving' ? 'Saving…' : 'Saved on this computer'}
    </span>
  );
}

export function UndoToast({ text, onUndo }: { text: string; onUndo?: () => void }) {
  return (
    <div role="status" style={{ padding: '10px 10px 10px 14px', borderRadius: 12, background: 'var(--ink)', color: '#fff', display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 6px 20px rgba(16,16,20,0.18)' }}>
      <span style={{ fontSize: 13, flexGrow: 1 }}>{text}</span>
      <button type="button" onClick={onUndo} style={{ height: 30, padding: '0 12px', border: 0, borderRadius: 8, background: 'rgba(255,255,255,0.12)', color: '#fff', font: '600 12px/1 var(--font)', cursor: 'pointer' }}>Undo</button>
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <h2 style={{ margin: 0, padding: '0 4px', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 500, color: 'var(--faint)' }}>{label}</h2>
      {children}
    </section>
  );
}

/** Dev gallery of the StatesEditor frame, with its sample content. */
export default function StatesEditor() {
  return (
    <div style={{ width: 400, padding: '20px 12px', display: 'flex', flexDirection: 'column', gap: 18, background: 'var(--ground)' }}>
      <Section label="editor-loading · Editor (whole tab)"><EditorLoading name="Sourdough promo" /></Section>
      <Section label="editor-first-run · Editor (first time only)"><FirstRun /></Section>
      <Section label="preview-light · Editor (under the clip)"><PreviewLight /></Section>
      <Section label="media-missing · Editor"><MediaMissing file="storefront.mp4" scene={2} /></Section>
      <Section label="save-status · Editor top bar">
        <div style={{ padding: '12px 14px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SaveStatusLine status="saved" /><SaveStatusLine status="saving" /><SaveStatusLine status="failed" />
        </div>
      </Section>
      <Section label="save-failed · Editor"><SaveFailed /></Section>
      <Section label="undo-toast · Editor (after a fix or hand edit)"><UndoToast text="Fixed 3 things" /></Section>
    </div>
  );
}
