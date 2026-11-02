// Dev only: V4AskAllStates, the question cards Ask answers with and the search model's download states, on one board.
import { useEffect, useState } from 'react';
import type { MemorySource } from '@/lib/askAll';
import { listMeetings } from '@/lib/db';
import { M } from '@/lib/memory/sample';
import { getItem } from '@/lib/memory/store';
import type { MemoryItem } from '@/lib/memory/types';
import type { Meeting } from '@/lib/types';
import { BoardCard } from '../components/v4/states';
import { MemoryCard, ModelDownloading, ModelFailed } from '../screens/AskAll';

const MB = 1024 * 1024;
const noop = () => undefined;
const at = (m: number, s: number) => (m * 60 + s) * 1000;

/** The board's answered question from the 2 Nov sync: Sam asked, Priya answered. */
function launchCopyQuestion(sync: Meeting): MemoryItem {
  return {
    id: 'q-launch-copy', kind: 'question', status: 'answered', text: 'Who writes the launch email copy?', meetingId: sync.id, personIds: ['p-sam'],
    quote: { speaker: 'Sam', text: 'Who’s writing the launch email copy?', meetingId: sync.id, atMs: at(8, 55) },
    history: [{ speaker: 'Priya', text: 'I’ll write it, you’ll have it by Thursday.', meetingId: sync.id, atMs: at(9, 30) }],
    createdAt: sync.startedAt, updatedAt: sync.startedAt + at(9, 30),
  };
}

const source = (item: MemoryItem, meeting: Meeting, n: number): MemorySource => ({ n, kind: 'item', meetingId: meeting.id, title: meeting.title, startedAt: meeting.startedAt, atMs: item.quote.atMs, item });

export default function AskAllStatesBoard() {
  const [cards, setCards] = useState<{ open: MemorySource; answered: MemorySource; meetings: Meeting[] }>();
  useEffect(() => {
    void (async () => {
      const [meetings, free] = await Promise.all([listMeetings(), getItem('q-free-plan')]);
      const meeting = (id: string) => meetings.find((m) => m.id === id)!;
      if (!free) return;
      setCards({ open: source(free, meeting(free.meetingId), 1), answered: source(launchCopyQuestion(meeting(M.sync2)), meeting(M.sync2), 2), meetings });
    })().catch((error) => console.error('Rekord: could not load the Ask states board', error));
  }, []);
  return (
    <div style={{ width: 400, minHeight: 760, boxSizing: 'border-box', padding: '20px 16px', background: '#F6F6F7', color: '#111114', display: 'flex', flexDirection: 'column', gap: 22 }}>
      {cards && (
        <>
          <BoardCard label="Ask answers · open question"><MemoryCard s={cards.open} onOpen={noop} meetings={cards.meetings} /></BoardCard>
          <BoardCard label="Ask answers · answered question"><MemoryCard s={cards.answered} onOpen={noop} meetings={cards.meetings} /></BoardCard>
        </>
      )}
      <BoardCard label="Search model · downloading"><ModelDownloading loaded={9 * MB} total={22 * MB} /></BoardCard>
      <BoardCard label="Search model · download failed"><ModelFailed onRetry={noop} /></BoardCard>
    </div>
  );
}
