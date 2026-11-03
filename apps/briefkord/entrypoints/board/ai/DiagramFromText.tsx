/** Frame DiagramFromText: a flow described in words becomes a diagram card; from DiagramEdit it changes the open diagram. */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { addDiagramCard, diagramCounts, diagramFromReply, replaceDiagram } from '@/lib/ai/apply';
import { parseDiagram } from '@/lib/ai/parse';
import { diagramPrompt } from '@/lib/ai/prompts';
import { askAi } from '@/lib/ai/run';
import { newId } from '@/lib/board/ops';
import type { Diagram } from '@/lib/board/types';
import { DiagramView, diagramBounds } from '../cards/DiagramView';
import { liveBoard } from '../diagram/DiagramEdit';
import { Close, Sparkle } from '../icons';
import { boardExtensions, type BoardShell } from '../shell/extensions';
import { askHost, openAiSettings, useChoice } from './choice';
import { AiPicker, openPicker } from './Picker';
import { useAiRun } from './run';
import { AiState, AiWorking, plural } from './States';

/** The made diagram at a readable size: fitted to the area, never below 60%, scrolled when larger. */
function Preview({ diagram }: { diagram: Diagram }) {
  const area = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState({ w: 580, h: 360 });
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const measure = () => setRoom({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const box = diagramBounds(diagram);
  const scale = Math.min(1.1, Math.max(0.6, Math.min(room.w / box.w, room.h / box.h)));
  const size = { '--bk-ai-w': `${Math.round(box.w * scale)}px`, '--bk-ai-h': `${Math.round(box.h * scale)}px` } as CSSProperties;
  return (
    <div ref={area} className="bk-ai-dft-fit" style={size}>
      <DiagramView diagram={diagram} className="bk-ai-dft-svg" />
    </div>
  );
}

export function DiagramFromText({ shell, cardId }: { shell: BoardShell; cardId?: string }) {
  const choice = useChoice();
  const root = useRef<HTMLElement>(null);
  const [text, setText] = useState('');
  const [current] = useState<Diagram | undefined>(() => {
    const card = cardId ? liveBoard(shell).cards[cardId] : undefined;
    return card?.kind === 'diagram' ? card.diagram : undefined;
  });
  const { phase, run, stop } = useAiRun<Diagram>(async (call) => diagramFromReply(await askAi(diagramPrompt(text.trim(), current), parseDiagram, call), current));
  const made = phase.kind === 'done' ? phase.value : undefined;

  const make = () => {
    if (!text.trim()) return;
    void run(askHost());
  };
  const cancel = () => {
    stop();
    shell.closeOverlay();
    if (cardId) boardExtensions.editDiagram(shell, cardId);
  };
  const add = () => {
    if (!made) return;
    const id = cardId ?? newId();
    shell.api.change((b, now) => (cardId ? replaceDiagram(b, cardId, made, now) : addDiagramCard(b, made, id, now)));
    shell.closeOverlay();
    if (!cardId) shell.showCard(id);
    boardExtensions.editDiagram(shell, id);
  };

  const live = useRef({ cancel });
  live.current = { cancel };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLElement && e.target.closest('.mp'))) live.current.cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const counts = made && diagramCounts(made);
  return (
    <div className="bk-ai-scrim">
      <section ref={root} role="dialog" aria-modal="true" aria-labelledby="bk-ai-dft-title" className="bk-ai-dft">
        <header className="bk-ai-dft-head">
          <span className="bk-ai-accent"><Sparkle size={18} small /></span>
          <h2 id="bk-ai-dft-title">Diagram from a description</h2>
          <button type="button" className="bk-ai-close" aria-label="Close" onClick={cancel}><Close /></button>
        </header>
        <div className="bk-ai-dft-main">
          <div className="bk-ai-dft-side">
            <label htmlFor="bk-ai-desc" className="bk-ai-label">Describe the flow</label>
            <textarea
              id="bk-ai-desc"
              rows={7}
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  make();
                }
              }}
            />
            <span className="bk-ai-hint">Plain steps work best: who does what, and what happens when.</span>
            {choice && <div className="bk-ai-model"><AiPicker choice={choice} label="Model" /></div>}
            <button type="button" className="bk-ai-btn is-wide is-big bk-ai-push" disabled={!text.trim() || phase.kind === 'working'} onClick={make}>
              {made ? 'Make it again' : 'Make it'}
            </button>
          </div>
          <div className="bk-ai-dft-preview">
            <div className="bk-ai-dft-area">
              {counts && <span className="bk-ai-badge">{`Preview · ${plural(counts.steps, 'step', 'steps')}${counts.choices ? `, ${plural(counts.choices, 'choice', 'choices')}` : ''}`}</span>}
              {made && <Preview diagram={made} />}
              {phase.kind === 'working' && <div className="bk-ai-center"><AiWorking onStop={stop} /></div>}
              {phase.kind === 'failed' && (
                <div className="bk-ai-center">
                  <AiState
                    state={phase.state}
                    provider={phase.provider}
                    surface="diagram"
                    actions={{ onRetry: make, onAskChrome: make, onPick: () => openPicker(root.current), onSettings: openAiSettings }}
                  />
                </div>
              )}
            </div>
            <footer className="bk-ai-dft-foot">
              <span className="bk-ai-hint bk-ai-grow">You can move, rename and connect every step after it is added.</span>
              <button type="button" className="bk-ai-btn is-tall" onClick={cancel}>Cancel</button>
              <button type="button" className="bk-ai-btn is-primary is-tall" disabled={!made} onClick={add}>Add to the board</button>
            </footer>
          </div>
        </div>
      </section>
    </div>
  );
}
