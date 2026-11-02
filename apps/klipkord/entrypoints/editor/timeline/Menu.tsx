import { useCallback, useRef, useState, type ReactNode } from 'react';
import { MAX_SPEED, MIN_SPEED } from '@/lib/project/ops';
import { clipLength } from '@/lib/project/time';
import type { Clip } from '@/lib/project/types';
import { clock } from '../format';
import { C, Icon, MONO } from '../ui';
import { MENU, type MenuAction } from './actions';
import { floating, Seg, Slider, Switch, TL_ICONS, useEscape, useOutside } from './controls';

const MENU_ICONS: Partial<Record<MenuAction, ReactNode>> = {
  split: TL_ICONS.split, speed: TL_ICONS.speed, duplicate: TL_ICONS.copy, detach: TL_ICONS.sound, newCut: TL_ICONS.screen, deleteClose: TL_ICONS.trash,
};
const DANGER = new Set<MenuAction>(['deleteClose', 'deleteGap']);
/** Items for a zoom, text or media block: the clip-only ones are left out. */
const LAYER_ITEMS = new Set<MenuAction>(['duplicate', 'deleteClose']);

/** TimelineMenu: right-click on a block. */
export function TimelineMenu({ x, y, clip, canPaste, canDetach, onPick, onClose }: {
  x: number; y: number; clip: boolean; canPaste: boolean; canDetach: boolean; onPick: (a: MenuAction) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(onClose);
  useOutside(useCallback(() => ref.current, []), onClose);
  const items = MENU.filter((m) => clip || LAYER_ITEMS.has(m.id));
  const height = items.length * 32 + 24;
  const top = Math.max(8, Math.min(y, window.innerHeight - height - 8));
  const left = Math.max(8, Math.min(x, window.innerWidth - 300));
  return (
    <div ref={ref} style={{ ...floating, position: 'fixed', left, top }}>
      <div role="menu" aria-label="Clip" style={{ padding: 6, width: 290 }}>
        {items.map((m) => {
          const disabled = (m.id === 'paste' && !canPaste) || (m.id === 'detach' && !canDetach);
          return (
            <div key={m.id}>
              {m.id === 'deleteClose' && clip && <span style={{ display: 'block', height: 1, background: C.line, margin: '4px 6px' }} />}
              <button type="button" role="menuitem" disabled={disabled} onClick={() => { onClose(); onPick(m.id); }}
                style={{ height: 32, padding: '0 10px', border: 0, borderRadius: 7, background: 'transparent', color: DANGER.has(m.id) ? '#FCA5A5' : C.text, fontFamily: 'inherit', fontSize: 13,
                  display: 'flex', alignItems: 'center', gap: 8, cursor: disabled ? 'default' : 'pointer', textAlign: 'left', width: '100%', opacity: disabled ? 0.45 : 1 }}>
                {MENU_ICONS[m.id] ? <Icon size={14}>{MENU_ICONS[m.id]}</Icon> : <span style={{ width: 14 }} />}
                <span>{m.label}</span>
                {'keys' in m && <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 11, color: C.muted }}>{m.keys}</span>}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const SPEEDS = [0.5, 1, 1.5, 2, 4] as const;

/** "New length of this part": the clips' output length at `speed`. */
export function lengthAt(clips: readonly Clip[], speed: number): number {
  return clips.reduce((sum, c) => sum + (c.gap ? clipLength(c) : (c.out - c.in) / speed), 0);
}

/** Speed popover: presets, slider, natural voice, silences only, new length. */
export function SpeedPopover({ clips, left, onSpeed, onClose }: {
  clips: readonly Clip[]; left: number;
  onSpeed: (args: { speed: number; naturalVoice?: boolean; silences?: boolean }) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(onClose);
  useOutside(useCallback(() => ref.current, []), onClose);
  const pictured = clips.filter((c) => !c.gap);
  const first = pictured[0];
  const current = first ? Math.max(...pictured.map((c) => c.speed)) : 1;
  const [draft, setDraft] = useState<number | null>(null);
  if (!first) return null;
  const speed = draft ?? current;
  const natural = pictured.every((c) => c.naturalVoice !== false);
  const silences = pictured.every((c) => !!c.silencesOnly);
  const was = lengthAt(pictured.map((c) => ({ ...c, speed: 1 })), 1);
  const now = silences ? pictured.reduce((s, c) => s + clipLength(c), 0) : lengthAt(pictured, speed);
  const apply = (v: number) => { setDraft(null); onSpeed({ speed: v, silences }); };
  const from = Math.min(...pictured.map((c) => c.in));
  const to = Math.max(...pictured.map((c) => c.out));
  return (
    <div ref={ref} role="dialog" aria-label="Speed" style={{ ...floating, position: 'absolute', left, bottom: 160, width: 280, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 600, flexGrow: 1 }}>Speed</span>
        <span style={{ fontFamily: MONO, fontSize: 12, color: C.secondary }}>{clock(from)} to {clock(to)}</span>
      </div>
      <Seg options={SPEEDS.map((s) => ({ value: String(s), label: `${s}x` }))} value={SPEEDS.includes(speed as never) ? String(speed) : undefined} onChange={(v) => apply(Number(v))} />
      <Slider min={MIN_SPEED} max={MAX_SPEED} step={0.1} value={speed} text={`${speed.toFixed(1)}x`} onInput={setDraft} onCommit={apply} />
      <Switch label="Keep the voice natural" sub="Pitch stays the same at any speed." on={natural} onChange={(on) => onSpeed({ speed: current, naturalVoice: on, silences })} />
      <Switch label="Speed up only the silences" sub="Talking stays at 1x. Gentler than cutting." on={silences} onChange={(on) => onSpeed({ speed: on && current === 1 ? 2 : current, silences: on })} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.secondary }}>
        <span>New length of this part</span>
        <span style={{ fontFamily: MONO, color: C.text }}>{clock(now)} (was {clock(was)})</span>
      </div>
    </div>
  );
}
