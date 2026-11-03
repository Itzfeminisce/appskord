/** Frame BriefMe: talking points, open questions and what the board is missing, in a panel beside the canvas. */
import { useEffect, useRef, useState } from 'react';
import { addBriefNote, briefText, keptBrief, withBrief } from '@/lib/ai/apply';
import { parseBrief } from '@/lib/ai/parse';
import { briefPrompt } from '@/lib/ai/prompts';
import { askAi } from '@/lib/ai/run';
import { cardLabel } from '@/lib/board/label';
import { cardNumbers, newId } from '@/lib/board/ops';
import type { Board, KeptBrief } from '@/lib/board/types';
import { hasHostAccess, isAiProvider, requestHostAccess } from '@/lib/keys';
import { liveBoard } from '../diagram/DiagramEdit';
import { Close } from '../icons';
import type { BoardShell } from '../shell/extensions';
import { askHost, openAiSettings, providerLabel, useChoice } from './choice';
import { AiPicker, openPicker } from './Picker';
import { useAiRun } from './run';
import { AiState, AiWorking, BriefEmptyBoard, plural } from './States';

const savedPages = (board: Board) => Object.values(board.cards).filter((c) => c.kind === 'link' && c.text.trim()).length;
/** "Checkout usability" from "Checkout usability: 18 findings from user tests". */
const shortTitle = (title: string) => title.split(':')[0]!.trim();

interface Result { kept: KeptBrief; missing: string[]; board: Board }

export function BriefMe({ shell, asked }: { shell: BoardShell; asked?: Promise<boolean> }) {
  const choice = useChoice();
  const root = useRef<HTMLElement>(null);
  const [opened] = useState(() => liveBoard(shell));
  const [host, setHost] = useState(true);
  const cards = Object.keys(opened.cards).length;
  const pages = savedPages(opened);
  const provider = choice?.value.provider ?? '';

  useEffect(() => {
    if (!isAiProvider(provider)) return;
    let live = true;
    void hasHostAccess(provider).then((h) => live && setHost(h));
    return () => {
      live = false;
    };
  }, [provider]);

  const { phase, run, stop } = useAiRun<Result>(async (call, meta) => {
    const board = liveBoard(shell);
    const p = briefPrompt(board);
    const reply = await askAi(p, (r) => parseBrief(r, p.cardIds.length), call);
    const kept = keptBrief(reply, p.cardIds, meta, Date.now());
    shell.api.change((b, now) => withBrief(b, { ...kept, at: now }, now));
    return { kept, missing: reply.missing, board: liveBoard(shell) };
  });

  useEffect(() => {
    if (cards > 0) void run(asked);
  }, [run, asked, cards]);

  const again = () => void run(askHost());
  const result = phase.kind === 'done' ? phase.value : undefined;
  const numbers = result ? cardNumbers(result.board) : {};

  const addNote = () => {
    if (!result) return;
    const id = newId();
    shell.api.change((b, now) => addBriefNote(b, briefText(b, result.kept, result.missing), id, now));
    shell.showCard(id);
  };
  const copy = () => {
    if (!result) return;
    navigator.clipboard.writeText(briefText(liveBoard(shell), result.kept, result.missing)).catch((error: unknown) => console.error('Briefkord: could not copy the brief', error));
  };

  return (
    <aside ref={root} aria-label="Brief me" className="bk-ai-brief">
      <div className="bk-ai-brief-head">
        <div className="bk-ai-brief-title">
          <h2>Brief me</h2>
          <button type="button" className="bk-ai-close" aria-label="Close Brief me" onClick={shell.closeOverlay}><Close /></button>
        </div>
        {choice && <div className="bk-ai-quiet-label"><AiPicker choice={choice} label="Model" /></div>}
        <span className="bk-ai-sent">
          {`Sent to ${providerLabel(provider)}: card titles, your notes and the text of ${plural(pages, 'saved page', 'saved pages')}. Images and files stay here.`}
          {!host && isAiProvider(provider) && (
            <>
              {' '}
              <button type="button" className="bk-ai-link" onClick={() => void requestHostAccess(provider).then(setHost)}>Chrome asks once</button>.
            </>
          )}
        </span>
      </div>
      <div className="bk-ai-brief-body">
        {cards === 0 && <BriefEmptyBoard />}
        {phase.kind === 'working' && (
          <AiWorking
            choice={choice}
            steps={[`Read ${plural(cards, 'card', 'cards')} and ${plural(pages, 'saved page', 'saved pages')}`, 'Writing talking points', 'Finding open questions']}
            onStop={stop}
          />
        )}
        {phase.kind === 'failed' && (
          <AiState
            state={phase.state}
            provider={phase.provider}
            surface="brief"
            actions={{ onRetry: again, onAskChrome: again, onPick: () => openPicker(root.current), onSettings: openAiSettings }}
          />
        )}
        {result && (
          <>
            <section className="bk-ai-sec">
              <h3>Talking points</h3>
              {result.kept.points.map((p, i) => (
                <div key={i} className="bk-ai-point">
                  <span className="bk-ai-point-n">{i + 1}</span>
                  <span className="bk-ai-point-body">
                    <span>{p.text}</span>
                    {p.cards.length > 0 && (
                      <span className="bk-ai-chips">
                        {p.cards.map((id) => {
                          const card = result.board.cards[id];
                          if (!card) return null;
                          return (
                            <button key={id} type="button" className={`bk-ai-chip${shell.selection.includes(id) ? ' is-on' : ''}`} onClick={() => shell.showCard(id)}>
                              {numbers[id]} {shortTitle(cardLabel(card))}
                            </button>
                          );
                        })}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </section>
            {result.kept.questions.length > 0 && (
              <section className="bk-ai-sec">
                <h3>Open questions</h3>
                {result.kept.questions.map((q, i) => <span key={i} className="bk-ai-q">{q}</span>)}
              </section>
            )}
            {result.missing.length > 0 && (
              <section className="bk-ai-missing">
                <h3>Not on the board yet</h3>
                {result.missing.map((m, i) => <span key={i}>{m}</span>)}
              </section>
            )}
          </>
        )}
      </div>
      <div className="bk-ai-brief-foot">
        <div className="bk-ai-row">
          <button type="button" className="bk-ai-btn is-primary is-grow is-tall" disabled={!result} onClick={addNote}>Add as a note card</button>
          <button type="button" className="bk-ai-btn is-tall" disabled={!result} onClick={copy}>Copy</button>
          <button type="button" className="bk-ai-btn is-tall" disabled={cards === 0 || !result} onClick={again}>Run again</button>
        </div>
        <span className="bk-ai-hint">AI can get things wrong. Check each point against its card.</span>
      </div>
    </aside>
  );
}
