import { useState, type CSSProperties, type ReactNode } from 'react';
import { actionStyle } from './StatesSetup';

// StatesSources frame: every state of Media sources, Add a source and the sources in Free media.

export const FORMATS_URL = 'https://github.com/Itzfeminisce/motikord-clip-generation-chrome-extension#media-sources';
const ghost: CSSProperties = { ...actionStyle, background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line-strong)' };
const icon = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, style: { flexShrink: 0 } };
const TONES = {
  plain: { bg: 'var(--surface)', line: 'var(--line)' }, warn: { bg: 'var(--warning-bg)', line: 'var(--warning-line)' },
  error: { bg: 'var(--error-bg)', line: 'var(--error-line)' }, ok: { bg: 'var(--success-bg)', line: 'var(--success-line)' },
};
const warnGlyph = <svg {...icon} stroke="var(--warning-ink)"><path d="M12 3.5l9.5 16.5h-19z" /><path d="M12 10v4.5M12 17.5v.01" /></svg>;
const infoGlyph = <svg {...icon} stroke="var(--muted)"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" /></svg>;
const keyGlyph = <svg {...icon} stroke="var(--accent)"><circle cx="8" cy="14" r="4" /><path d="M11 11l9-9M17 5l2 2M15 7l2 2" /></svg>;
const okGlyph = <svg {...icon} stroke="var(--success-ink)" strokeWidth={2.4}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
const badGlyph = <svg {...icon} stroke="var(--error-ink)"><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></svg>;

export function StateCard({ tone = 'plain', glyph, title, children, actions, role, frame }: { tone?: keyof typeof TONES; glyph: ReactNode; title: string; children?: ReactNode; actions?: ReactNode; role?: 'status' | 'alert'; frame?: string }) {
  const t = TONES[tone];
  return (
    <div role={role} data-state={frame} style={{ padding: 14, borderRadius: 14, background: t.bg, border: `1px solid ${t.line}`, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      {glyph}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexGrow: 1, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
        {children && <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>{children}</span>}
        {actions && <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>{actions}</div>}
      </div>
    </div>
  );
}
const btn = (text: string, onClick?: () => void, style: CSSProperties = actionStyle) => <button key={text} type="button" onClick={onClick} style={style}>{text}</button>;

export function SourceDown({ source, status, onRetry }: { source: string; status?: number; onRetry?: () => void }) {
  return (
    <StateCard frame="source-down" role="status" tone="warn" glyph={warnGlyph} title={`${source} isn’t answering`} actions={btn('Try again', onRetry)}>
      {`It sent back an error (${status ?? 503}), so its results are left out for now. The other sources still show. Motikord tries it again on your next search.`}
    </StateCard>
  );
}

export function SourceBusy({ source }: { source: string }) {
  return (
    <StateCard frame="source-busy" role="status" tone="warn" glyph={warnGlyph} title={`${source} is busy`}>
      {`You’ve reached ${source}’s limit for the moment. Its results come back in about a minute.`}
    </StateCard>
  );
}

export function SourceKeyRejected({ source, getUrl, onPaste }: { source: string; getUrl?: string; onPaste?: () => void }) {
  return (
    <StateCard frame="source-key-rejected" role="alert" tone="error" glyph={badGlyph} title={`${source} didn’t accept this key`}
      actions={[btn('Paste a key', onPaste), <a key="get" href={getUrl} target="_blank" rel="noreferrer" style={ghost}>{`Get a free ${source} key`}</a>]}>
      {`Check you copied all of it, or get a new one. Searches skip ${source} until a key works.`}
    </StateCard>
  );
}

export function SourceNeedsKey({ source, onAddKey }: { source: string; onAddKey?: () => void }) {
  return (
    <StateCard frame="source-needs-key" glyph={keyGlyph} title={`${source} needs a key`} actions={btn('Add key', onAddKey)}>
      It’s free. Add one and its results join your searches.
    </StateCard>
  );
}

export function SourceTesting() {
  return (
    <StateCard frame="source-testing" role="status" glyph={<span aria-hidden="true" style={{ width: 20, height: 20, flexShrink: 0, borderRadius: '50%', border: '2px solid var(--line-strong)', borderTopColor: 'var(--accent)', animation: 'spin 0.9s linear infinite' }} />} title="Testing your link…">
      Searching “bread” the way Free media will.
    </StateCard>
  );
}

const KIND_WORD = { image: 'photos', video: 'videos', audio: 'tracks' } as const;

/** custom-ok; the AddSource frame shows up to four results and, when licences are missing, its own second line. */
export function CustomOk({ n, kind, format, licenceKnown = true, thumbs = [] }: { n: number; kind: keyof typeof KIND_WORD; format: string; licenceKnown?: boolean; thumbs?: string[] }) {
  return (
    <div role="status" data-state="custom-ok" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 12, background: 'var(--success-bg)', border: '1px solid var(--success-line)' }}>
      <span style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 600 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success-ink)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        {`Found ${n} ${KIND_WORD[kind]}`}
      </span>
      {thumbs.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {thumbs.slice(0, 4).map((t, i) => <span key={i} style={{ height: 56, borderRadius: 8, background: t ? `var(--stage) url("${t}") center / cover` : 'var(--stage)' }} />)}
        </div>
      )}
      <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--muted)' }}>
        {licenceKnown ? `Read as ${format}. You can add it now.` : `Read as ${format}. Licences aren’t listed, so each item is marked “Licence unknown”.`}
      </span>
    </div>
  );
}

export function CustomUnreadable({ onRetry }: { onRetry?: () => void }) {
  return (
    <StateCard frame="custom-unreadable" role="alert" tone="error" glyph={badGlyph} title="Motikord can’t read this link’s results"
      actions={[btn('Try again', onRetry), <a key="see" href={FORMATS_URL} target="_blank" rel="noreferrer" style={ghost}>See what works</a>]}>
      It answered, but not in a way Motikord knows. Links that work: Openverse, WordPress media (wp-json/wp/v2/media), Wikimedia, Pexels and Pixabay style APIs, and any link that returns a list of items with an image, video or audio address.
    </StateCard>
  );
}

export function CustomNeedsKey({ status, onAddKey }: { status: number; onAddKey?: () => void }) {
  return (
    <StateCard frame="custom-needs-key" role="alert" tone="warn" glyph={keyGlyph} title="This link needs a key" actions={btn('Add a key', onAddKey)}>
      {`It answered “not allowed” (${status}). Paste the key it gave you and choose how to send it.`}
    </StateCard>
  );
}

export function CustomNotALink() {
  return (
    <StateCard frame="custom-not-a-link" role="alert" tone="error" glyph={badGlyph} title="That isn’t a web link">Paste a link that starts with https://.</StateCard>
  );
}

export function CustomNoResults({ onTryAnother, onAddAnyway }: { onTryAnother?: () => void; onAddAnyway?: () => void }) {
  return (
    <StateCard frame="custom-no-results" role="status" glyph={infoGlyph} title="The link works, but found nothing for “bread”"
      actions={[btn('Try another word', onTryAnother), btn('Add it anyway', onAddAnyway, ghost)]}>
      Try another word, or add it anyway if it suits your clips.
    </StateCard>
  );
}

export function CustomLicenceUnknown({ source }: { source: string }) {
  return (
    <StateCard frame="custom-licence-unknown" tone="warn" glyph={warnGlyph} title="Check you may use it">
      {`${source} doesn’t say how this can be used. Motikord adds it as “From ${source}” in credits.txt.`}
    </StateCard>
  );
}

export function SourceAccess({ host, onAllow }: { host: string; onAllow?: () => void }) {
  return (
    <StateCard frame="source-access" role="status" glyph={infoGlyph} title={`Allow Motikord to reach ${host}`} actions={btn('Allow', onAllow)}>
      {`Chrome asks once. Only your search words are sent to ${host}.`}
    </StateCard>
  );
}

export function SourceRemoved({ source, onUndo }: { source: string; onUndo?: () => void }) {
  return (
    <StateCard frame="source-removed" role="status" glyph={infoGlyph} title={`${source} removed`} actions={btn('Undo', onUndo)}>
      Media you already added from it stays in your clips.
    </StateCard>
  );
}

const lbl: CSSProperties = { fontSize: 12, fontWeight: 600 };
export const inputStyle: CSSProperties = { height: 38, border: '1px solid var(--line-strong)', borderRadius: 10, padding: '0 12px', font: '12px var(--mono)', color: 'var(--ink)', background: 'var(--surface)', outline: 'none', boxSizing: 'border-box', width: '100%' };

/** source-add-key: the sheet after "Add key". `ready` is the detection line under the field. */
export function SourceAddKey({ source, getUrl, ready, busy, onSave, onPenv }: { source: string; getUrl?: string; ready?: (value: string) => boolean; busy?: boolean; onSave?: (key: string) => void; onPenv?: () => void }) {
  const [value, setValue] = useState('');
  const ok = !!value.trim() && (ready ? ready(value.trim()) : true);
  return (
    <div data-state="source-add-key" style={{ padding: 14, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{`Add your ${source} key`}</span>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={lbl}>{`${source} key`}</span>
        <input type="password" autoComplete="off" spellCheck={false} value={value} onChange={(e) => setValue(e.target.value)} placeholder={`Paste your ${source} key`} aria-label={`${source} key`} style={inputStyle} />
      </label>
      {ok && <span role="status" style={{ fontSize: 12, color: 'var(--success-ink)' }}>{`This is a ${source} key · Ready`}</span>}
      <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--muted)' }}>Kept like your other keys, until Chrome closes.</span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" disabled={!value.trim() || busy} onClick={() => onSave?.(value.trim())} style={{ ...actionStyle, opacity: !value.trim() || busy ? 0.5 : 1 }}>Save key</button>
        <button type="button" onClick={onPenv} style={ghost}>Use Penv Cloud</button>
      </div>
      <a href={getUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 500 }}>{`Get a free ${source} key`}</a>
    </div>
  );
}

/** A source row's status where the switch would be: "On" with a key, "Not answering" after a failed search. */
export function RowStatus({ state }: { state: 'on' | 'down' }) {
  return (
    <span data-state={state === 'down' ? 'source-row-status' : undefined} style={{ fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, color: state === 'on' ? 'var(--success-ink)' : 'var(--warning-ink)' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />{state === 'on' ? 'On' : 'Not answering'}
    </span>
  );
}

/** Every state on one page, for review. */
export default function StatesSources() {
  return (
    <main data-frame="StatesSources" style={{ maxWidth: 400, width: '100%', margin: '0 auto', padding: '20px 12px', display: 'flex', flexDirection: 'column', gap: 14, boxSizing: 'border-box' }}>
      <SourceDown source="Openverse" status={503} />
      <SourceBusy source="Pixabay" />
      <SourceKeyRejected source="Unsplash" getUrl="https://unsplash.com/developers" />
      <SourceNeedsKey source="Pixabay" />
      <SourceTesting />
      <CustomOk n={24} kind="image" format="a WordPress media library" />
      <CustomUnreadable />
      <CustomNeedsKey status={401} />
      <CustomNotALink />
      <CustomNoResults />
      <CustomLicenceUnknown source="Bakery photo library" />
      <SourceAccess host="photos.mybakery.com" />
      <SourceRemoved source="Bakery photo library" />
      <SourceAddKey source="Pixabay" getUrl="https://pixabay.com/api/docs/" />
      <div style={{ padding: '12px 14px', borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600, flexGrow: 1 }}>Openverse</span><RowStatus state="down" />
      </div>
    </main>
  );
}
