import { useEffect, useState } from 'react';
import { getSettings } from '@/lib/settings';
import { EmptyCard } from '../../components/v4/states';
import { agendaMinutes, SOURCE_LABEL, withGoal, GOAL_ID } from '@/lib/memory/agenda';
import { APP_LABEL, clockOf, dayMonth, dueLabel, firstName, whenChip, type Brief as BriefData } from '@/lib/memory/brief';
import type { Agenda } from '@/lib/memory/types';
import { world } from '../../components/v4/world';
import { useRouter } from '../../router';
import { useBrief, saveAgenda } from './briefData';
import { BackHeader, Face, Pill, QuestionMark, RecordButton } from './briefParts';
import '../../components/v4/shell.css';

/** Where "Record with this agenda" goes: the tell-people step once it is built, else Start. */
export function useRecordWithAgenda(): (agenda: Agenda) => void {
  const { navigate, has } = useRouter();
  return (agenda) => {
    const tell: string = 'tellPeople';
    void saveAgenda(agenda)
      .catch((error) => console.error('Rekord: could not save the agenda', error))
      .then(() => (has(tell) ? navigate(tell, { eventId: agenda.meetingKey }) : navigate('start')));
  };
}

/** "in 5 min" chip, the app and the start time. */
export function WhenLine({ brief, now }: { brief: BriefData; now: number }) {
  const { event } = brief;
  const when = whenChip(event, now);
  const app = event.app ? APP_LABEL[event.app] : undefined;
  if (!when.soon) {
    return (
      <div className="bp-meta">
        <Pill tone="promise" className="bp-chip-day">{when.label}<span className="bp-chip-time">{clockOf(event.start)}</span></Pill>
        {app && <span>{app}</span>}
      </div>
    );
  }
  return (
    <div className="bp-meta">
      <Pill tone="promise">{when.label}</Pill>
      {app && <><span>{app}</span><span aria-hidden="true" className="bp-muted">·</span></>}
      <span className="bp-mono bp-muted">{clockOf(event.start)}</span>
    </div>
  );
}

/** "You owe Sarah", "Sarah owes you" with due chips, and "Still open" questions. */
export function OpenRows({ brief, now, className = 'bp-card' }: { brief: BriefData; now: number; className?: string }) {
  if (!brief.rows.length) return null;
  const names = brief.who.map((w) => firstName(w.name)).join(' and ');
  return (
    <section aria-label={`Open between you and ${names}`} className={className}>
      {brief.rows.map(({ item, label, kind }) => {
        const due = kind === 'promise' ? dueLabel(item, now) : undefined;
        return (
          <div key={item.id} className="bp-row">
            <span className="bp-row-text">
              <span className={kind === 'question' ? 'bp-row-label bp-row-label-q' : 'bp-row-label'}>{label}</span>
              <span className="bp-row-title">{item.text}</span>
            </span>
            {kind === 'question' && <Pill tone="question"><QuestionMark />Question</Pill>}
            {due && <Pill tone={due.tone === 'late' ? 'late' : due.tone === 'today' ? 'promise' : 'plain'}>{due.label}</Pill>}
          </div>
        );
      })}
    </section>
  );
}

function BriefKnown({ brief, agenda, lastTime }: { brief: BriefData; agenda: Agenda; lastTime?: string[] }) {
  const { back, canGoBack, replace, navigate } = useRouter();
  const record = useRecordWithAgenda();
  const now = world.now();
  return (
    <div className="bp-screen">
      <BackHeader label="Back to open loops" onBack={() => (canGoBack ? back() : replace('home'))} />
      <main className="bp-main">
        <div className="bp-title">
          <h1>{brief.event.title}</h1>
          <WhenLine brief={brief} now={now} />
        </div>
        {brief.who.length > 0 && (
          <section aria-label="Who is coming" className="bp-with">
            <span className="bp-with-label">With</span>
            {brief.who.map((w) => (
              <span key={w.email} className="bp-guest"><Face name={w.name} known={w.known} />{w.name}</span>
            ))}
          </section>
        )}
        {brief.last && !!lastTime?.length && (
          <section aria-labelledby="bp-last" className="bp-last">
            <h2 id="bp-last" className="bp-h2">Last time · <span className="bp-mono">{dayMonth(brief.last.startedAt)}</span></h2>
            <ul>{lastTime.map((line) => <li key={line}>{line}</li>)}</ul>
          </section>
        )}
        <OpenRows brief={brief} now={now} />
        <section aria-labelledby="bp-agenda" className="bp-agenda">
          <div className="bp-agenda-head">
            <h2 id="bp-agenda" className="bp-h2">
              Suggested agenda · {agenda.items.length} {agenda.items.length === 1 ? 'item' : 'items'} · <span className="bp-mono">{agendaMinutes(agenda.items)} of {agenda.totalMinutes} min</span>
            </h2>
            <button type="button" className="bp-link" onClick={() => navigate('agendaEdit', { eventId: brief.event.id })}>Edit agenda</button>
          </div>
          <ol>
            {agenda.items.map((a, n) => (
              <li key={a.id}>
                <span className="bp-num">{n + 1}</span>
                <span className="bp-agenda-text">{a.text}</span>
                <span className="bp-agenda-src">{SOURCE_LABEL[a.source]} · <span className="bp-mono">{a.minutes} min</span></span>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <footer className="bp-foot">
        <RecordButton label="Record with this agenda" onClick={() => record(agenda)} />
      </footer>
    </div>
  );
}

/** V4BriefNew: nobody on the invite is known yet; the goal typed here becomes agenda item one. */
function BriefNew({ brief, agenda }: { brief: BriefData; agenda: Agenda }) {
  const { back, canGoBack, replace } = useRouter();
  const record = useRecordWithAgenda();
  const [goal, setGoal] = useState(() => agenda.items.find((i) => i.id === GOAL_ID)?.text ?? '');
  const first = brief.who[0]!;
  return (
    <div className="bp-screen">
      <BackHeader label="Back to open loops" onBack={() => (canGoBack ? back() : replace('home'))} />
      <main className="bp-main bp-main-roomy">
        <div className="bp-title bp-title-roomy">
          <h1>{brief.event.title}</h1>
          <WhenLine brief={brief} now={world.now()} />
        </div>
        <section aria-label="Who is coming" className="bp-who">
          {brief.who.map((w) => (
            <div key={w.email} className="bp-who-row">
              <Face name={w.name} known={false} size={40} />
              <span className="bp-who-name"><strong>{w.name}</strong><span>{w.email}</span></span>
              <Pill tone="new">New contact</Pill>
            </div>
          ))}
          <p>{`First meeting with ${first.name}. Rekord has nothing on ${firstName(first.name)} yet.`}</p>
        </section>
        {brief.event.description && (
          <section aria-labelledby="bp-invite" className="bp-invite">
            <h2 id="bp-invite" className="bp-h2">From the invite</h2>
            <blockquote>{`“${brief.event.description}”`}</blockquote>
          </section>
        )}
        <section className="bp-goal">
          <label htmlFor="bp-want">What do you want from this meeting?</label>
          <textarea id="bp-want" rows={3} value={goal} onChange={(e) => setGoal(e.target.value)} />
          <span>This becomes the first item on your agenda.</span>
        </section>
      </main>
      <footer className="bp-foot bp-foot-tall">
        <RecordButton tall label="Record with this agenda" onClick={() => record(withGoal(agenda, goal))} />
      </footer>
    </div>
  );
}

/** V4Brief: the meeting about to start (or the one a notification named), from local data. */
export default function Brief() {
  const { route, back, canGoBack, replace, navigate } = useRouter();
  const [view] = useBrief(route.params.eventId);
  const [calendarOff, setCalendarOff] = useState(false);
  useEffect(() => {
    getSettings().then((s) => setCalendarOff(!s.google.calendar)).catch((error) => console.error('Rekord: could not load your settings', error));
  }, []);
  if (!view.ready) return <div className="bp-screen" />;
  if (!view.brief || !view.agenda) {
    return (
      <div className="bp-screen">
        <BackHeader label="Back to open loops" onBack={() => (canGoBack ? back() : replace('home'))} />
        {calendarOff && (
          <main className="bp-main">
            <EmptyCard title="No briefs without a calendar" body="Connect Google Calendar to get briefs."
              action={{ label: 'Connect Google Calendar', onClick: () => navigate('googleConnect') }} />
          </main>
        )}
      </div>
    );
  }
  if (view.brief.firstMeeting) return <BriefNew brief={view.brief} agenda={view.agenda} />;
  return <BriefKnown brief={view.brief} agenda={view.agenda} lastTime={view.lastTime} />;
}
