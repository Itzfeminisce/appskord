import { useEffect } from 'react';
import { actionStyle } from './StatesSetup';

const secondary = { ...actionStyle, background: 'var(--surface)', color: 'var(--ink)', border: '1px solid #E0E0E4' } as const;
const heading = { margin: 0, padding: '0 4px', fontSize: 11, fontWeight: 500, color: 'var(--faint)' } as const;
const toastBox = { minHeight: 44, padding: '0 8px 0 14px', borderRadius: 12, background: 'var(--ink)', color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 } as const;

export const RENAME_HINT = 'Enter to save · Esc to cancel';

/** library-no-results */
export function LibraryNoResults({ query, onClear, onNew }: { query: string; onClear?: () => void; onNew?: () => void }) {
  return (
    <div style={{ padding: '22px 16px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textAlign: 'center' }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{`No clips match “${query}”`}</span>
      <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>Search looks at clip names and prompts. Try another word.</span>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button type="button" onClick={onClear} style={{ ...secondary, height: 34 }}>Clear search</button>
        <button type="button" onClick={onNew} style={{ ...actionStyle, height: 34, background: 'var(--accent)' }}>Make a new clip</button>
      </div>
    </div>
  );
}

/** rename-in-place: the field that replaces a card's name. */
export function RenameField({ value, onChange, onSave, onCancel }: { value: string; onChange?: (v: string) => void; onSave?: () => void; onCancel?: () => void }) {
  return (
    <>
      <input aria-label="Clip name" value={value} autoFocus onChange={(e) => onChange?.(e.target.value)} onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => { if (e.key === 'Enter') onSave?.(); else if (e.key === 'Escape') onCancel?.(); }}
        style={{ height: 32, padding: '0 8px', border: '2px solid var(--accent)', borderRadius: 8, font: '600 13px var(--font)', outline: 'none', width: '100%', color: 'var(--ink)', background: 'var(--surface)' }} />
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{RENAME_HINT}</span>
    </>
  );
}

/** delete-confirm */
export function DeleteConfirm({ name, onCancel, onDelete }: { name: string; onCancel?: () => void; onDelete?: () => void }) {
  return (
    <div role="alertdialog" aria-label="Delete clip" style={{ padding: 16, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: '0 12px 32px rgba(16,16,20,0.12)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 15, fontWeight: 600 }}>{`Delete “${name}”?`}</span>
      <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>This can't be undone. Videos you already exported stay in your folder.</span>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
        <button type="button" onClick={onCancel} style={{ ...secondary, height: 36, padding: '0 14px' }}>Cancel</button>
        <button type="button" onClick={onDelete} style={{ ...actionStyle, height: 36, padding: '0 14px', background: '#B91C1C' }}>Delete</button>
      </div>
    </div>
  );
}

/** clip-deleted */
export function ClipDeleted({ name }: { name: string }) {
  return <div role="status" style={{ ...toastBox, height: 44, padding: '0 14px' }}>{`“${name}” deleted`}</div>;
}

/** clip-duplicated */
export function ClipDuplicated({ name, onOpen }: { name: string; onOpen?: () => void }) {
  return (
    <div role="status" style={toastBox}>
      <span style={{ flexGrow: 1 }}>{`Made “${name}”`}</span>
      <button type="button" onClick={onOpen} style={{ height: 30, padding: '0 10px', border: 0, borderRadius: 8, background: 'transparent', color: '#F9A8D4', font: '600 13px var(--font)', cursor: 'pointer' }}>Open</button>
    </div>
  );
}

/** Closes the toast after a while. */
export function useAutoDismiss(active: boolean, close: () => void, ms = 5000) {
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(close, ms);
    return () => clearTimeout(t);
  }, [active, close, ms]);
}

const SHEET = [
  ['library-no-results · Your clips (search)', <LibraryNoResults key="a" query="croissant" />],
  ['rename-in-place · Your clips (card)', (
    <div key="b" style={{ padding: 10, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', gap: 12, alignItems: 'center' }}>
      <span style={{ width: 64, height: 64, borderRadius: 10, background: '#FDE68A', flexShrink: 0 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexGrow: 1, minWidth: 0 }}><RenameField value="Sourdough promo, autumn" /></div>
    </div>
  )],
  ['delete-confirm · Your clips (More → Delete)', <DeleteConfirm key="c" name="Sourdough promo" />],
  ['clip-deleted · Your clips (toast)', <ClipDeleted key="d" name="Sourdough promo" />],
  ['clip-duplicated · Your clips (toast)', <ClipDuplicated key="e" name="Sourdough promo copy" />],
] as const;

/** Every Your clips state on one sheet. */
export default function StatesLibrary() {
  return (
    <main data-frame="StatesLibrary" style={{ padding: '20px 12px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {SHEET.map(([label, card]) => (
        <section key={label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 className="mono" style={heading}>{label}</h2>
          {card}
        </section>
      ))}
    </main>
  );
}
