import { useEditor, type EditorTab } from './Editor';

// EditorScene, right panel: "Scene" / "Layer" / "Changes". Scene shows for v2 clips with a template scene.

const TABS: [EditorTab, string][] = [['scene', 'Scene'], ['layer', 'Layer'], ['changes', 'Changes']];

export function PanelTabs({ on }: { on: EditorTab }) {
  const { state, setTab } = useEditor();
  const scenes = state.clip.recipe.scenes.some((s) => s.template);
  return (
    <div role="tablist" style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 9, background: 'var(--stage)' }}>
      {TABS.filter(([id]) => id !== 'scene' || scenes).map(([id, name]) => (
        <button key={id} type="button" role="tab" aria-selected={id === on} onClick={() => setTab(id)}
          style={{ flex: 1, height: 28, border: 0, borderRadius: 6, background: id === on ? 'var(--surface)' : 'transparent', boxShadow: id === on ? '0 1px 2px rgba(16,16,20,0.08)' : 'none', font: `${id === on ? 600 : 400} 12px/1 var(--font)`, color: id === on ? 'var(--ink)' : 'var(--muted)', cursor: 'pointer' }}>
          {name}
        </button>
      ))}
    </div>
  );
}
