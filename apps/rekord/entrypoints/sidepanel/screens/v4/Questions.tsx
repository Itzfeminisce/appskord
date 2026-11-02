import { useEffect, useState } from 'react';
import { topicOf } from '@/lib/memory/agenda';
import { itemsByStatus, putAgenda } from '@/lib/memory/store';
import type { MemoryItem } from '@/lib/memory/types';
import { world } from '../../components/v4/world';
import { useRouter } from '../../router';
import { loadBrief } from './briefData';
import { firstName } from './loops';
import { QuoteBlock, type MemoryView } from './parts';

const ANSWERED_SHOWN = 2;
const LATELY_MS = 30 * 24 * 60 * 60_000;
const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
const QuestionIcon = () => <svg {...base} width="16" height="16" strokeWidth="2.2"><path d="M9 9a3 3 0 1 1 4.5 2.6c-1 .6-1.5 1.1-1.5 2.4M12 17.5v.01" /></svg>;
const Chevron = ({ open }: { open: boolean }) => <svg {...base} width="16" height="16" strokeWidth="2"><path d={open ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6'} /></svg>;

/** The newest questions answered in the last 30 days. */
export function answeredLately(items: MemoryItem[], now: number): MemoryItem[] {
  return items.filter((i) => i.kind === 'question' && i.status === 'answered' && now - i.updatedAt <= LATELY_MS)
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, ANSWERED_SHOWN);
}

/** Puts the question on the next meeting's agenda, once. */
export async function addToNextAgenda(item: MemoryItem, now: number): Promise<boolean> {
  const { agenda } = await loadBrief(undefined, now);
  if (!agenda) return false;
  const id = `a-${item.id}`;
  if (!agenda.items.some((a) => a.id === id)) {
    await putAgenda({ ...agenda, items: [...agenda.items, { id, text: topicOf(item.text), source: 'question', minutes: 5 }] });
  }
  return true;
}

function QuestionCard({ item, view, onAnswer }: { item: MemoryItem; view: MemoryView; onAnswer: (i: MemoryItem) => void }) {
  const { navigate } = useRouter();
  const add = async () => {
    await addToNextAgenda(item, world.now()).catch((error) => console.error('Rekord: could not add to the agenda', error));
    navigate('brief');
  };
  return (
    <article className="lp-question">
      <div className="lp-question-head">
        <span className="lp-question-icon"><QuestionIcon /></span>
        <h3>{item.text}</h3>
        {item.quote.speaker && <span className="lp-question-who">{`Asked by ${firstName(item.quote.speaker)}`}</span>}
      </div>
      <QuoteBlock quote={item.quote} meetings={view.meetings} accent="#8A4B00" variant="question" />
      <div className="lp-question-actions">
        <button type="button" className="lp-question-answer" onClick={() => onAnswer(item)}>Mark answered</button>
        <button type="button" className="lp-question-agenda" onClick={() => void add()}>Add to next agenda</button>
      </div>
    </article>
  );
}

/** V4HomeQuestions: open questions with their quote, then "Answered lately", collapsed. */
export function QuestionsList({ items, view, onAnswer }: { items: MemoryItem[]; view: MemoryView; onAnswer: (i: MemoryItem) => void }) {
  const [answered, setAnswered] = useState<MemoryItem[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    itemsByStatus('answered').then((all) => { if (alive) setAnswered(answeredLately(all, world.now())); })
      .catch((error) => console.error('Rekord: could not load answered questions', error));
    return () => { alive = false; };
  }, [view]);
  return (
    <div className="lp-list">
      {items.length > 0 && <h2 className="lp-list-head">Open questions</h2>}
      {items.map((i) => <QuestionCard key={i.id} item={i} view={view} onAnswer={onAnswer} />)}
      {answered.length > 0 && (
        <>
          <button type="button" className="lp-answered-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
            <Chevron open={open} /><span>Answered lately</span><span className="lp-answered-count">{answered.length}</span>
          </button>
          {open && answered.map((i) => {
            const answer = i.history.at(-1);
            return (
              <article key={i.id} className="lp-question lp-question-done">
                <h3>{i.text}</h3>
                {answer && <QuoteBlock quote={answer} meetings={view.meetings} accent="#1A6B40" variant="question" />}
              </article>
            );
          })}
        </>
      )}
    </div>
  );
}
