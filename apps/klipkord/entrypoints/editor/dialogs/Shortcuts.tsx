import { Modal } from '../timeline/controls';
import { C, MONO } from '../ui';

/** The Shortcuts frame, column by column. */
export const SHORTCUTS: { group: string; rows: { label: string; keys: string[] }[] }[] = [
  { group: 'Play', rows: [
    { label: 'Play or pause', keys: ['Space'] },
    { label: 'Back a sentence', keys: ['J'] },
    { label: 'Forward a sentence', keys: ['L'] },
    { label: 'One frame', keys: ['←', '→'] },
    { label: 'Full screen preview', keys: ['F'] },
  ] },
  { group: 'Edit', rows: [
    { label: 'Delete selection', keys: ['Del'] },
    { label: 'Split at playhead', keys: ['S'] },
    { label: 'Speed', keys: ['R'] },
    { label: 'Chapter here', keys: ['M'] },
    { label: 'Undo', keys: ['Ctrl', 'Z'] },
    { label: 'Redo', keys: ['Ctrl', 'Shift', 'Z'] },
  ] },
  { group: 'Add', rows: [
    { label: 'Zoom', keys: ['Z'] },
    { label: 'Text or card', keys: ['T'] },
    { label: 'Voiceover', keys: ['V'] },
    { label: 'Media', keys: ['A'] },
    { label: 'Snapping on or off', keys: ['N'] },
    { label: 'Ask AI', keys: ['Ctrl', 'K'] },
  ] },
];

const KEY = { fontFamily: MONO, fontSize: 11, color: C.secondary, padding: '1px 5px', border: `1px solid ${C.line}`, borderRadius: 4, background: C.ground } as const;

/** Keyboard shortcuts ("?" opens it). */
export function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <Modal label="Keyboard shortcuts" width={720} onClose={onClose}
      footer={<span style={{ fontSize: 12, color: C.muted, flexGrow: 1 }}>Press ? any time to see these.</span>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
        {SHORTCUTS.map((g) => (
          <div key={g.group}>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 6 }}>{g.group}</span>
            {g.rows.map((r) => (
              <div key={r.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '5px 0', fontSize: 12.5 }}>
                <span style={{ color: C.secondary }}>{r.label}</span>
                <span style={{ display: 'flex', gap: 4 }}>{r.keys.map((k) => <span key={k} style={KEY}>{k}</span>)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}
