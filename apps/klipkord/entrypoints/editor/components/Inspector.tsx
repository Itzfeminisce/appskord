import { useState, type ReactNode } from 'react';
import { Bone, C, Icon, iconButton, ICONS } from '../ui';

export const INSPECTOR_TABS = ['Layout', 'Look', 'Captions', 'Audio'] as const;
export type InspectorTab = (typeof INSPECTOR_TABS)[number];

/** Something selected on the timeline or preview: its header replaces the tabs. */
export interface Selection {
  name: string;
  icon?: ReactNode;
  /** "2 of 6": this item's place among its kind. */
  index: number;
  count: number;
  /** Replaces "2 of 6" when the header says something else, e.g. "3 selected". */
  place?: string;
  onBack(): void;
  onDelete(): void;
  body: ReactNode;
}

export interface InspectorProps {
  /** Each tab's panel; T10 to T13 fill Layout, Look, Captions and Audio. A tab without one shows the skeleton. */
  panels?: Partial<Record<InspectorTab, ReactNode>>;
  selection?: Selection | null;
  tab?: InspectorTab;
  onTab?: (tab: InspectorTab) => void;
  /** Banners (not-saved, media-missing, old-recording, preview-slow) sit here so the preview keeps its full size. */
  notices?: ReactNode[];
  /** A tool panel over the whole inspector, e.g. Clean up. */
  cover?: ReactNode;
}

/** The empty look of a panel while it opens or until its task fills it. */
export function PanelSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Bone style={{ height: 14 }} /><Bone style={{ height: 96 }} /><Bone style={{ height: 14 }} /><Bone style={{ height: 40 }} /><Bone style={{ height: 40 }} />
    </div>
  );
}

const BODY = { flexGrow: 1, minHeight: 0, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 14 } as const;

export function Inspector({ panels = {}, selection, tab: controlled, onTab, notices = [], cover }: InspectorProps) {
  const [own, setOwn] = useState<InspectorTab>('Layout');
  const tab = controlled ?? own;
  const pick = (t: InspectorTab) => (onTab ? onTab(t) : setOwn(t));

  return (
    <aside aria-label="Inspector" style={{ position: 'relative', width: 304, flexShrink: 0, display: 'flex', flexDirection: 'column', borderLeft: `1px solid ${C.line}`, background: C.panel }}>
      {notices.length > 0 && (
        <div style={{ flexShrink: 0, maxHeight: '50%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 10px 2px' }}>{notices}</div>
      )}
      {selection ? (
        <>
          <div style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px 0 6px', borderBottom: `1px solid ${C.line}` }}>
            <button type="button" aria-label="Back to the inspector" title="Back to the inspector" onClick={selection.onBack} style={iconButton(28)}>
              <Icon>{ICONS.back}</Icon>
            </button>
            {selection.icon && <span style={{ color: C.accentText, display: 'flex' }}>{selection.icon}</span>}
            <span style={{ fontSize: 13, fontWeight: 600 }}>{selection.name}</span>
            <span style={{ fontSize: 12, color: C.muted, flexGrow: 1 }}>{selection.place ?? `${selection.index} of ${selection.count}`}</span>
            <button type="button" aria-label="Delete (Del)" title="Delete (Del)" onClick={selection.onDelete} style={iconButton(28)}>
              <Icon>{ICONS.trash}</Icon>
            </button>
          </div>
          <div style={BODY}>{selection.body}</div>
        </>
      ) : (
        <>
          <nav aria-label="Inspector" role="tablist" style={{ display: 'flex', gap: 2, padding: 3, margin: '7px 10px 0', borderRadius: 9, background: C.ground }}>
            {INSPECTOR_TABS.map((t) => (
              <button key={t} type="button" role="tab" aria-selected={t === tab} onClick={() => pick(t)}
                style={{ flex: 1, height: 30, border: 0, borderRadius: 7, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', background: t === tab ? C.tabOn : 'transparent', color: t === tab ? C.text : C.secondary }}>{t}</button>
            ))}
          </nav>
          <div role="tabpanel" aria-label={tab} style={BODY}>{panels[tab] ?? <PanelSkeleton />}</div>
        </>
      )}
      {cover}
    </aside>
  );
}
