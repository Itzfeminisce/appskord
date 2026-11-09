import { useEffect, useState, type ClipboardEvent, type DragEvent } from 'react';
import { CHART_DEFAULTS, CHART_SHAPES, chartOptionsOf, parseNumber, parseStagger, parseTable, withChart, type ChartOptions, type Row } from '@appskord/motion/charts';
import { layerStarts } from '@appskord/motion/choreo';
import { validateScene } from '@appskord/motion/recipe';
import type { LayerV3 } from '@appskord/motion/types';
import type { RestyledClip } from '../../lib/restyle/restyle';
import type { PatchOp } from '../../lib/types';
import { useEditorV3 } from './context';
import { applyOps, sceneTitle, type EditMeta, type V3State } from './model';
import { C, PanelHead, Section, Segmented, SwitchRow, quietButton } from './ui';

// Data tab: the chart's table (typed, pasted from a spreadsheet or dropped as a CSV/TSV file), how it shows, and
// cloned cards. The rows live where the v2 recipe keeps chart values; the v3 layers are redrawn from them.

const MAX_FILE_BYTES = 1024 * 1024;

/** A scene's chart: its layer, its rows, and where the v2 recipe keeps them. */
export interface ChartData {
  base: LayerV3;
  rows: Row[];
  /** The v2 scene's chart slot, when the rows are slot values. */
  slot?: string;
  /** The v2 chart layers drawing the same rows. */
  v2: number[];
}

const isRows = (v: unknown): v is Row[] =>
  Array.isArray(v) && v.every((r) => typeof r === 'object' && r !== null && 'label' in r && 'value' in r);

export function chartData(clip: RestyledClip, i: number): ChartData | undefined {
  const scene = clip.v3.scenes[i];
  const v2 = clip.recipe.scenes[i];
  for (const base of scene?.layers ?? []) {
    if (base.kind !== 'chart' || base.id.includes('~')) continue;
    const value = base.slotId ? v2?.slots?.[base.slotId] : undefined;
    const layers = (v2?.layers ?? []).flatMap((l, k) => (l.type === 'chart' && (l.id === base.id || (!!base.slotId && l.slot === base.slotId)) ? [k] : []));
    if (isRows(value)) return { base, rows: value.map((r) => ({ label: r.label, value: r.value })), slot: base.slotId, v2: layers };
    const first = layers.length ? v2!.layers[layers[0]!] : undefined;
    if (first?.type === 'chart') return { base, rows: first.values.map((r) => ({ ...r })), v2: layers };
  }
  return undefined;
}

const pointer = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1');

/** Writes the rows and options: the v2 values and the v3 chart layers in one change. */
export function setChart(st: V3State, rows: readonly Row[], o: ChartOptions, meta: EditMeta): V3State {
  const i = st.scene;
  const data = chartData(st.clip, i);
  const scene = st.clip.v3.scenes[i];
  if (!data || !scene) return st;
  const start = layerStarts(scene.layers)[scene.layers.indexOf(data.base)] ?? 0;
  const next = { ...structuredClone(scene), layers: withChart(scene.layers, data.base.id, rows, o, start, scene.ms) };
  const checked = validateScene(next);
  if (!checked.ok) return { ...st, errors: checked.errors };
  const values = rows.map((r) => ({ label: r.label, value: r.value }));
  const same = JSON.stringify(scene) === JSON.stringify(next) && JSON.stringify(data.rows) === JSON.stringify(values);
  if (same) return st;
  const ops: PatchOp[] = [{ op: 'replace', path: `/v3/scenes/${i}`, value: next }];
  if (data.slot) ops.push({ op: 'replace', path: `/recipe/scenes/${i}/slots/${pointer(data.slot)}`, value: values });
  for (const k of data.v2) ops.push({ op: 'replace', path: `/recipe/scenes/${i}/layers/${k}/values`, value: values });
  return applyOps(st, ops, meta);
}

export function DataTab() {
  const ed = useEditorV3();
  const { state, scene } = ed;
  const data = chartData(state.clip, state.scene);
  if (!data) return null;
  const { rows } = data;
  const o = chartOptionsOf(data.base.id, scene.layers) ?? CHART_DEFAULTS;
  const set = (next: readonly Row[], opts: ChartOptions, summary: string, mergeKey?: string) =>
    ed.update((st) => setChart(st, next, opts, { summary: `Chart: ${summary}`, mergeKey }));
  const setRow = (i: number, row: Row, mergeKey: string) => set(rows.map((r, k) => (k === i ? row : r)), o, `row ${i + 1}`, mergeKey);
  const take = (text: string) => {
    const table = parseTable(text);
    if (table.rows.length) set(table.rows, o, 'pasted rows');
    return table.rows.length > 0;
  };
  const onPaste = (e: ClipboardEvent) => {
    const text = e.clipboardData.getData('text/plain');
    // A single cell pastes into its input as usual.
    if (!/[\t\n]/.test(text.trim())) return;
    if (take(text)) e.preventDefault();
  };
  const paste = () => {
    navigator.clipboard.readText().then(take, (error: unknown) => console.error('Motikord: could not read the clipboard', error));
  };
  const onDrop = (e: DragEvent) => {
    const file = e.dataTransfer.files[0];
    if (!file) return;
    e.preventDefault();
    // Blocked: no frame copy for "table too big", so an oversized file is refused with a console error only.
    if (file.size > MAX_FILE_BYTES) return console.error('Motikord: the table file is over 1 MB');
    file.text().then(take, (error: unknown) => console.error('Motikord: could not read the table file', error));
  };
  const title = sceneTitle(state.clip, state.scene);
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <PanelHead icon="▮" name="Chart" line={title ? `“${title}”` : ''} />
      <Section title="Data" aside={`${state.clip.recipe.name} · ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`}>
        <div role="table" aria-label="Chart data" onPaste={onPaste} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}
          style={{ border: '1px solid #E0E0E4', borderRadius: 8, overflow: 'hidden' }}>
          <div role="row" style={{ display: 'grid', gridTemplateColumns: '1fr 96px 28px', height: 24, alignItems: 'center', background: '#FAFAFB', borderBottom: `1px solid ${C.line}`, fontSize: 10, color: C.muted }}>
            <span role="columnheader" style={{ padding: '0 8px' }}>Label</span>
            <span role="columnheader" style={{ padding: '0 8px' }}>Value</span>
            <span />
          </div>
          {rows.map((r, i) => (
            <div key={i} role="row" style={{ display: 'grid', gridTemplateColumns: '1fr 96px 28px', height: 30, alignItems: 'center', borderBottom: `1px solid ${C.line}` }}>
              <span role="cell"><Cell name={`Row ${i + 1} label`} value={r.label} parse={(t) => t} live onCommit={(label) => setRow(i, { ...r, label }, `data:${i}:label`)} /></span>
              <span role="cell"><Cell name={`Row ${i + 1} value`} value={String(r.value)} parse={parseNumber} onCommit={(value) => setRow(i, { ...r, value }, `data:${i}:value`)} /></span>
              <button type="button" aria-label={`Remove row ${i + 1}`} disabled={rows.length < 2} onClick={() => set(rows.filter((_, k) => k !== i), o, `removed row ${i + 1}`)}
                style={{ width: 28, height: 28, border: 0, background: 'transparent', color: C.muted, cursor: 'pointer' }}>×</button>
            </div>
          ))}
          <button type="button" onClick={() => set([...rows, { label: '', value: 0 }], o, 'added a row')}
            style={{ height: 28, width: '100%', border: 0, background: C.surface, font: `400 12px/1 ${C.font}`, color: C.muted, textAlign: 'left', padding: '0 8px', cursor: 'pointer' }}>Add row</button>
        </div>
        <button type="button" onClick={paste} style={{ ...quietButton, alignSelf: 'flex-start', border: 0, color: C.accent }}>Paste from a spreadsheet</button>
      </Section>
      <Section title="Show as">
        <Segmented name="Show as" options={CHART_SHAPES} value={o.show} onChange={(show) => set(rows, { ...o, show }, `show as ${CHART_SHAPES.find(([id]) => id === show)![1]}`)} />
        <SwitchRow title="Clone each row" line="Each row becomes its own animated card" on={o.clone} onChange={(clone) => set(rows, { ...o, clone }, 'clone each row')} />
        <SwitchRow title="Count up" on={o.countUp} onChange={(countUp) => set(rows, { ...o, countUp }, 'count up')} />
        <label style={{ height: 40, boxSizing: 'border-box', border: '1px solid #E0E0E4', borderRadius: 8, padding: '0 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Stagger</span>
          <Cell name="Stagger" value={`${o.staggerMs} ms`} parse={parseStagger} onCommit={(staggerMs) => set(rows, { ...o, staggerMs }, 'stagger', 'data:stagger')} align="right" />
        </label>
      </Section>
    </div>
  );
}

/** A table cell: a label commits as it is typed, a number on Enter or blur; an invalid number snaps back. */
function Cell<T>({ name, value, parse, onCommit, live, align = 'left' }: { name: string; value: string; parse: (text: string) => T | undefined; onCommit: (v: T) => void; live?: boolean; align?: 'left' | 'right' }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = (t: string) => {
    const v = parse(t);
    if (v !== undefined) onCommit(v);
    else setText(value);
  };
  return (
    <input aria-label={name} value={text}
      onChange={(e) => {
        setText(e.currentTarget.value);
        if (live) commit(e.currentTarget.value);
      }}
      onBlur={() => { if (!live && text !== value) commit(text); }}
      onKeyDown={(e) => { if (e.key === 'Enter' && !live) commit(text); }}
      style={{ width: '100%', height: 28, boxSizing: 'border-box', border: 0, padding: '0 8px', background: 'transparent', font: `400 12px/1 ${C.font}`, color: C.ink, textAlign: align }} />
  );
}
