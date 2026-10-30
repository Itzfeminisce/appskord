import { addLayer, findLayer, newShape, newText, sceneIndex } from '../../lib/editor/store';
import type { EditorScreen } from '../../entrypoints/editor/router';
import { useEditor } from './Editor';

const heading = { fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)', padding: '10px 6px 0' } as const;
const tile = { height: 34, border: '1px solid var(--line)', borderRadius: 9, background: 'var(--surface)', font: '12px/1 var(--font)', color: 'var(--ink)', cursor: 'pointer' } as const;

const LINKS: [string, EditorScreen][] = [['Your media', 'YourMedia'], ['Free media', 'MediaSearch'], ['Music', 'Music'], ['Credits', 'Credits']];

export function AddToScene() {
  const { state, brand, edit, select, go } = useEditor();
  const r = state.clip.recipe;
  const scene = r.scenes[sceneIndex(r, state.sceneId)];
  const add = (kind: 'text' | 'shape') => {
    if (!scene) return;
    const layer = kind === 'text' ? newText(scene, crypto.randomUUID(), brand) : newShape(scene, crypto.randomUUID(), brand);
    edit(addLayer(r, scene.id, layer), { select: { sceneId: scene.id, layerId: layer.id }, toast: true });
  };
  return (
    <>
      <span style={heading}>Add to this scene</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
        <button type="button" style={tile} disabled={!scene} onClick={() => add('text')}>Text</button>
        <button type="button" style={tile} disabled={!scene} onClick={() => add('shape')}>Shape</button>
        {/* T10 sends "Free media" to AccessPrompt the first time a library is searched. */}
        {LINKS.map(([label, screen]) => (
          <button key={screen} type="button" style={tile} onClick={() => go(screen, { sceneId: state.sceneId, layerId: findLayer(r, state.sceneId, state.layerId)?.layer.id })}>{label}</button>
        ))}
      </div>
    </>
  );
}
