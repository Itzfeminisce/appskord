import { useEffect, useState, type KeyboardEvent } from 'react';
import { agendaMinutes, eventMinutes, moveItem } from '@/lib/memory/agenda';
import { clockOf, weekdayDate } from '@/lib/memory/brief';
import type { Agenda, AgendaItem } from '@/lib/memory/types';
import { useRouter } from '../../router';
import { saveAgenda, useBrief } from './briefData';
import { BackHeader, GripIcon, PlusIcon, RecordButton, RemoveIcon, SourceTag } from './briefParts';
import '../../components/v4/shell.css';

/** V4AgendaEdit: reorder, set minutes, remove and add items; "Use this agenda" saves it in `agendas`. */
export default function AgendaEdit() {
  const { route, back, canGoBack, replace } = useRouter();
  const [view] = useBrief(route.params.eventId);
  const [items, setItems] = useState<AgendaItem[] | undefined>();
  const [dragging, setDragging] = useState<number | undefined>();
  const [fresh, setFresh] = useState<string[]>([]);
  useEffect(() => { if (view.agenda && !items) setItems(view.agenda.items); }, [view.agenda, items]);

  const leave = () => (canGoBack ? back() : replace('brief', route.params.eventId ? { eventId: route.params.eventId } : {}));
  const event = view.brief?.event;
  if (!view.ready || !event || !view.agenda || !items) {
    return <div className="bp-screen"><BackHeader label="Back to brief" onBack={leave} /></div>;
  }
  const total = view.agenda.totalMinutes || eventMinutes(event);
  const used = agendaMinutes(items);
  const update = (id: string, patch: Partial<AgendaItem>) => setItems(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const add = () => {
    const id = `a-you-${crypto.randomUUID()}`;
    setFresh([...fresh, id]);
    setItems([...items, { id, text: '', source: 'you', minutes: 5 }]);
  };
  const onGripKey = (e: KeyboardEvent, n: number) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      setItems(moveItem(items, n, e.key === 'ArrowUp' ? n - 1 : n + 1));
    }
  };
  const use = () => {
    const agenda: Agenda = { meetingKey: event.id, totalMinutes: total, items: items.filter((i) => i.text.trim()).map((i) => ({ ...i, text: i.text.trim() })) };
    void saveAgenda(agenda).then(leave, (error) => console.error('Rekord: could not save the agenda', error));
  };

  return (
    <div className="bp-screen">
      <BackHeader label="Back to brief" onBack={leave} />
      <main className="bp-main bp-main-edit">
        <div className="ae-title">
          <h1>Edit agenda</h1>
          <span>{`${event.title} · ${weekdayDate(event.start)} · ${clockOf(event.start)} · `}<span className="bp-mono">{eventMinutes(event)} min</span></span>
        </div>
        <ol aria-label="Agenda" className="ae-list">
          {items.map((item, n) => (
            <li
              key={item.id} className={dragging === n ? 'ae-item ae-item-drag' : 'ae-item'}
              onDragOver={(e) => { e.preventDefault(); if (dragging !== undefined && dragging !== n) { setItems(moveItem(items, dragging, n)); setDragging(n); } }}
              onDrop={(e) => { e.preventDefault(); setDragging(undefined); }}
            >
              <button
                type="button" className="ae-grip" aria-label="Drag to reorder" draggable
                onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragging(n); }}
                onDragEnd={() => setDragging(undefined)}
                onKeyDown={(e) => onGripKey(e, n)}
              >
                <GripIcon />
              </button>
              <span className="ae-text">
                {fresh.includes(item.id)
                  ? <input aria-label="Add item" value={item.text} autoFocus onChange={(e) => update(item.id, { text: e.target.value })} />
                  : <span>{item.text}</span>}
                <SourceTag source={item.source} />
              </span>
              <label className="ae-min">
                <input
                  type="number" min={1} value={item.minutes} aria-label={`Minutes for ${item.text || 'new item'}`}
                  onChange={(e) => update(item.id, { minutes: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
                />
                min
              </label>
              <button type="button" className="ae-remove" aria-label={`Remove ${item.text || 'new item'}`} onClick={() => setItems(items.filter((i) => i.id !== item.id))}>
                <RemoveIcon />
              </button>
            </li>
          ))}
        </ol>
        <div className="ae-bottom">
          <button type="button" className="ae-add" onClick={add}><PlusIcon />Add item</button>
          <div className="ae-total">
            <span>{`${used} of ${total} min`}</span>
            <span aria-hidden="true" className={used > total ? 'ae-bar ae-bar-over' : 'ae-bar'}>
              <span style={{ width: `${total ? Math.min(100, Math.round((used / total) * 100)) : 0}%` }} />
            </span>
          </div>
        </div>
      </main>
      <footer className="bp-foot bp-foot-tall">
        <RecordButton tall dot={false} label="Use this agenda" onClick={use} />
      </footer>
    </div>
  );
}
