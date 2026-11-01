import { actionButton, C, Icon, ICONS } from '../ui';

/** Hints that sit inside an empty timeline track; T7 places them. */
function TrackHint({ state, title, body, action, onAction }: { state: string; title: string; body?: string; action: string; onAction: () => void }) {
  return (
    <div data-state={state} style={{ height: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px', fontSize: 11.5, color: C.muted, minWidth: 0 }}>
      <span style={{ fontWeight: 600, color: C.secondary, whiteSpace: 'nowrap' }}>{title}</span>
      {body && <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{body}</span>}
      <button type="button" onClick={onAction} style={{ ...actionButton('secondary'), height: 20, padding: '0 8px', fontSize: 11.5, flexShrink: 0 }}>
        <Icon size={12}>{ICONS.plus}</Icon><span>{action}</span>
      </button>
    </div>
  );
}

/** no-clicks: the Zoom track of a window or screen recording, which has no clicks. */
export function NoClicks({ onAddZoom }: { onAddZoom: () => void }) {
  return (
    <TrackHint state="no-clicks" title="No clicks recorded"
      body="Window and screen recordings don't record clicks, so there are no auto zooms. Press Z to add one by hand."
      action="Add a zoom" onAction={onAddZoom} />
  );
}

/** empty-track: the frame gives the Music copy; Voiceover and Text pass their own once drawn. */
export const MUSIC_HINT = { hint: 'Drop music here', action: 'Add music' } as const;

export function EmptyTrack({ hint = MUSIC_HINT.hint, action = MUSIC_HINT.action, onAdd }: { hint?: string; action?: string; onAdd: () => void }) {
  return <TrackHint state="empty-track" title={hint} action={action} onAction={onAdd} />;
}
