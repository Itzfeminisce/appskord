import { useEffect, useState, type ReactNode } from 'react';
import { clock } from '@/lib/calendar';
import { transition } from '@/lib/memory/promise';
import { rankOpenLoops, type LoopSection, type LoopTab } from '@/lib/memory/rank';
import { putItem } from '@/lib/memory/store';
import type { MemoryItem } from '@/lib/memory/types';
import { useCalendar } from '../../components/CalendarCard';
import { nearMeeting } from '../../components/v4/recordBar';
import { HomeStates } from '../../components/v4/HomeStates';
import { Shell } from '../../components/v4/Shell';
import { EmptyCard } from '../../components/v4/states';
import { world } from '../../components/v4/world';
import { useRouter } from '../../router';
import { appLabel, counterpartId, dueChip, meetingLine, setPendingToast, takePendingToast, weekdayShort, type Toast } from './loops';
import { Avatar, BigCheck, ChevronIcon, DecisionIcon, DueChip, refreshBadge, ToastBar, useMemoryView, type MemoryView } from './parts';
import { QuestionsList } from './Questions';

const SECTION: Record<LoopSection, string> = { overdue: 'Overdue', today: 'Today', thisWeek: 'This week', noDate: 'No date' };
const TABS: { id: LoopTab; label: string }[] = [
  { id: 'youOwe', label: 'You owe' }, { id: 'owedToYou', label: 'Owed to you' }, { id: 'questions', label: 'Questions' },
];
const TOAST_MS = 6000;

// The tab survives a trip to a sheet and back.
let lastTab: LoopTab = 'youOwe';
/** Opens Open loops on a tab (dev frame routes). */
export const openTab = (t: LoopTab) => { lastTab = t; };
// Within a section, promises that look done wait below the ones still open.
const lastDone = (items: MemoryItem[]) => [...items.filter((i) => i.status !== 'looksDone'), ...items.filter((i) => i.status === 'looksDone')];

/** "1:1 with Sarah · in 5 min" with Open brief, when a calendar meeting is near. */
function BriefCard() {
  const { navigate, has } = useRouter();
  const calendar = useCalendar();
  const now = world.now();
  const events = world.events ?? (calendar.status === 'ready' ? calendar.events : []);
  const near = nearMeeting(events, now);
  if (!near) return null;
  const minutes = Math.round((near.start - now) / 60_000);
  const brief: string = 'brief';
  const app = appLabel(near.app);
  return (
    <section aria-label="Next meeting" className="lp-brief">
      <span className="lp-brief-tile"><span>{weekdayShort(near.start)}</span><span>{clock(near.start)}</span></span>
      <span className="lp-brief-text">
        <span className="lp-brief-title">{minutes > 0 ? `${near.title} · in ${minutes} min` : near.title}</span>
        <span className="lp-brief-sub">{`Today ${clock(near.start)}${app ? ` · ${app}` : ''}`}</span>
      </span>
      <button type="button" className="lp-brief-open" aria-disabled={!has(brief) || undefined} onClick={() => { if (has(brief)) navigate(brief); }}>
        Open brief
      </button>
    </section>
  );
}

function Row({ item, view, now, onCheck }: { item: MemoryItem; view: MemoryView; now: number; onCheck: (i: MemoryItem) => void }) {
  const { navigate } = useRouter();
  const person = view.people.get(counterpartId(item) ?? '');
  return (
    <div className="lp-row">
      <button type="button" className="lp-check" aria-label={`Mark done: ${item.text}`} onClick={() => onCheck(item)}><span /></button>
      <button type="button" className="lp-row-main" onClick={() => navigate('promise', { itemId: item.id })}>
        <span className="lp-row-text">
          <span className="lp-row-title">{item.text}</span>
          <span className="lp-row-meta"><DueChip chip={dueChip(item, now)} /><span className="lp-row-meeting">{meetingLine(item.meetingId, view.meetings)}</span></span>
        </span>
        {person && <Avatar name={person.name} />}
      </button>
    </div>
  );
}

/** Open loops: brief card, Looks done banner, the three tabs and their sections. Under a sheet, `tab` is the sheet item's tab. */
export function LoopsHome({ tab: forced, sheet = false, children }: { tab?: LoopTab; sheet?: boolean; children?: ReactNode }) {
  const { navigate } = useRouter();
  const [view, reload] = useMemoryView();
  const [chosen, setChosen] = useState<LoopTab>(lastTab);
  const [toast, setToast] = useState<Toast | undefined>(() => (sheet ? undefined : takePendingToast()));
  const tab = forced ?? chosen;
  const now = world.now();
  const loops = rankOpenLoops(view.items, now, tab);
  const looksDone = rankOpenLoops(view.items, now).sections.flatMap((s) => s.items).filter((i) => i.status === 'looksDone');
  const empty = view.ready && loops.counts.youOwe + loops.counts.owedToYou + loops.counts.questions === 0;

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(undefined), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const choose = (t: LoopTab) => { lastTab = t; setChosen(t); };
  const check = async (item: MemoryItem) => {
    const done = transition(item, item.kind === 'question' ? { type: 'answer' } : { type: 'done' }, Date.now());
    if (done === item) return;
    await putItem(done);
    refreshBadge();
    setToast({ text: `Marked “${item.text}” as done`, undo: item });
    reload();
  };
  const undo = async (t: Toast) => {
    setToast(undefined);
    await putItem({ ...t.undo, updatedAt: Date.now() });
    refreshBadge();
    reload();
  };

  return (
    <div className="lp-stack">
      <Shell tab="loops">
        <div className="lp-home">
          <BriefCard />
          <HomeStates />
          {looksDone.length > 0 && tab !== 'questions' && (
            <button type="button" className="lp-looks" onClick={() => navigate('looksDone', { itemId: looksDone[0]!.id })}>
              <BigCheck size={16} />
              <span className="lp-looks-text">{looksDone.length === 1 ? '1 promise looks done' : `${looksDone.length} promises look done`}</span>
              <span className="lp-looks-check">Check</span>
              <ChevronIcon />
            </button>
          )}
          <div className="lp-seg-row">
            <div role="radiogroup" aria-label="Show" className="lp-seg">
              {TABS.map((t) => (
                <button key={t.id} type="button" role="radio" aria-checked={t.id === tab} onClick={() => choose(t.id)}>
                  <span>{t.label}<span className="lp-seg-count">{loops.counts[t.id]}</span></span>
                </button>
              ))}
            </div>
            <button type="button" className="lp-decisions" aria-label="Decisions" onClick={() => navigate('decisions')}><DecisionIcon /></button>
          </div>
          {empty ? (
            <EmptyCard title="Nothing open. Every promise is kept." body="New promises from your meetings will show up here." />
          ) : tab === 'questions' ? (
            <QuestionsList items={loops.sections.flatMap((s) => s.items)} view={view} onAnswer={(x) => void check(x)} />
          ) : (
            <div className="lp-list">
              {loops.sections.map((s) => (
                <div key={s.id} className="lp-section">
                  <h2>{SECTION[s.id]}</h2>
                  {lastDone(s.items).map((i) => <Row key={i.id} item={i} view={view} now={now} onCheck={(x) => void check(x)} />)}
                </div>
              ))}
            </div>
          )}
        </div>
      </Shell>
      {toast && <div className="lp-toast-wrap"><ToastBar text={toast.text} onUndo={() => void undo(toast)} /></div>}
      {children}
    </div>
  );
}

/** Shows a toast on Open loops once a sheet has closed. */
export function toastOnHome(text: string, undo: MemoryItem) { setPendingToast({ text, undo }); }

export default function Home() {
  return <LoopsHome />;
}
