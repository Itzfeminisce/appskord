import { agendaLine, SOURCE_LABEL } from '@/lib/memory/agenda';
import { APP_LABEL, clockOf, dayMonth, dueLabel, whenChip } from '@/lib/memory/brief';
import { BrandMark } from '../sidepanel/components/TopBar';
import { world } from '../sidepanel/components/v4/world';
import { useBrief } from '../sidepanel/screens/v4/briefData';
import { Face, Pill, QuestionMark } from '../sidepanel/screens/v4/briefParts';
import { openPanelOn } from './panel';
import './tab.css';

/** V4BriefTab: the brief in a tab, when Chrome would not open the side panel from the notification. */
export default function BriefTab() {
  const eventId = new URLSearchParams(location.search).get('event') ?? undefined;
  const [view] = useBrief(eventId);
  const now = world.now();
  const header = <header className="bt-head"><div className="brand"><BrandMark />Rekord</div></header>;
  if (!view.ready || !view.brief || !view.agenda) return <div className="bt-page">{header}</div>;
  const { brief, agenda, lastTime } = view;
  const { event } = brief;
  const when = whenChip(event, now);
  const app = event.app ? APP_LABEL[event.app] : undefined;
  const params = { eventId: event.id };
  return (
    <div className="bt-page">
      {header}
      <div className="bt-body">
        <div className="bt-title">
          <h1>{event.title}</h1>
          <Pill tone="promise">{when.label}{!when.soon && <span className="bp-chip-time">{clockOf(event.start)}</span>}</Pill>
          <span className="bt-meta">{app ? `${app} · ` : ''}<span className="bp-mono bp-muted">{clockOf(event.start)}</span></span>
        </div>
        <div className="bt-grid">
          <section aria-label="Who and last time" className="bt-card bt-left">
            <div className="bt-group">
              <h2 className="bp-h2">Who is coming</h2>
              {brief.who.map((w) => (
                <div key={w.email} className="bt-guest">
                  <Face name={w.name} known={w.known} />
                  <span className="bt-guest-name">{w.name}</span>
                  <span className="bt-guest-mail">{w.email}</span>
                </div>
              ))}
            </div>
            {brief.last && !!lastTime?.length && (
              <>
                <div className="bt-rule" />
                <div className="bt-group">
                  <h2 className="bp-h2">Last time · <span className="bp-mono">{dayMonth(brief.last.startedAt)}</span></h2>
                  <ul className="bt-last">{lastTime.map((l) => <li key={l}>{l}</li>)}</ul>
                </div>
              </>
            )}
          </section>
          <div className="bt-right">
            {brief.rows.length > 0 && (
              <section aria-label="Promises" className="bt-card bt-rows">
                <ul>
                  {brief.rows.map(({ item, label, kind }, n) => {
                    const due = kind === 'promise' ? dueLabel(item, now) : undefined;
                    return [
                      n > 0 && <li key={`${item.id}-rule`} aria-hidden="true" className="bt-row-rule" />,
                      <li key={item.id} className="bt-row">
                        <span className="bp-row-text">
                          <span className={kind === 'question' ? 'bp-row-label bp-row-label-q' : 'bp-row-label'}>{label}</span>
                          <span className="bp-row-title">{item.text}</span>
                        </span>
                        {kind === 'question' && <Pill tone="question"><QuestionMark />Question</Pill>}
                        {due && <Pill tone={due.tone === 'late' ? 'late' : due.tone === 'today' ? 'promise' : 'plain'}>{due.label}</Pill>}
                      </li>,
                    ];
                  })}
                </ul>
              </section>
            )}
            <section aria-labelledby="bt-agenda" className="bt-card bt-agenda">
              <div className="bt-agenda-head">
                <h2 id="bt-agenda" className="bp-h2">Suggested agenda</h2>
                <button type="button" className="bp-link bt-link" onClick={() => openPanelOn('agendaEdit', params)}>Edit agenda</button>
              </div>
              <ol>
                {agenda.items.map((a, n) => (
                  <li key={a.id}>
                    <span className="bp-num">{n + 1}</span>
                    <span className="bp-agenda-text">{a.text}</span>
                    <span className="bt-src">{SOURCE_LABEL[a.source]}</span>
                    <span className="bt-min">{a.minutes} min</span>
                  </li>
                ))}
              </ol>
              <div className="bt-total">{agendaLine(agenda)}</div>
            </section>
          </div>
        </div>
      </div>
      <footer className="bt-foot">
        <div className="bt-foot-text">
          <strong>Chrome did not open the side panel from the notification.</strong>
          <span>Click the Rekord icon in Chrome’s toolbar once, then press Record. Your agenda comes with you.</span>
        </div>
        <button type="button" className="bp-record bt-record" onClick={() => openPanelOn('tellPeople', params)}>
          <span className="bp-dot" />
          Record in the side panel
        </button>
      </footer>
    </div>
  );
}
