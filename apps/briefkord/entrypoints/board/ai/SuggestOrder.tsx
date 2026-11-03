/** Frame SuggestOrder: the List with the suggested order tinted; nothing changes until "Use this order". */
import { useEffect, useRef, useState } from 'react';
import { movedCount, orderMoves, type Move } from '@/lib/ai/apply';
import { parseOrder, type OrderReply } from '@/lib/ai/parse';
import { orderPrompt } from '@/lib/ai/prompts';
import { askAi } from '@/lib/ai/run';
import { listOrder, reorderList } from '@/lib/board/ops';
import type { Board } from '@/lib/board/types';
import { liveBoard } from '../diagram/DiagramEdit';
import { Sparkle } from '../icons';
import { KIND_LABEL } from '../logic/cards';
import type { BoardShell } from '../shell/extensions';
import { askHost, openAiSettings, providerLabel, useChoice } from './choice';
import { useAiRun } from './run';
import { AiState, AiWorking } from './States';

const Arrow = ({ up }: { up: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={up ? 'M12 19V5M6 11l6-6 6 6' : 'M12 5v14M6 13l6 6 6-6'} />
  </svg>
);

function moveText(move: Move): string {
  if (move.kind === 'stays') return 'Stays';
  if (move.kind === 'near') return `Stays near ${move.from}`;
  return `${move.kind === 'up' ? 'Up' : 'Down'} from ${move.from}`;
}

/** "**Show the flow early.** People need the picture…": the first sentence is the headline. */
function Reason({ why }: { why: string }) {
  const m = /^(.+?[.!?])\s+(.+)$/s.exec(why);
  return <div className="bk-ai-reason">{m ? <><strong>{m[1]}</strong> {m[2]}</> : <strong>{why}</strong>}</div>;
}

interface Result { reply: OrderReply; board: Board; current: string[] }

export function SuggestOrder({ shell, asked }: { shell: BoardShell; asked?: Promise<boolean> }) {
  const choice = useChoice();
  const [opened] = useState(() => liveBoard(shell));
  const { phase, run, stop } = useAiRun<Result>(async (call) => {
    const board = liveBoard(shell);
    const p = orderPrompt(board);
    const reply = await askAi(p, (r) => parseOrder(r, p.cardIds), call);
    return { reply, board, current: p.cardIds };
  });

  useEffect(() => {
    void run(asked);
  }, [run, asked]);

  const close = () => {
    stop();
    shell.closeOverlay();
  };
  const live = useRef(close);
  live.current = close;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && live.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const again = () => void run(askHost());
  const result = phase.kind === 'done' ? phase.value : undefined;
  const board = result?.board ?? opened;
  const rows = result ? orderMoves(result.current, result.reply.order) : listOrder(opened).map((id) => ({ id, move: undefined }));
  const moved = result ? movedCount(rows as { move: Move }[]) : 0;

  const use = () => {
    if (!result) return;
    shell.api.change((b, now) => reorderList(b, result.reply.order, now));
    shell.closeOverlay();
  };

  return (
    <div className="bk-ai-order">
      <div className="bk-ai-order-main">
        {phase.kind === 'working' && <AiWorking choice={choice} onStop={close} />}
        {phase.kind === 'failed' && (
          <>
            <AiState
              state={phase.state}
              provider={phase.provider}
              surface="order"
              actions={{ onRetry: again, onAskChrome: again, onPick: openAiSettings, onSettings: openAiSettings }}
            />
            <button type="button" className="bk-ai-btn is-mid bk-ai-end" onClick={close}>Keep mine</button>
          </>
        )}
        {result && phase.kind === 'done' && (
          <div role="status" className="bk-ai-banner">
            <span className="bk-ai-accent"><Sparkle size={18} small /></span>
            <span className="bk-ai-banner-text">
              <strong>{result.reply.headline ? `Suggested order: ${result.reply.headline}` : 'Suggested order'}</strong>
              <span>{`${moved === 1 ? '1 card moves' : `${moved} cards move`}. Nothing changes until you choose. ${phase.meta.model} · ${providerLabel(phase.meta.provider)}`}</span>
            </span>
            <button type="button" className="bk-ai-btn is-mid" onClick={close}>Keep mine</button>
            <button type="button" className="bk-ai-btn is-primary is-mid" onClick={use}>Use this order</button>
          </div>
        )}
        <ol className="bk-ai-rows">
          {rows.map(({ id, move }, i) => {
            const card = board.cards[id];
            if (!card) return null;
            const tone = move?.kind === 'up' ? ' is-up' : move?.kind === 'down' ? ' is-down' : '';
            return (
              <li key={id} className={`bk-ai-row-item${tone}`}>
                <span className="bk-ai-num">{i + 1}</span>
                <span className="bk-ai-row-title">{card.title || KIND_LABEL[card.kind]}</span>
                {move && (
                  <span className="bk-ai-move">
                    {(move.kind === 'up' || move.kind === 'down') && <Arrow up={move.kind === 'up'} />}
                    {moveText(move)}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      <aside aria-label="Why this order" className="bk-ai-why">
        {result && result.reply.reasons.length > 0 && (
          <>
            <h2>Why this order</h2>
            {result.reply.reasons.map((r) => <Reason key={r.card} why={r.why} />)}
          </>
        )}
        <span className="bk-ai-hint">Sent: card titles, types and your notes. One Undo puts your order back.</span>
      </aside>
    </div>
  );
}
