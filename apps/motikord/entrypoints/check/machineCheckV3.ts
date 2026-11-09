import type { Verdict } from '@appskord/motion/check';
import type { CheckId } from './v3';

// MachineCheckV3: the check page's plain-language summary. Copy verbatim from the frame; the rows come from the v3 run.

export const MACHINE = {
  title: 'Checking this computer',
  back: 'Back to Settings',
  ready: 'Ready to make clips',
  cores: (n: number) => `${n} cores`,
  memory: (gb: number) => `${gb} GB memory`,
  atFullSpeed: (n: number, of: number) => `${n} of ${of} at full speed.`,
  threeDLighter: '3D previews lighter.',
  results: 'Results',
  rows: {
    preview: { title: 'Smooth preview', line: '30 fps or more at light quality' },
    editor: { title: '3D and effects', line: 'Your computer previews 3D at lower quality. Export is always full quality.' },
    blocks: { title: 'Motion blur', line: 'Shown live in preview' },
    export60: { title: '60 fps export', line: 'Ready at 1080p' },
    export30: { title: 'Fast video export', line: 'Uses your graphics chip' },
  },
  statusReady: 'Ready',
  statusLighter: 'Lighter',
  line: 'Export renders every frame at full quality. A slower computer takes longer, never looks worse.',
  checked: (seconds: number) => `Checked today in ${seconds} s. Runs again after a Chrome update.`,
  again: 'Check again',
  done: 'Done',
} as const;

/** The five rows the frame shows, in its order, each from one v3 check row. */
export const MACHINE_ROWS = ['preview', 'editor', 'blocks', 'export60', 'export30'] as const;
export type MachineRowId = (typeof MACHINE_ROWS)[number];

export interface MachineRowView { id: MachineRowId; title: string; line: string; ready: boolean; status: string }
export interface MachineView {
  headline: string;
  spec: string;
  summary: string;
  rows: MachineRowView[];
  /** 60 fps export passed: Settings shows "This computer: 60 fps export". */
  fps60: boolean;
  footer: string;
}

/** Turns a finished run into the frame's copy. A row that did not pass reads "Lighter". */
export function machineView(verdicts: Partial<Record<CheckId, Verdict>>, machine: { cores?: number; memoryGb?: number | null }, seconds: number): MachineView {
  const rows = MACHINE_ROWS.map((id): MachineRowView => {
    const ready = verdicts[id] === 'Pass';
    return { id, title: MACHINE.rows[id].title, line: MACHINE.rows[id].line, ready, status: ready ? MACHINE.statusReady : MACHINE.statusLighter };
  });
  const full = rows.filter((r) => r.ready).length;
  const threeD = rows.find((r) => r.id === 'editor')!;
  return {
    headline: MACHINE.ready,
    spec: [machine.cores ? MACHINE.cores(machine.cores) : '', machine.memoryGb ? MACHINE.memory(machine.memoryGb) : ''].filter(Boolean).join(' · '),
    summary: [MACHINE.atFullSpeed(full, rows.length), threeD.ready ? '' : MACHINE.threeDLighter].filter(Boolean).join(' '),
    rows,
    fps60: rows.find((r) => r.id === 'export60')!.ready,
    footer: MACHINE.checked(seconds),
  };
}

/** Draws the summary into `root`; `onAgain` runs the check again, `onDone` closes the page. */
export function renderMachineCheck(root: HTMLElement, v: MachineView, on: { onAgain: () => void; onDone: () => void }): void {
  const el = (tag: string, text?: string, attrs: Record<string, string> = {}) => {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    for (const [k, val] of Object.entries(attrs)) e.setAttribute(k, val);
    return e;
  };
  const head = el('section', undefined, { 'aria-label': 'This computer' });
  head.append(el('h2', v.headline), el('p', v.spec), el('p', v.summary));
  const list = el('ul', undefined, { 'aria-label': MACHINE.results });
  for (const r of v.rows) {
    const li = el('li', undefined, { 'data-row': r.id, 'data-ready': String(r.ready) });
    // A Ready row keeps its frame line; the 3D row's line only reads true when it is lighter.
    const showLine = r.id !== 'editor' || !r.ready;
    li.append(el('strong', r.title), ...(showLine ? [el('span', r.line)] : []), el('b', r.status));
    list.append(li);
  }
  const again = el('button', MACHINE.again, { type: 'button' });
  const done = el('button', MACHINE.done, { type: 'button' });
  again.addEventListener('click', on.onAgain);
  done.addEventListener('click', on.onDone);
  root.replaceChildren(el('h1', MACHINE.title), head, list, el('p', MACHINE.line), el('p', v.footer), again, done);
}
