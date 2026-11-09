import { createContext, useContext, useMemo, useReducer, useState, type ReactNode } from 'react';
import type { LayerV3, LookGuide, SceneV3 } from '@appskord/motion/types';
import { getPackV3, packLook, type PackV3 } from '../../lib/look/packs';
import type { RestyledClip } from '../../lib/restyle/restyle';
import { initV3, layerName, layerText, redoV3, undoV3, type Tab, type V3State } from './model';

export type Overlay = 'effects' | 'add' | 'animate' | 'voice' | { transition: number } | { animated: { title: string; line: string } } | undefined;

export interface EditorV3Api {
  state: V3State;
  scene: SceneV3;
  layer: LayerV3 | undefined;
  pack: PackV3;
  look: LookGuide;
  /** Applies a state change: an edit (through validateScene) or a selection. */
  update: (fn: (st: V3State) => V3State) => void;
  undo: () => void;
  redo: () => void;
  select: (scene: number, layerId?: string) => void;
  setTab: (tab: Tab) => void;
  /** ms into the selected scene. */
  t: number;
  setT: (ms: number) => void;
  playing: boolean;
  setPlaying: (on: boolean) => void;
  overlay: Overlay;
  setOverlay: (o: Overlay) => void;
  /** "Show depth" on the stage. */
  spread: boolean;
  setSpread: (on: boolean) => void;
  name: (layer: LayerV3, scene?: number) => string;
  text: (layer: LayerV3, scene?: number) => string | undefined;
  /** "Groq": who Animate this layer sends the layer's settings to. */
  provider: string;
}

const Ctx = createContext<EditorV3Api | null>(null);

export function useEditorV3(): EditorV3Api {
  const api = useContext(Ctx);
  if (!api) throw new Error('useEditorV3 must be used inside EditorV3Provider');
  return api;
}

export function EditorV3Provider({ clip, look, provider = 'Groq', initial, children }: { clip: RestyledClip; look?: LookGuide; provider?: string; initial?: Partial<V3State>; children: ReactNode }) {
  const [state, update] = useReducer((st: V3State, fn: (st: V3State) => V3State) => fn(st), clip, (c) => ({ ...initV3(c), ...initial }));
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>();
  const [spread, setSpread] = useState(false);
  const api = useMemo<EditorV3Api>(() => {
    const scene = state.clip.v3.scenes[state.scene]!;
    const pack = getPackV3(state.clip.v3.packId);
    return {
      state,
      scene,
      layer: scene.layers.find((l) => l.id === state.layerId),
      pack,
      look: look ?? packLook(pack),
      update,
      undo: () => update(undoV3),
      redo: () => update(redoV3),
      select: (i, layerId) => {
        update((st) => ({ ...st, scene: i, layerId: layerId ?? st.clip.v3.scenes[i]?.layers[0]?.id }));
        if (i !== state.scene) setT(0);
      },
      setTab: (tab) => update((st) => ({ ...st, tab })),
      t,
      setT,
      playing,
      setPlaying,
      overlay,
      setOverlay,
      spread,
      setSpread,
      name: (l, i = state.scene) => layerName(state.clip, i, l),
      text: (l, i = state.scene) => layerText(state.clip, i, l),
      provider,
    };
  }, [state, look, t, playing, overlay, spread, provider]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
