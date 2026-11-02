import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useDeps } from '../deps';
import { StateCard } from '../states/StateCard';
import { C, Icon, ICONS, iconButton } from '../ui';
import { aiDeps } from './deps';

export const PANEL: CSSProperties = { position: 'absolute', inset: 0, background: C.panel, display: 'flex', flexDirection: 'column', zIndex: 3 };
export const BODY: CSSProperties = { flexGrow: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 14 };
export const BUTTON = (primary: boolean): CSSProperties => ({
  height: 34, padding: '0 12px', borderRadius: 8, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center',
  justifyContent: 'center', gap: 6, cursor: 'pointer', whiteSpace: 'nowrap', boxSizing: 'border-box', flex: 1,
  ...(primary ? { background: C.accent, color: '#FFFFFF', border: 0 } : { background: C.raised, color: C.text, border: `1px solid ${C.line}` }),
});
export const BUBBLE: CSSProperties = { alignSelf: 'flex-end', maxWidth: 240, padding: '8px 12px', borderRadius: '12px 12px 4px 12px', background: C.tabOn, fontSize: 13, lineHeight: 1.45 };
export const MIC = <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><path d="M12 17v5" /></>;

/** The panel's 44 px header: Back, the AI mark, the title and the provider. */
export function Header({ title, provider, onBack, mark = true }: { title: string; provider: string; onBack: () => void; mark?: boolean }) {
  return (
    <div style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px 0 6px', borderBottom: `1px solid ${C.line}` }}>
      <button type="button" aria-label="Back" title="Back" onClick={onBack} style={iconButton(28)}><Icon>{ICONS.back}</Icon></button>
      {mark && <span style={{ color: C.accentText, display: 'flex' }}><Icon size={15}>{ICONS.ai}</Icon></span>}
      <span style={{ fontSize: 13, fontWeight: 600, flexGrow: 1 }}>{title}</span>
      {provider && <span style={{ fontSize: 11.5, color: C.muted }}>{provider}</span>}
    </div>
  );
}

/** True while the computer is online. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => aiDeps().online());
  useEffect(() => aiDeps().watchOnline(() => setOnline(aiDeps().online())), []);
  return online;
}

/** StatesWork `offline`. */
export const Offline = () => (
  <StateCard state="offline" role="status" compact title="You're offline" body="AI edits, translation and share links need the internet. Editing and exporting work as normal." />
);

/** StatesWork `ai-not-set-up`: keys come from Penv Cloud, or a pasted key, in the side panel. */
export function NotSetUp() {
  const deps = useDeps();
  return (
    <StateCard state="ai-not-set-up" tight title="Turn on AI edits" body="Ask the AI to cut, reorder, zoom and caption for you. Every other tool works without it."
      actions={[{ label: 'Connect Penv Cloud', tone: 'accent', onClick: () => deps.openPanel('PenvConnect') }, { label: 'Paste a key', tone: 'secondary', onClick: () => deps.openPanel('PasteKey') }]} />
  );
}

/** A checkbox in the frames' look; the real input stays for keyboards and screen readers. */
export function Check({ on, label, onChange, children }: { on: boolean; label: string; onChange: () => void; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 2px', borderBottom: `1px solid ${C.line}`, cursor: 'pointer', position: 'relative' }}>
      <input type="checkbox" aria-label={label} checked={on} onChange={onChange} style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />
      <span aria-hidden="true" style={{
        width: 16, height: 16, borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
        background: on ? C.accent : 'transparent', border: `1.5px solid ${on ? C.accent : C.muted}`,
      }}>{on && <Icon size={11} color="#FFFFFF">{ICONS.check}</Icon>}</span>
      {children}
    </label>
  );
}
