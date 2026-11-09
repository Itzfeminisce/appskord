import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { EffectId } from '@appskord/motion/effects';
import type { LookGuide } from '@appskord/motion/types';
import { createAutosave, type SaveStatus } from '../../lib/editor/autosave';
import type { RestyledClip } from '../../lib/restyle/restyle';
import type { Author } from '../../lib/types';
import { AnimateDialog, AnimatedToast, type Animate } from './AnimateDialog';
import { AssetPicker, type BundledAsset } from './AssetPicker';
import { CaptionsVoice, type CaptionsVoiceProps } from './CaptionsVoice';
import { ChangesTab } from './ChangesTab';
import { chartData, DataTab } from './DataScenes';
import { EditorV3Provider, useEditorV3 } from './context';
import { EffectsDialog } from './EffectsDialog';
import { LayerTab, type Bakers } from './LayerTab';
import { clipMs, clock, sceneStarts, sceneTitle, TABS, templateName, type Tab } from './model';
import { MotionTab } from './MotionTab';
import { SceneTab } from './SceneTab';
import { Stage } from './Stage';
import { Timeline } from './Timeline';
import { TransitionDialog } from './TransitionDialog';
import { C } from './ui';

// The v3 editor tab at 1366 × 768: shared chrome (Add, Effects, Look, Brand, Check, Export), scenes, stage,
// the 320 px right panel (Scene, Layer, Motion, Changes) and the timeline. Every edit goes through the recipe check.

export type ChromeGo = 'library' | 'look' | 'brand' | 'check' | 'export';

export interface EditorV3Props {
  clip: RestyledClip;
  look?: LookGuide;
  provider?: string;
  /** Writes the clip; called after edits settle. */
  save?: (clip: RestyledClip) => Promise<void>;
  go?: (to: ChromeGo) => void;
  onOpenV2?: (clip: RestyledClip) => void;
  /** Open on a frame's state (tests, dev). */
  initial?: Parameters<typeof EditorV3Provider>[0]['initial'];
  animate?: Animate;
  /** Who Animate this layer's change is from in Changes. */
  by?: Author;
  bakers?: Bakers;
  catalog?: readonly BundledAsset[];
  /** Quality-check notes waiting, for the Check badge. */
  checkCount?: number;
  /** The Voice and captions panel (opens with the `voice` overlay). */
  voice?: CaptionsVoiceProps;
}

export function EditorV3(p: EditorV3Props) {
  return (
    <EditorV3Provider clip={p.clip} look={p.look} provider={p.provider} initial={p.initial}>
      <Shell {...p} />
    </EditorV3Provider>
  );
}

function Shell(p: EditorV3Props) {
  const ed = useEditorV3();
  const { state, overlay } = ed;
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [preview, setPreview] = useState<EffectId>();
  const saver = useRef<ReturnType<typeof createAutosave> | undefined>(undefined);
  useEffect(() => {
    if (!p.save) return;
    const save = p.save;
    const a = createAutosave({ write: (c) => save(c as RestyledClip), onStatus: (s, error) => { setStatus(s); if (error) console.error('Motikord: could not save the clip', error); } });
    saver.current = a;
    const hide = () => { if (document.visibilityState === 'hidden') void a.flush(); };
    const leave = () => void a.flush();
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', leave);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', leave);
      a.dispose();
      void a.flush();
    };
  }, [p.save]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    saver.current?.schedule(state.clip);
  }, [state.clip]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && TEXT_INPUTS.has((t as HTMLInputElement).type)))) return;
      e.preventDefault();
      if (e.shiftKey) ed.redo();
      else ed.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ed]);

  // A scene with a chart gets the Data tab, between Motion and Changes.
  const hasData = !!chartData(state.clip, state.scene);
  const tabs: readonly (readonly [Tab, string])[] = hasData ? [...TABS.slice(0, 3), ['data', 'Data'], ...TABS.slice(3)] : TABS;
  const tab = state.tab === 'data' && !hasData ? 'motion' : state.tab;
  return (
    <div style={{ position: 'relative', width: '100%', minWidth: 1024, height: '100vh', minHeight: 640, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', background: '#F6F6F7', color: C.ink, fontFamily: C.font, overflow: 'hidden' }}>
      <TopBar status={status} go={p.go} checkCount={p.checkCount} />
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <ScenesList />
        {overlay === 'add' && <AssetPicker catalog={p.catalog} />}
        <Stage preview={preview && overlay === 'effects' ? { effect: preview } : undefined} />
        <aside style={{ width: 320, flexShrink: 0, background: C.surface, borderLeft: '1px solid #E8E8EB', display: 'flex', flexDirection: 'column', padding: '12px 16px', gap: 6, boxSizing: 'border-box', overflow: 'auto' }}>
          <div role="tablist" aria-label="Edit" style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 9, background: C.stage, flexShrink: 0 }}>
            {tabs.map(([id, name]) => (
              <button key={id} type="button" role="tab" aria-selected={id === tab} onClick={() => { ed.setOverlay(undefined); ed.setTab(id); }}
                style={{ flex: 1, height: 28, border: 0, borderRadius: 6, background: id === tab ? C.surface : 'transparent', boxShadow: id === tab ? '0 1px 2px rgba(16,16,20,0.08)' : 'none', font: `${id === tab ? 600 : 400} 12px/1 ${C.font}`, color: id === tab ? C.ink : C.muted, cursor: 'pointer' }}>
                {name}
              </button>
            ))}
          </div>
          {state.errors && (
            <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--error-ink, #B91C1C)' }}>{state.errors[0]}</p>
          )}
          <div role="tabpanel" style={{ minHeight: 0 }}>
            {overlay === 'voice' && <CaptionsVoice {...p.voice} />}
            {overlay !== 'voice' && tab === 'scene' && <SceneTab />}
            {overlay !== 'voice' && tab === 'layer' && <LayerTab bakers={p.bakers} />}
            {overlay !== 'voice' && tab === 'motion' && <MotionTab />}
            {overlay !== 'voice' && tab === 'data' && <DataTab />}
            {overlay !== 'voice' && tab === 'changes' && <ChangesTab onOpenV2={p.onOpenV2 ? () => p.onOpenV2!(state.clip) : undefined} />}
          </div>
        </aside>
      </div>
      <Timeline />
      {overlay === 'effects' && <EffectsDialog onPreview={setPreview} />}
      {overlay === 'animate' && <AnimateDialog animate={p.animate} by={p.by} />}
      {typeof overlay === 'object' && 'transition' in overlay && <TransitionDialog from={overlay.transition} />}
      {typeof overlay === 'object' && 'animated' in overlay && <AnimatedToast {...overlay.animated} />}
    </div>
  );
}

// Inputs whose own undo should win over the editor's.
const TEXT_INPUTS = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number']);

const barButton = (on = false) => ({
  height: 34, padding: '0 10px', border: 0, borderRadius: 9, background: on ? C.tint : 'transparent', color: on ? C.accent : C.ink,
  font: `500 13px/1 ${C.font}`, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' as const,
});

function TopBar({ status, go, checkCount }: { status: SaveStatus; go?: (to: ChromeGo) => void; checkCount?: number }) {
  const ed = useEditorV3();
  const { state, overlay, pack } = ed;
  const toggle = (o: 'add' | 'effects') => ed.setOverlay(overlay === o ? undefined : o);
  return (
    <header style={{ height: 52, flexShrink: 0, background: C.surface, borderBottom: '1px solid #E8E8EB', display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', boxSizing: 'border-box' }}>
      <button type="button" aria-label="Your clips" onClick={() => go?.('library')} style={{ width: 36, height: 36, flexShrink: 0, border: 0, borderRadius: 9, background: '#111114', cursor: 'pointer' }} />
      <input aria-label="Clip name" value={state.clip.recipe.name} readOnly style={{ width: 152, height: 34, flexShrink: 0, border: '1px solid transparent', borderRadius: 8, padding: '0 8px', font: `600 15px/1 ${C.font}`, color: C.ink, background: 'transparent' }} />
      {status === 'saved' && <span style={{ fontSize: 12, color: C.muted, whiteSpace: 'nowrap' }}>Saved on this computer</span>}
      <span style={{ width: 1, height: 24, background: '#E8E8EB', flexShrink: 0 }} />
      <button type="button" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!state.clip.history.length} onClick={ed.undo} style={{ ...barButton(), padding: '0 9px' }}>↶</button>
      <button type="button" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!state.future.length} onClick={ed.redo} style={{ ...barButton(), padding: '0 9px' }}>↷</button>
      <span style={{ flex: 1 }} />
      <button type="button" aria-pressed={overlay === 'add'} onClick={() => toggle('add')} style={barButton(overlay === 'add')}>Add</button>
      <button type="button" aria-pressed={overlay === 'effects'} onClick={() => toggle('effects')} style={barButton(overlay === 'effects')}>Effects</button>
      <button type="button" title="Look guide" onClick={() => go?.('look')} style={barButton()}>
        Look <span style={{ fontSize: 11, color: C.muted }}>{ed.look.name || pack.name}</span>
      </button>
      <button type="button" onClick={() => go?.('brand')} style={barButton()}>Brand</button>
      <button type="button" title="Voice and captions" aria-pressed={overlay === 'voice'} onClick={() => ed.setOverlay(overlay === 'voice' ? undefined : 'voice')} style={barButton(overlay === 'voice')}>Voice</button>
      <button type="button" onClick={() => go?.('check')} style={barButton()}>
        Check
        {!!checkCount && <span style={{ minWidth: 16, height: 16, borderRadius: 8, background: C.accent, color: '#FFFFFF', fontSize: 10, display: 'grid', placeItems: 'center' }}>{checkCount}</span>}
      </button>
      <button type="button" onClick={() => go?.('export')} style={{ ...barButton(), background: '#BE185D', color: '#FFFFFF', fontWeight: 600 }}>Export</button>
    </header>
  );
}

function ScenesList() {
  const ed = useEditorV3();
  const { state } = ed;
  const v3 = state.clip.v3;
  const starts = sceneStarts(v3);
  const rows: ReactNode[] = v3.scenes.map((s, i) => (
    <button key={s.id} type="button" aria-current={i === state.scene} onClick={() => ed.select(i)}
      style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 8px', border: 0, borderRadius: 8, background: i === state.scene ? C.tint : 'transparent', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: C.ink }}>
      <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{`${i + 1} · ${sceneTitle(state.clip, i)}`}</span>
      <span style={{ fontSize: 11, color: C.muted }}>{`${clock(starts[i]!)}–${clock(starts[i]! + s.ms)}`}</span>
      <span style={{ fontSize: 11, color: C.muted }}>{templateName(s)}</span>
    </button>
  ));
  return (
    <aside style={{ width: 220, flexShrink: 0, background: C.surface, borderRight: '1px solid #E8E8EB', display: 'flex', flexDirection: 'column', padding: '12px 10px', gap: 2, boxSizing: 'border-box', overflow: 'auto' }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', padding: '0 8px 6px', fontSize: 12 }}>
        <span style={{ fontWeight: 600 }}>Scenes</span>
        <span style={{ color: C.muted }}>{`${v3.scenes.length} · ${Math.round(clipMs(v3) / 1000)} s`}</span>
      </span>
      {rows}
    </aside>
  );
}
