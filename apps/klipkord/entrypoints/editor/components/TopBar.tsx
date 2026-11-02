import { SAVE_LABEL, type SaveStatus } from '../hooks/useProject';
import { C, Icon, iconButton, ICONS } from '../ui';

export interface TopBarProps {
  name: string;
  cutName: string;
  save: SaveStatus;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  onLibrary(): void;
  /** Later tasks wire these: ProjectSettings, Cuts, UndoHistory, Shortcuts, AskAI, ExportVideo. */
  onName?: () => void;
  onCuts?: () => void;
  onHistory?: () => void;
  onShortcuts?: () => void;
  onAskAI?: () => void;
  onExport?: () => void;
}

const DIVIDER = { width: 1, height: 20, background: C.line, flexShrink: 0 } as const;

export function TopBar(p: TopBarProps) {
  const undoTip = p.canUndo ? 'Undo (Ctrl+Z)' : 'Nothing to undo yet.';
  return (
    <header style={{ height: 48, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', borderBottom: `1px solid ${C.line}`, background: C.panel }}>
      <button type="button" onClick={p.onLibrary} style={{ ...iconButton(), width: 'auto', padding: '0 8px 0 4px', gap: 4, fontSize: 13, fontWeight: 500, fontFamily: 'inherit' }}>
        <Icon>{ICONS.back}</Icon><span>Library</span>
      </button>
      <span style={DIVIDER} />
      <button type="button" title="Rename and project settings" onClick={p.onName}
        style={{ border: 0, background: 'transparent', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, padding: '0 4px', color: C.text, cursor: 'pointer', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</button>
      <button type="button" aria-label="Switch cut" onClick={p.onCuts}
        style={{ height: 28, padding: '0 8px 0 10px', borderRadius: 7, background: C.raised, border: `1px solid ${C.line}`, color: C.text, display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
        <span>{p.cutName}</span><Icon size={14}>{ICONS.down}</Icon>
      </button>
      <span role="status" data-save={p.save} style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.muted, fontSize: 12, marginLeft: 4 }}>
        {p.save === 'saved' && <Icon size={14} color={C.ok}>{ICONS.check}</Icon>}
        <span style={p.save === 'not-saved' ? { color: C.accentText } : undefined}>{SAVE_LABEL[p.save]}</span>
      </span>
      <span style={{ flexGrow: 1 }} />
      <button type="button" aria-label="Undo (Ctrl+Z)" title={undoTip} disabled={!p.canUndo} onClick={p.onUndo}
        onContextMenu={(e) => { if (p.onHistory) { e.preventDefault(); p.onHistory(); } }}
        style={{ ...iconButton(), opacity: p.canUndo ? 1 : 0.4, cursor: p.canUndo ? 'pointer' : 'default' }}>
        <Icon>{ICONS.undo}</Icon>
      </button>
      <button type="button" aria-label="Redo (Ctrl+Shift+Z)" title="Redo (Ctrl+Shift+Z)" disabled={!p.canRedo} onClick={p.onRedo}
        style={{ ...iconButton(), opacity: p.canRedo ? 1 : 0.4, cursor: p.canRedo ? 'pointer' : 'default' }}>
        <Icon>{ICONS.redo}</Icon>
      </button>
      <button type="button" aria-label="Keyboard shortcuts" title="Keyboard shortcuts" onClick={p.onShortcuts} style={iconButton()}>
        <Icon>{ICONS.keys}</Icon>
      </button>
      <span style={{ ...DIVIDER, margin: '0 4px' }} />
      <button type="button" data-tour="ask-ai" onClick={p.onAskAI}
        style={{ height: 32, padding: '0 12px', borderRadius: 8, background: C.raised, border: `1px solid ${C.line}`, color: C.text, display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
        <Icon size={15}>{ICONS.ai}</Icon><span>Ask AI</span>
      </button>
      <button type="button" data-tour="export" onClick={p.onExport}
        style={{ height: 32, padding: '0 14px', borderRadius: 8, background: C.accent, color: '#FFFFFF', border: 0, display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
        <Icon size={15}>{ICONS.export}</Icon><span>Export</span>
      </button>
    </header>
  );
}
