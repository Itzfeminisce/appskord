import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { applyCleanup, findAll, listed, type CleanupSettings, type Find } from '@/lib/project/cleanup';
import { currentCut } from '@/lib/project/history';
import { cutLength, toRec } from '@/lib/project/time';
import { secs } from '@/lib/project/suggest';
import type { SlotProps } from '../components/slots';
import { clock } from '../format';
import { StateCard } from '../states/StateCard';
import { C, Icon, iconButton, MONO } from '../ui';
import { ICON } from './icons';
import { outAt } from './model';
import { setUi, toggleOff, useUi } from './store';

const KIND_NAME: Record<Find['kind'], string> = { filler: 'Filler', pause: 'Pause', retake: 'Retake' };
/** Preview starts this long before the first find. */
const LEAD_MS = 2000;

function Switch({ on, title, sub, onChange }: { on: boolean; title: string; sub: string; onChange(on: boolean): void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
      <span style={{ flexGrow: 1, fontSize: 13 }}>{title}<span style={{ display: 'block', fontSize: 11.5, color: C.muted, marginTop: 2, lineHeight: 1.4 }}>{sub}</span></span>
      <input type="checkbox" role="switch" checked={on} onChange={(e) => onChange(e.target.checked)} aria-label={title}
        style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />
      <span aria-hidden="true" style={{ width: 34, height: 20, borderRadius: 10, flexShrink: 0, position: 'relative', background: on ? C.accent : C.line }}>
        <span style={{ position: 'absolute', top: 2, ...(on ? { right: 2 } : { left: 2 }), width: 16, height: 16, borderRadius: '50%', background: '#FFFFFF' }} />
      </span>
    </label>
  );
}

function Segmented<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange(v: T): void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 12, color: C.secondary, flexGrow: 1 }}>{label}</span>
      <div role="radiogroup" aria-label={label} style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 8, background: C.ground, border: `1px solid ${C.line}` }}>
        {options.map(([v, text]) => (
          <button key={String(v)} type="button" role="radio" aria-checked={v === value} onClick={() => onChange(v)} style={{
            flex: 1, height: 22, padding: '0 8px', border: 0, borderRadius: 6, whiteSpace: 'nowrap', fontFamily: 'inherit', fontSize: 12, fontWeight: 500, cursor: 'pointer',
            background: v === value ? C.tabOn : 'transparent', color: v === value ? C.text : C.secondary,
          }}>{text}</button>
        ))}
      </div>
    </div>
  );
}

const BUTTON: CSSProperties = {
  height: 34, padding: '0 12px', borderRadius: 8, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center',
  gap: 6, cursor: 'pointer', whiteSpace: 'nowrap', boxSizing: 'border-box', flex: 1, justifyContent: 'center',
};

function Check({ on }: { on: boolean }): ReactNode {
  return (
    <span aria-hidden="true" style={{
      width: 16, height: 16, borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
      background: on ? C.accent : 'transparent', border: `1.5px solid ${on ? C.accent : C.muted}`,
    }}>{on && <Icon size={12} color="#FFFFFF">{ICON.check}</Icon>}</span>
  );
}

/** CleanUp: fillers, long pauses and retakes, ticked off and cut in one step. Covers the inspector while open. */
export function CleanUpPanel({ recording, project, cut, out, playing, seek, play, edit, readOnly }: SlotProps) {
  const ui = useUi();
  const { settings } = ui;
  const open = ui.cleanup;
  const finds = useMemo(() => (open ? findAll(recording.transcript, cut, settings) : { fillers: [], pauses: [], retakes: [] }), [open, recording.transcript, cut, settings]);
  const list = useMemo(() => listed(finds, settings), [finds, settings]);
  const chosen = useMemo(() => list.filter((f) => !ui.off.has(f.id)), [list, ui.off]);
  const before = cutLength(cut);
  const after = useMemo(() => (open ? cutLength(currentCut(applyCleanup(project, chosen, settings.pauseAction))) : 0), [open, project, chosen, settings.pauseAction]);

  // "Preview": playback skips every ticked find until it stops.
  const started = useRef(false);
  useEffect(() => {
    if (!ui.previewing) return;
    if (!playing) {
      if (started.current) { started.current = false; setUi({ previewing: false }); }
      return;
    }
    started.current = true;
    const rec = toRec(cut, out);
    if (rec === null) return;
    const inside = chosen.find((f) => rec >= f.start && rec < f.end);
    if (inside) seek(outAt(cut, inside.end));
  }, [ui.previewing, playing, out, cut, chosen, seek]);

  if (!open) return null;

  const set = (patch: Partial<CleanupSettings>) => setUi((s) => ({ settings: { ...s.settings, ...patch } }));
  const close = () => setUi({ cleanup: false, previewing: false, off: new Set() });
  const preview = () => {
    const first = chosen[0];
    if (!first) return;
    seek(Math.max(0, outAt(cut, first.start) - LEAD_MS));
    setUi({ previewing: true });
    play();
  };
  const apply = () => {
    edit((p) => applyCleanup(p, chosen, settings.pauseAction));
    close();
  };
  const saved = before - after;

  return (
    <div role="region" aria-label="Clean up" style={{ position: 'absolute', inset: 0, zIndex: 5, display: 'flex', flexDirection: 'column', background: C.panel }}>
      <div style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px 0 6px', borderBottom: `1px solid ${C.line}` }}>
        <button type="button" aria-label="Back" title="Back" onClick={close} style={iconButton(28)}><Icon>{ICON.back}</Icon></button>
        <span style={{ fontSize: 13, fontWeight: 600, flexGrow: 1 }}>Clean up</span>
        <span style={{ fontSize: 12, color: C.muted }}>{`${list.length} found`}</span>
      </div>
      <div style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Switch on={settings.fillers} title="Filler words" sub={`Um, uh, so, like, you know · ${finds.fillers.length} found`} onChange={(fillers) => set({ fillers })} />
          <Switch on={settings.pauses} title="Long pauses" sub={`${finds.pauses.length} found`} onChange={(pauses) => set({ pauses })} />
          <Segmented label="Pauses longer than" value={settings.minPause} options={[[1, '1 s'], [2, '2 s'], [3, '3 s']]} onChange={(minPause) => set({ minPause })} />
          <Segmented label="Do this to pauses" value={settings.pauseAction} options={[['cut', 'Cut'], ['speed', 'Speed up']]} onChange={(pauseAction) => set({ pauseAction })} />
          <Switch on={settings.retakes} title="Retakes" sub={`A sentence said twice. Keeps the last · ${finds.retakes.length} found`} onChange={(retakes) => set({ retakes })} />
        </div>
        {list.length === 0 ? (
          <StateCard state="nothing-to-clean" role="status" title="Nothing to clean up" body="No fillers, long pauses or retakes found with these settings."
            actions={settings.minPause > 1 ? [{ label: 'Shorter pauses', tone: 'secondary', onClick: () => set({ minPause: 1, pauses: true }) }] : []} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {list.map((f) => {
              const on = !ui.off.has(f.id);
              return (
                <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 4px', borderBottom: `1px solid ${C.line}`, cursor: 'pointer' }}>
                  <input type="checkbox" checked={on} onChange={() => toggleOff(f.id)} aria-label={`${KIND_NAME[f.kind]} at ${clock(outAt(cut, f.start))}`}
                    style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />
                  <Check on={on} />
                  <span style={{ fontFamily: MONO, fontSize: 11, color: C.muted, width: 30 }}>{clock(outAt(cut, f.start))}</span>
                  <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span style={{ fontSize: 12.5 }}>{f.kind === 'pause' ? `${f.text} of silence` : `“${f.text}”`}</span>
                    <span style={{ fontSize: 11, color: C.muted }}>{KIND_NAME[f.kind]}</span>
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: C.secondary }}>{`−${secs(f.saves)}`}</span>
                </label>
              );
            })}
          </div>
        )}
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: C.secondary }}>Time saved</span>
            <span style={{ fontFamily: MONO }}>{`−${secs(saved)} · ${clock(before)} → ${clock(after)}`}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" disabled={!chosen.length} onClick={preview} style={{ ...BUTTON, background: C.raised, color: C.text, border: `1px solid ${C.line}` }}>
              <Icon size={14}>{ICON.play}</Icon><span>Preview</span>
            </button>
            <button type="button" disabled={!chosen.length || readOnly} onClick={apply} style={{ ...BUTTON, background: C.accent, color: '#FFFFFF', border: 0 }}>
              <span>{`Cut ${chosen.length}`}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
