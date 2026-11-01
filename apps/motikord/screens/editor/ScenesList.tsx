import { addScene, clockShort, restTime, roomForScene, sceneStart, sceneTitle } from '../../lib/editor/store';
import { useEditor } from './Editor';

const heading = { fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)', padding: '0 6px' } as const;

export function ScenesList() {
  const { state, edit, select } = useEditor();
  const r = state.clip.recipe;
  const add = () => {
    const id = crypto.randomUUID();
    const e = addScene(r, state.sceneId, id);
    if (!e) return;
    const at = r.scenes.findIndex((s) => s.id === state.sceneId) + 1;
    edit(e, { select: { sceneId: id }, toast: true });
    select(id, undefined, sceneStart(r, at));
  };
  return (
    <>
      <span style={heading}>Scenes</span>
      {r.scenes.map((s, i) => {
        const on = s.id === state.sceneId;
        const start = sceneStart(r, i);
        const title = sceneTitle(s);
        return (
          <button
            key={s.id} type="button" aria-current={on || undefined}
            onClick={() => select(s.id, s.layers.find((l) => l.type === 'text' && l.role === 'title')?.id, restTime(r, i))}
            style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 6, borderRadius: 10, border: 0, textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'var(--ink)', background: on ? 'var(--tint)' : 'transparent', outline: on ? '1.5px solid var(--accent)' : 'none' }}
          >
            <span style={{ width: r.aspect === '16:9' ? 38 : r.aspect === '1:1' ? 30 : 22, height: r.aspect === '16:9' ? 22 : r.aspect === '1:1' ? 30 : 38, flexShrink: 0, borderRadius: 4, background: s.background, border: '1px solid var(--line)' }} />
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title ? `${i + 1} · ${title}` : `${i + 1}`}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>{`${clockShort(start)}–${clockShort(start + s.durationMs)}`}</span>
            </span>
          </button>
        );
      })}
      <button
        type="button" onClick={add} disabled={!roomForScene(r)}
        style={{ height: 32, flexShrink: 0, border: '1px dashed var(--line-strong)', borderRadius: 9, background: 'transparent', font: '12px/1 var(--font)', color: 'var(--muted)', cursor: roomForScene(r) ? 'pointer' : 'not-allowed', opacity: roomForScene(r) ? 1 : 0.5 }}
      >Add scene</button>
    </>
  );
}
