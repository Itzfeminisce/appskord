// Dev only: V4States, every banner, inline state and toast stacked as the board shows them, from the sample world.
import { useEffect, useState } from 'react';
import { providerName } from '@/lib/connection';
import { listMeetings } from '@/lib/db';
import { M } from '@/lib/memory/sample';
import { getItem, itemsForMeeting, listItems, listPeople } from '@/lib/memory/store';
import type { MemoryItem } from '@/lib/memory/types';
import { getSettings } from '@/lib/settings';
import { BoardCard, EmptyCard, ModelDownloadCard, ModelFailedBanner, QuoteMissingCard, StateBanner } from '../components/v4/states';
import { meetingLine, quoteClock, weekdayDate, type Meetings } from '../screens/v4/loops';
import { ToastBar } from '../screens/v4/parts';
import { RecallCard } from '../screens/v4/Recall';
import { recallCard, type RecallCard as Recall } from '@/lib/live/recall';
import { world } from '../components/v4/world';
import '../screens/v4/live.css';

const MB = 1024 * 1024;
const noop = () => undefined;

interface Board {
  provider: string; waiting: string; failed: string; q3: MemoryItem; meetings: Meetings; deck: MemoryItem; checklist: MemoryItem; launch: MemoryItem;
  totals: { promises: number; decisions: number; people: number }; lumen: { title: string; items: number }; owed?: Recall;
}

async function load(): Promise<Board> {
  const [settings, list, items, people, lumenItems] = await Promise.all([getSettings(), listMeetings(), listItems(), listPeople(), itemsForMeeting(M.lumen)]);
  const title = (id: string) => list.find((m) => m.id === id)?.title ?? '';
  const live = items.filter((i) => !i.leftOut && i.status !== 'dismissed');
  return {
    provider: providerName(settings.summary.provider), waiting: title(M.sync2), failed: title(M.review),
    q3: (await getItem('i-q3'))!, meetings: new Map(list.map((m) => [m.id, m])),
    deck: (await getItem('i-deck'))!, checklist: (await getItem('i-checklist'))!, launch: (await getItem('i-launch-copy'))!,
    totals: { promises: live.filter((i) => i.kind === 'promise').length, decisions: live.filter((i) => i.kind === 'decision').length, people: people.length },
    lumen: { title: title(M.lumen), items: lumenItems.length },
    owed: recallCard([(await getItem('i-deck'))!], list, people, world.now()),
  };
}

export default function StatesBoard() {
  const [b, setB] = useState<Board>();
  useEffect(() => { load().then(setB).catch((error) => console.error('Rekord: could not load the states board', error)); }, []);
  if (!b) return <div className="st4-board" />;
  const t = b.totals;
  return (
    <div className="st4-board">
      <BoardCard label="Memory · waiting for Groq">
        <StateBanner tone="promise" icon="info" title={`Memory is waiting for ${b.provider}`} body={`Rekord will read “${b.waiting}” as soon as your ${b.provider} key is back.`} action={{ label: 'Check my key', kind: 'link', onClick: noop }} />
      </BoardCard>
      <BoardCard label="Memory · failed for one meeting">
        <StateBanner alert tone="alert" icon="warn" title={`Memory failed for “${b.failed}”`} body="Nothing was lost. The transcript is safe." action={{ label: 'Try again', kind: 'primary', onClick: noop }} />
      </BoardCard>
      <BoardCard label="Quote not found">
        <QuoteMissingCard quote={`${b.q3.quote.speaker}: “${b.q3.quote.text}”`} caption={[meetingLine(b.q3.meetingId, b.meetings), quoteClock(b.q3.quote.atMs)].join(' · ')} onOpen={noop} />
      </BoardCard>
      <BoardCard label="Search model · downloading"><ModelDownloadCard loaded={9 * MB} total={22 * MB} /></BoardCard>
      <BoardCard label="Search model · failed"><ModelFailedBanner onRetry={noop} /></BoardCard>
      <BoardCard label="Folder · permission lost">
        <StateBanner alert tone="warn" icon="warn" title="Chrome needs your OK to keep writing to Rekord folder." action={{ label: 'Allow', kind: 'primary', onClick: noop }} />
      </BoardCard>
      <BoardCard label="Folder · missing">
        <StateBanner alert tone="alert" icon="warn" title="Rekord folder can’t be found" body="It may have been moved or deleted. Your notes are still in Rekord." action={{ label: 'Choose a folder', kind: 'primary', onClick: noop }} />
      </BoardCard>
      <BoardCard label="Notifications blocked">
        <StateBanner tone="warn" icon="off" title="Notifications are blocked" body="Briefs and due-day reminders can’t reach you." action={{ label: 'Turn on in Windows Settings', kind: 'link', onClick: noop }} />
      </BoardCard>
      <BoardCard label="Google Tasks · permission refused">
        <StateBanner alert tone="warn" icon="warn" title="Google Tasks said no" body={`Rekord can’t add “${b.deck.text}” without your permission.`} action={{ label: 'Ask again', kind: 'light', onClick: noop }} />
      </BoardCard>
      <BoardCard label="Linear · key rejected">
        <StateBanner alert tone="alert" icon="warn" title="Linear didn’t accept this key" body="Make sure you copied all of it, or create a new key in Linear." action={{ label: 'Update key', kind: 'link', onClick: noop }} />
      </BoardCard>
      <BoardCard label="Gmail compose · popup blocked">
        <StateBanner alert tone="warn" icon="warn" title="Chrome blocked the email draft" body="Allow pop-ups for Rekord, then try again." action={{ label: 'Try again', kind: 'light', onClick: noop }} />
      </BoardCard>
      <BoardCard label="Offline">
        <StateBanner tone="plain" icon="off" title="You’re offline" body="Your meetings and memory are still here. Rekord will catch up when you’re back." />
      </BoardCard>
      <BoardCard label="All clear"><EmptyCard title="Nothing open. Every promise is kept." body="New promises from your meetings will show up here." /></BoardCard>
      <BoardCard label="No people yet"><EmptyCard title="No people yet" body="People appear after your first meeting with someone." /></BoardCard>
      <BoardCard label="No calendar">
        <EmptyCard title="No briefs without a calendar" body="Connect Google Calendar to get briefs." action={{ label: 'Connect Google Calendar', onClick: noop }} />
      </BoardCard>
      <BoardCard label="Toast · undo"><ToastBar text={`Marked “${b.checklist.text}” as done`} onUndo={noop} /></BoardCard>
      <BoardCard label="Toast · undo, dismissed"><ToastBar text={`Snoozed “${b.launch.text}” to ${weekdayDate(new Date(2026, 10, 9, 9, 0).getTime())}`} onUndo={noop} /></BoardCard>
      <BoardCard label="Toast · backfill done"><ToastBar text={`Memory is ready: ${t.promises} promises, ${t.decisions} decisions, ${t.people} people`} /></BoardCard>
      <BoardCard label="Meeting deleted">
        <StateBanner tone="plain" icon="done" title={`“${b.lumen.title}” was deleted`} body={`Its ${b.lumen.items} memory items are gone too.`} action={{ label: 'Undo', kind: 'light', onClick: noop }} />
      </BoardCard>
      {b.owed && <BoardCard label="Recall card · a promise you owe"><RecallCard card={b.owed} onNotNow={noop} onMute={noop} /></BoardCard>}
    </div>
  );
}
