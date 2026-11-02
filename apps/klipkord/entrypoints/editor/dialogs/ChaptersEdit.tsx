import { useMemo, useState } from 'react';
import { group } from '@/lib/project/history';
import { addChapter, LABELS, removeChapter, updateChapter } from '@/lib/project/ops';
import { toRec } from '@/lib/project/time';
import type { Project } from '@/lib/project/types';
import { units } from '@/lib/wordCuts';
import type { SlotProps } from '../components/slots';
import { clock } from '../format';
import { chaptersInCut, youtubeChapters, youtubeText, type CutChapter } from '../timeline/chapters';
import { Btn, Heading, Help, TL_ICONS } from '../timeline/controls';
import { C, Icon, iconButton, MONO } from '../ui';

/** A new chapter's name: the first words said from `rec`, else its time. */
export function chapterTitle(words: readonly { start: number; end: number; text: string }[], rec: number, out: number): string {
  const said = words.filter((w) => w.end > rec).slice(0, 3).map((w) => w.text.trim().replace(/[.,!?;:]+$/, ''));
  return said.length ? said.join(' ') : clock(out);
}

/** Drag a row onto another: the two chapters swap places in time, so the list reorders while the flags stay put. */
export function swapChapters(project: Project, a: number, b: number): Project {
  const x = project.chapters[a];
  const y = project.chapters[b];
  if (!x || !y || a === b) return project;
  return group(project, LABELS.chapter('Moved', x.title), (p) => {
    const once = updateChapter(p, { index: a, patch: { at: y.at } });
    const i = once.chapters.findIndex((c) => c.title === y.title && c.at === y.at);
    return updateChapter(once, { index: i, patch: { at: x.at } });
  });
}

function Row({ c, onRename, onDelete, onDrop }: { c: CutChapter; onRename: (t: string) => void; onDelete: () => void; onDrop: (from: number) => void }) {
  const [text, setText] = useState(c.title);
  const [over, setOver] = useState(false);
  const commit = () => { if (text.trim() && text.trim() !== c.title) onRename(text.trim()); else setText(c.title); };
  return (
    <div draggable onDragStart={(e) => e.dataTransfer.setData('text/x-chapter', String(c.index))}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const from = Number(e.dataTransfer.getData('text/x-chapter')); if (Number.isFinite(from)) onDrop(from); }}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', borderBottom: `1px solid ${C.line}`, background: over ? C.raised : undefined }}>
      <span style={{ color: C.muted, display: 'flex', cursor: 'grab' }}><Icon size={14}>{TL_ICONS.grip}</Icon></span>
      <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.secondary, width: 34 }}>{clock(c.at)}</span>
      <input aria-label="Chapter name" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setText(c.title); }}
        style={{ flexGrow: 1, minWidth: 0, height: 30, borderRadius: 7, border: '1px solid transparent', background: 'transparent', color: C.text, padding: '0 8px', fontFamily: 'inherit', fontSize: 13 }} />
      <button type="button" aria-label="Delete chapter" title="Delete chapter" onClick={onDelete} style={iconButton(26)}><Icon size={14}>{TL_ICONS.trash}</Icon></button>
    </div>
  );
}

/** ChaptersEdit: the inspector after a chapter flag is clicked. */
export function ChaptersEdit(p: SlotProps) {
  const list = chaptersInCut(p.project, p.cut);
  const words = useMemo(() => units(p.recording.transcript), [p.recording.transcript]);
  const yt = youtubeText(youtubeChapters(list, p.length));
  const rec = toRec(p.cut, p.out);
  const [copied, setCopied] = useState(false);
  const add = () => {
    if (rec === null) return;
    p.edit((project) => addChapter(project, { chapter: { at: Math.round(rec), title: chapterTitle(words, rec, p.out) } }));
  };
  const copy = () => {
    navigator.clipboard?.writeText(yt).then(() => setCopied(true), (error: unknown) => console.error('Klipkord: could not copy the chapters', error));
  };
  return (
    <>
      <Heading aside={<span style={{ fontWeight: 400, color: C.muted }}>{list.length}</span>}>Chapters</Heading>
      <div>
        {list.map((c) => (
          <Row key={`${c.index}:${c.title}`} c={c}
            onRename={(title) => p.edit((project) => updateChapter(project, { index: c.index, patch: { title } }))}
            onDelete={() => p.edit((project) => removeChapter(project, { index: c.index }))}
            onDrop={(from) => p.edit((project) => swapChapters(project, from, c.index))} />
        ))}
      </div>
      <div><Btn icon={TL_ICONS.plus} onClick={add} disabled={rec === null || p.readOnly}>{`Add chapter at ${clock(p.out)}`}</Btn></div>
      <Help>Drag a flag on the ruler to move it. Chapters follow your cuts.</Help>
      <Heading aside={<button type="button" onClick={copy} disabled={!yt} style={{ border: 0, background: 'transparent', color: C.accentText, fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600, padding: 0, cursor: 'pointer' }}>{copied ? <Icon size={12}>{TL_ICONS.check}</Icon> : 'Copy'}</button>}>For YouTube</Heading>
      <pre style={{ margin: 0, padding: 10, borderRadius: 8, background: C.ground, border: `1px solid ${C.line}`, fontFamily: MONO, fontSize: 11.5, lineHeight: 1.6, color: C.secondary, whiteSpace: 'pre-wrap' }}>{yt}</pre>
      <p style={{ margin: 0, fontSize: 11.5, color: C.muted }}>Times are after cuts. YouTube needs the first at 0:00 and each at least 10 s long.</p>
    </>
  );
}
