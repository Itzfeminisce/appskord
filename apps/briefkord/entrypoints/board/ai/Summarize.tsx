/** Frame SummarizeLink: a summary note next to the link, after it in the list, then a toast with Undo. */
import { useCallback, useEffect, useState } from 'react';
import { addSummary, summaryNote } from '@/lib/ai/apply';
import { parseSummary } from '@/lib/ai/parse';
import { summaryPrompt } from '@/lib/ai/prompts';
import { AiError, askAi } from '@/lib/ai/run';
import { newId, updateCard } from '@/lib/board/ops';
import type { LinkCard } from '@/lib/board/types';
import { liveBoard } from '../diagram/DiagramEdit';
import { Close } from '../icons';
import { shortDate } from '../logic/cards';
import { readOpenPage } from '../logic/refresh';
import { Toast } from '../screens/States';
import type { BoardShell } from '../shell/extensions';
import { askHost, openAiSettings, useChoice } from './choice';
import { useAiRun } from './run';
import { AiState, AiWorking, SummaryNoText } from './States';

export function Summarize({ shell, cardId, asked }: { shell: BoardShell; cardId: string; asked?: Promise<boolean> }) {
  const choice = useChoice();
  const link = useCallback((): LinkCard | undefined => {
    const card = liveBoard(shell).cards[cardId];
    return card?.kind === 'link' ? card : undefined;
  }, [shell, cardId]);
  const [noText, setNoText] = useState(() => !link()?.text.trim());
  const [refreshing, setRefreshing] = useState(false);

  const { phase, run, stop } = useAiRun<string>(async (call, meta) => {
    const l = link();
    if (!l) throw new AiError('cancelled');
    const reply = await askAi(summaryPrompt(l), parseSummary, call);
    const now = Date.now();
    const note = summaryNote(l, reply, meta, newId(), now);
    const arrowId = newId();
    shell.api.change((b, at) => addSummary(b, cardId, { ...note, createdAt: at, updatedAt: at }, arrowId, at));
    shell.showCard(note.id);
    return note.id;
  });

  useEffect(() => {
    if (!noText) void run(asked);
  }, [run, asked, noText]);

  const close = useCallback(() => {
    stop();
    shell.closeOverlay();
  }, [stop, shell]);

  const refresh = async () => {
    const asking = askHost();
    const l = link();
    if (!l) return;
    setRefreshing(true);
    const page = await readOpenPage(l.url);
    setRefreshing(false);
    if (!page?.text.trim()) return;
    shell.api.change((b, now) => updateCard(b, cardId, now, (c) => (c.kind === 'link' ? { ...c, text: page.text, words: page.words, savedAt: now } : c)));
    setNoText(false);
    void run(asking);
  };

  if (phase.kind === 'done') {
    return (
      <Toast
        toast={{ kind: 'undo', text: 'Summary added next to the link and to the list after it.', onUndo: () => shell.api.undo() }}
        onClose={shell.closeOverlay}
      />
    );
  }
  const again = () => void run(askHost());
  const saved = link()?.savedAt;
  return (
    <div className="bk-ai-float">
      {phase.kind !== 'working' && (
        <button type="button" className="bk-ai-close bk-ai-float-close" aria-label="Close" onClick={close}><Close size={16} /></button>
      )}
      {noText && phase.kind !== 'working' && <SummaryNoText busy={refreshing} onRefresh={() => void refresh()} />}
      {phase.kind === 'working' && <AiWorking onStop={close} />}
      {phase.kind === 'working' && choice && saved !== undefined && (
        <span className="bk-ai-hint">{`From the page text saved ${shortDate(saved)}`}</span>
      )}
      {phase.kind === 'failed' && (
        <AiState
          state={phase.state}
          provider={phase.provider}
          surface="summary"
          actions={{ onRetry: again, onAskChrome: again, onPick: openAiSettings, onSettings: openAiSettings }}
        />
      )}
    </div>
  );
}
