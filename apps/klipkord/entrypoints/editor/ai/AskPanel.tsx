import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { discardHighlight, highlightFacts, keptParts, newCutOf } from '@/lib/ai/highlight';
import { applyDraft, opAt, opDelta, opLabel } from '@/lib/ai/ops';
import { PROVIDERS } from '@/lib/llm';
import { quote } from '@/lib/project/ops';
import { secs } from '@/lib/project/suggest';
import type { AiOp, Project } from '@/lib/project/types';
import type { Unit } from '@/lib/wordCuts';
import type { SlotProps } from '../components/slots';
import { clock } from '../format';
import { StateCard } from '../states/StateCard';
import { ICON } from '../transcript/icons';
import { C, Icon, ICONS, iconButton, MONO } from '../ui';
import { ask, checkSetup, stop } from './actions';
import { aiDeps } from './deps';
import { setAi, useAi, useDraft, useUnits, type Trial } from './store';
import { BODY, BUBBLE, BUTTON, Check, Header, MIC, NotSetUp, Offline, PANEL, useOnline } from './ui';

const OP_ICON: Record<AiOp['op'], ReactNode> = {
  cut: ICON.cut, keep: ICON.retake, move: ICON.next, speed: ICON.speed, zoom: ICON.zoom, caption: ICON.wand, card: ICONS.plus, chapter: ICON.flag, layout: ICON.more, newCut: ICON.cut,
};
const CHIPS = ['Make it 15 s', '9:16 for Shorts', 'Try other parts'] as const;
const many = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** "−5.8 s" shorter, "+2.5 s" longer, nothing when the length stays. */
const delta = (ms: number) => (Math.abs(ms) < 50 ? '' : `${ms < 0 ? '−' : '+'}${secs(Math.abs(ms))}`);

function Row({ icon, label, detail }: { icon: ReactNode; label: string; detail: string }) {
  return (
    <>
      <span style={{ color: C.accentText, display: 'flex', paddingTop: 1 }}><Icon size={14}>{icon}</Icon></span>
      <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: 12.5, lineHeight: 1.4 }}>{label}</span>
        {detail && <span style={{ fontFamily: MONO, fontSize: 11, color: C.muted }}>{detail}</span>}
      </span>
    </>
  );
}

/** The request input with the mic that fills it from speech. */
function AskInput({ disabled, onAsk, focus }: { disabled: boolean; onAsk: (text: string) => void; focus: number }) {
  const [text, setText] = useState('');
  const [listening, setListening] = useState<{ stop(): Promise<string>; cancel(): void } | null>(null);
  const [groq, setGroq] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (focus) input.current?.focus(); }, [focus]);
  useEffect(() => {
    let live = true;
    aiDeps().keys().then((k) => { if (live) setGroq(k[PROVIDERS.groq.keyName] ?? null); }, () => {});
    return () => { live = false; };
  }, []);
  useEffect(() => () => listening?.cancel(), [listening]);
  const hear = aiDeps().hear;
  const mic = async () => {
    if (!groq || !hear) return;
    if (listening) {
      setListening(null);
      try {
        const heard = await listening.stop();
        if (heard) setText(heard);
      } catch (error) {
        console.error('Klipkord: could not hear the request', error);
      }
      return;
    }
    try { setListening(await hear(groq)); } catch (error) { console.error('Klipkord: could not start the mic', error); }
  };
  const send = () => { if (text.trim() && !disabled) { onAsk(text); setText(''); } };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 38, flexShrink: 0, padding: '0 4px 0 12px', borderRadius: 10, border: `1px solid ${C.line}`, background: C.ground }}>
      <input ref={input} aria-label="Ask for an edit" placeholder="Ask for another change" value={text} disabled={disabled}
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
        style={{ flexGrow: 1, minWidth: 0, border: 0, background: 'transparent', color: C.text, fontFamily: 'inherit', fontSize: 13, outline: 'none' }} />
      {groq && hear && (
        <button type="button" aria-label="Say it instead" title="Say it instead" aria-pressed={!!listening} disabled={disabled} onClick={() => void mic()}
          style={{ ...iconButton(30), color: listening ? C.accentText : C.secondary }}><Icon>{MIC}</Icon></button>
      )}
    </div>
  );
}

/** The kept parts of a highlight, by chapter name where one starts them, else their first words. */
function partNames(project: Project, units: Unit[], keep: { from: number; to: number }[]): string[] {
  return keptParts(units, keep).map((part, i) => {
    const chapter = [...project.chapters].reverse().find((c) => c.at <= part.start + 1 && c.at >= part.start - 2000);
    const k = keep[i]!;
    return chapter?.title ?? quote(units.slice(k.from, k.to + 1).map((u, j) => project.wordFixes[k.from + j] ?? u.text).join(' '));
  });
}

/** Highlights: the new cut on trial, its kept parts and the follow-up chips. */
function HighlightView({ p, units, trial, busy, onAsk }: { p: SlotProps; units: Unit[]; trial: Trial; busy: boolean; onAsk: (t: string) => void }) {
  const spec = newCutOf(trial.ops)!;
  const back = p.project.cuts.find((c) => c.id === trial.back);
  const facts = useMemo(() => highlightFacts(p.project), [p.project]);
  const names = useMemo(() => partNames(p.project, units, spec.keep), [p.project, units, spec.keep]);
  const others = trial.ops.map((op, i) => ({ op, label: trial.labels[i] || opLabel(p.project, units, op) })).filter((x) => x.op.op !== 'newCut');
  const discard = () => {
    p.edit((q) => discardHighlight(q, { id: trial.cutId, back: trial.back }));
    setAi({ trial: null });
  };
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>New cut “{spec.name}” · {spec.shape} · {clock(facts.length)}</span>
        {back && <span style={{ fontSize: 12, color: C.secondary }}>Your {back.name} cut is unchanged.</span>}
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 2px', borderBottom: `1px solid ${C.line}` }}>
          <Row icon={ICON.cut} label={`Keeps ${many(names.length, 'part')}: ${names.join(', ')}`} detail={facts.starts.map((s) => clock(s)).join(', ')} />
        </div>
        {others.map(({ op, label }, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 2px', borderBottom: `1px solid ${C.line}` }}>
            <Row icon={OP_ICON[op.op]} label={label} detail={clock(opAt(p.project, units, op))} />
          </div>
        ))}
      </div>
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={discard} disabled={p.readOnly} style={BUTTON(false)}>Discard</button>
          <button type="button" onClick={() => setAi({ trial: null, panel: null })} style={BUTTON(true)}>Keep this cut</button>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {CHIPS.map((chip) => (
            <button key={chip} type="button" disabled={busy || p.readOnly} onClick={() => onAsk(`${trial.request}. ${chip}`)}
              style={{ height: 26, padding: '0 10px', borderRadius: 999, border: `1px solid ${C.line}`, background: 'transparent', color: C.secondary, fontFamily: 'inherit', fontSize: 12, cursor: 'pointer' }}>
              {chip}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/** AskAI: the request, the draft with a checkbox per change, Discard / Apply N, and every ai-* state. */
export function AskPanel(p: SlotProps) {
  const ai = useAi();
  const online = useOnline();
  const units = useUnits(p.recording);
  const draft = useDraft(p.project, units);
  const latest = useRef(p.project);
  latest.current = p.project;
  const [focus, setFocus] = useState(0);

  useEffect(() => {
    void checkSetup();
    const again = () => void checkSetup();
    addEventListener('focus', again);
    return () => removeEventListener('focus', again);
  }, []);
  // A highlight cut deleted elsewhere is no longer on trial.
  const trial = ai.trial && p.project.cuts.some((c) => c.id === ai.trial!.cutId) ? ai.trial : null;
  const run = (text: string) => void ask(text, { project: () => latest.current, units, edit: p.edit });
  const deltas = useMemo(() => draft?.ops.map((op) => opDelta(p.project, units, op)) ?? [], [draft, p.project, units]);

  const thinking = ai.status === 'thinking';
  const on = draft ? draft.changes.filter((c) => c.on).length : 0;
  const apply = () => {
    if (!draft || !on) return;
    p.edit((q) => applyDraft(q, units, draft));
    setAi({ reply: null, off: new Set(), applied: on, panel: null });
  };
  const toggle = (i: number) => setAi((s) => {
    const off = new Set(s.off);
    if (off.has(i)) off.delete(i); else off.add(i);
    return { off };
  });

  let state: ReactNode = null;
  if (!online) state = <Offline />;
  else if (ai.status === 'not-set-up') state = <NotSetUp />;
  else if (thinking) {
    state = (
      <StateCard state="ai-thinking" role="status" title="Reading your transcript…"
        body={`${ai.planned ? `Planning ${many(ai.planned, 'change')}. ` : ''}You can keep editing; the draft waits for you.`}
        actions={[{ label: 'Stop', tone: 'secondary', onClick: stop }]} />
    );
  } else if (ai.status === 'failed') {
    state = (
      <StateCard state="ai-failed" role="alert" title="The AI's reply didn't make sense" body="Nothing was changed. This sometimes happens with long videos."
        actions={[{ label: 'Try again', tone: 'primary', onClick: () => run(ai.request) }]} />
    );
  } else if (ai.status === 'cant') {
    state = (
      <StateCard state="ai-cant" role="alert" title="The AI can't do that yet"
        body={`It can cut, keep, reorder, speed, zoom, caption, add cards, chapters and layouts.${ai.cant ? ` It can't ${ai.cant.replace(/\.$/, '')}.` : ''}`}
        actions={[{ label: 'Try something else', tone: 'secondary', onClick: () => { setAi({ status: 'idle' }); setFocus((n) => n + 1); } }]} />
    );
  }

  const request = trial?.request ?? draft?.request ?? (ai.status !== 'idle' && ai.status !== 'not-set-up' ? ai.request : '');
  return (
    <aside aria-label="Ask AI" style={PANEL}>
      <Header title="Ask AI" provider={ai.provider} onBack={() => setAi({ panel: null })} />
      <div style={BODY}>
        {request && <div style={BUBBLE}>{request}</div>}
        {state}
        {!thinking && trial && <HighlightView p={p} units={units} trial={trial} busy={thinking} onAsk={run} />}
        {!thinking && !trial && draft && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>Draft · {many(draft.changes.length, 'change')} · {clock(draft.before)} → {clock(draft.after)}</span>
              <span style={{ fontSize: 12, color: C.secondary }}>Untick anything you don't want. Shown in orange on the timeline.</span>
            </div>
            <div>
              {draft.changes.map((c, i) => (
                <Check key={i} on={c.on} label={c.label} onChange={() => toggle(i)}>
                  <Row icon={OP_ICON[draft.ops[i]!.op]} label={c.label} detail={[clock(c.at), delta(deltas[i] ?? 0)].filter(Boolean).join(' · ')} />
                </Check>
              ))}
            </div>
            <div style={{ marginTop: 'auto', display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => setAi({ reply: null, off: new Set() })} style={BUTTON(false)}>Discard</button>
              <button type="button" disabled={!on || p.readOnly} onClick={apply} style={{ ...BUTTON(true), opacity: on && !p.readOnly ? 1 : 0.5 }}>Apply {on}</button>
            </div>
          </>
        )}
        <div style={{ marginTop: draft || trial ? 0 : 'auto' }}>
          <AskInput disabled={!online || thinking || p.readOnly || ai.status === 'not-set-up'} onAsk={run} focus={focus} />
        </div>
      </div>
    </aside>
  );
}
