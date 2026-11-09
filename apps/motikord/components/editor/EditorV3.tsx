import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { EffectId } from '@appskord/motion/effects';
import type { LookGuide } from '@appskord/motion/types';
import { createAutosave, type SaveStatus } from '../../lib/editor/autosave';
import { ASPECTS } from '../../lib/recipe/validate';
import { PromptField } from '../../screens/editor/EditorPrompt';
import type { RestyledClip } from '../../lib/restyle/restyle';
import type { Author } from '../../lib/types';
import { AnimateDialog, AnimatedToast, type Animate } from './AnimateDialog';
import { AssetPicker, type BundledAsset } from './AssetPicker';
import { CaptionsVoice, type CaptionsVoiceProps } from './CaptionsVoice';
import { useClipVoice, type VoiceMedia } from './clipVoice';
import { ChangesTab } from './ChangesTab';
import { chartData, DataTab } from './DataScenes';
import { EditorV3Provider, useEditorV3 } from './context';
import { EffectsDialog } from './EffectsDialog';
import { LayerTab, type Bakers } from './LayerTab';
import { clipMs, clock, sceneStarts, sceneTitle, TABS, templateName, type Tab, type V3State } from './model';
import { MotionTab } from './MotionTab';
import { applyPromptV3, setSizeV3 } from './prompt';
import { SceneTab } from './SceneTab';
import { Stage } from './Stage';
import { Timeline } from './Timeline';
import { TransitionDialog } from './TransitionDialog';
import { C } from './ui';

// The v3 editor tab at 1366 × 768: shared chrome (Add, Effects, Look, Brand, Check, Export), scenes, stage,
// the 320 px right panel (Scene, Layer, Motion, Changes) and the timeline. Every edit goes through the recipe check.

export type ChromeGo = 'library' | 'look' | 'brand' | 'check' | 'export' | 'sizes';

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
  /** Where the clip's voice audio is kept and picked (tests pass a fake). */
  voiceMedia?: VoiceMedia;
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
  const clipVoice = useClipVoice(p.voiceMedia);
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
        <Stage preview={preview && overlay === 'effects' ? { effect: preview } : undefined} prompt={<Prompt />} />
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
            {overlay === 'voice' && <CaptionsVoice {...clipVoice} {...p.voice} />}
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
  height: 36, padding: '0 10px', border: `1px solid ${on ? C.accent : '#E0E0E4'}`, borderRadius: 9, background: on ? C.tint : C.surface, color: on ? C.accentHover : C.ink,
  font: `500 13px/1 ${C.font}`, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' as const, flexShrink: 0, boxSizing: 'border-box' as const,
});
const iconButton = { width: 36, height: 36, flexShrink: 0, border: 0, borderRadius: 9, background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0 } as const;
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

function TopBar({ status, go, checkCount }: { status: SaveStatus; go?: (to: ChromeGo) => void; checkCount?: number }) {
  const ed = useEditorV3();
  const { state, overlay, pack } = ed;
  const toggle = (o: 'add' | 'effects') => ed.setOverlay(overlay === o ? undefined : o);
  return (
    <header style={{ height: 52, flexShrink: 0, background: C.surface, borderBottom: '1px solid #E8E8EB', display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', boxSizing: 'border-box' }}>
      <button type="button" aria-label="Your clips" onClick={() => go?.('library')} style={{ width: 36, height: 36, flexShrink: 0, border: 0, borderRadius: 9, background: '#111114', display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0 }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M3 8.5h5M2 12h6M3 15.5h5" /><circle cx="15.5" cy="12" r="4.5" fill="#BE185D" stroke="none" /></svg>
      </button>
      <input aria-label="Clip name" value={state.clip.recipe.name} readOnly style={{ width: 152, height: 34, flexShrink: 0, border: '1px solid transparent', borderRadius: 8, padding: '0 8px', boxSizing: 'border-box', textOverflow: 'ellipsis', font: `600 15px/1 ${C.font}`, color: C.ink, background: 'transparent' }} />
      {status === 'saved' && <span style={{ fontSize: 12, color: '#6E7079', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', flexShrink: 0 }}><svg width="13" height="13" viewBox="0 0 24 24" {...stroke} stroke="#15803D" strokeWidth="2.4"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>Saved on this computer</span>}
      <span style={{ width: 1, height: 24, background: '#E8E8EB', flexShrink: 0 }} />
      <button type="button" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!state.clip.history.length} onClick={ed.undo} style={{ ...iconButton, color: state.clip.history.length ? C.ink : '#A1A1AA' }}><svg width="18" height="18" viewBox="0 0 24 24" {...stroke}><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg></button>
      <button type="button" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!state.future.length} onClick={ed.redo} style={{ ...iconButton, color: state.future.length ? C.ink : '#A1A1AA' }}><svg width="18" height="18" viewBox="0 0 24 24" {...stroke}><path d="M15 14l5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg></button>
      <span style={{ flex: 1 }} />
      <div role="radiogroup" aria-label="Size" style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 9, background: '#F1F1F3', flexShrink: 0 }}>
        {ASPECTS.map((a) => {
          const on = state.clip.recipe.aspect === a;
          return (
            <button key={a} type="button" role="radio" aria-checked={on} onClick={() => ed.update((st) => setSizeV3(st, a))}
              style={{ height: 30, padding: '0 9px', border: 0, borderRadius: 6, background: on ? C.surface : 'transparent', boxShadow: on ? '0 1px 2px rgba(16,16,20,0.08)' : 'none', font: `${on ? 500 : 400} 12px/1 ${C.mono}`, color: on ? C.ink : '#5F6168', cursor: 'pointer' }}>{a}</button>
          );
        })}
      </div>
      <button type="button" aria-pressed={overlay === 'add'} onClick={() => toggle('add')} style={barButton(overlay === 'add')}><svg width="15" height="15" viewBox="0 0 24 24" {...stroke} strokeWidth="2.2"><path d="M12 5v14M5 12h14" /></svg>Add</button>
      <button type="button" aria-pressed={overlay === 'effects'} onClick={() => toggle('effects')} style={barButton(overlay === 'effects')}><svg width="15" height="15" viewBox="0 0 24 24" {...stroke}><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /><circle cx="12" cy="12" r="3" /></svg>Effects</button>
      <button type="button" title="Look guide" onClick={() => go?.('look')} style={{ ...barButton(), padding: '0 10px 0 8px', gap: 7 }}>
        <span aria-hidden="true" style={{ width: 20, height: 20, borderRadius: 5, background: ed.look.palette[0] ?? pack.colours[0], display: 'grid', placeItems: 'center' }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: ed.look.palette[1] ?? pack.colours[1] }} /></span>
        <span style={{ color: C.muted, fontWeight: 400 }}>Look</span><span style={{ fontWeight: 600 }}>{ed.look.name || pack.name}</span>
      </button>
      <button type="button" onClick={() => go?.('brand')} style={barButton()}><span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: '50%', background: '#4F5BD5' }} />Brand</button>
      <button type="button" title="Voice and captions" aria-pressed={overlay === 'voice'} onClick={() => ed.setOverlay(overlay === 'voice' ? undefined : 'voice')} style={barButton(overlay === 'voice')}><svg width="15" height="15" viewBox="0 0 24 24" {...stroke}><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M7 11h3M13 11h4M7 15h6M15 15h2" /></svg>Voice</button>
      <button type="button" onClick={() => go?.('check')} style={barButton()}>
        Check
        {!!checkCount && <span style={{ minWidth: 18, height: 18, padding: '0 5px', boxSizing: 'border-box', borderRadius: 9, background: '#FEF3C7', color: '#92400E', fontSize: 11, fontWeight: 600, display: 'grid', placeItems: 'center' }}>{checkCount}</span>}
      </button>
      <button type="button" onClick={() => go?.('export')} style={{ ...barButton(), padding: '0 16px', border: 0, background: '#BE185D', color: '#FFFFFF', fontWeight: 600 }}><svg width="15" height="15" viewBox="0 0 24 24" {...stroke} strokeWidth="2.2"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>Export</button>
    </header>
  );
}

function Prompt() {
  const ed = useEditorV3();
  return (
    <PromptField recipe={ed.state.clip.recipe} speak={false} maxWidth={560}
      apply={(out) => {
        let base: V3State | undefined;
        const next = ed.update((st) => (base = st, applyPromptV3(st, out)));
        return next !== base;
      }} />
  );
}

function ScenesList() {
  const ed = useEditorV3();
  const { state } = ed;
  const v3 = state.clip.v3;
  const starts = sceneStarts(v3);
  const rows: ReactNode[] = v3.scenes.map((s, i) => (
    <button key={s.id} type="button" aria-current={i === state.scene} onClick={() => ed.select(i)}
      style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 6px', border: 0, borderRadius: 10, background: i === state.scene ? C.tint : 'transparent', outline: i === state.scene ? `1.5px solid ${C.accent}` : 'none', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: C.ink }}>
      <span aria-hidden="true" style={{ position: 'relative', width: 44, height: 25, flexShrink: 0, borderRadius: 4, background: ed.look.palette[0] ?? '#0B0B10', boxShadow: 'inset 0 0 0 1px rgba(16,16,20,0.08)', overflow: 'hidden' }}>
        <span style={{ position: 'absolute', left: 5, top: 9, width: 18, height: 3, borderRadius: 1, background: ed.look.palette[2] ?? '#F5F5F7' }} />
        <span style={{ position: 'absolute', left: 5, top: 14, width: 12, height: 3, borderRadius: 1, background: ed.look.palette[1] ?? '#8B9CFF' }} />
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{`${i + 1} · ${sceneTitle(state.clip, i)}`}</span>
        <span style={{ fontFamily: C.mono, fontSize: 11, color: C.muted }}>{`${clock(starts[i]!)}–${clock(starts[i]! + s.ms)}`}</span>
        <span style={{ fontSize: 11, color: i === state.scene ? C.accentHover : C.muted }}>{templateName(s)}</span>
      </span>
    </button>
  ));
  return (
    <aside style={{ width: 220, flexShrink: 0, background: C.surface, borderRight: '1px solid #E8E8EB', display: 'flex', flexDirection: 'column', padding: '12px 10px', gap: 2, boxSizing: 'border-box', overflow: 'auto' }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', padding: '0 6px 6px', fontFamily: C.mono, fontSize: 11, color: '#6E7079' }}>
        <span>Scenes</span>
        <span>{`${v3.scenes.length} · ${Math.round(clipMs(v3) / 1000)} s`}</span>
      </span>
      {rows}
    </aside>
  );
}
