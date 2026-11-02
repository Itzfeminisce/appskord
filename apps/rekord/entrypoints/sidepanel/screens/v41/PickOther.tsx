import { useRef, useState } from 'react';
import type { SomethingElseForm } from '@/lib/catchup/types';
import { BackIcon } from '../../components/v4/icons';
import { world } from '../../components/v4/world';
import { useRouter, type RouteParams } from '../../router';
import './start.css';

export const LENGTHS: { label: string; minutes: number }[] = [
  { label: '15 min', minutes: 15 }, { label: '30 min', minutes: 30 }, { label: '45 min', minutes: 45 }, { label: '1 h', minutes: 60 },
  { label: '1 h 30 min', minutes: 90 }, { label: '2 h', minutes: 120 }, { label: '3 h', minutes: 180 }, { label: '4 h', minutes: 240 },
  { label: 'Longer', minutes: 360 },
];

export interface OtherErrors { name?: string; date?: string }
export const NAME_ERROR = 'Give the meeting a name, so you can find it later.';
export const DATE_ERROR = 'That date hasn’t happened yet. Pick the day the meeting took place.';

const pad = (n: number) => String(n).padStart(2, '0');
/** Local "YYYY-MM-DD". */
export const dayKey = (ms: number): string => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/** No name, or a date after today, stops the form (V41StatesMore). */
export function checkOther(form: Pick<SomethingElseForm, 'name' | 'date'>, now: number): OtherErrors {
  const errors: OtherErrors = {};
  if (!form.name.trim()) errors.name = NAME_ERROR;
  if (!form.date || form.date > dayKey(now)) errors.date = DATE_ERROR;
  return errors;
}

/** The route params Tell reads: attendees go in `who`, separated by "|"; an entry with "@" is an email, else a name. */
export function otherParams(form: SomethingElseForm): RouteParams {
  const who = form.attendees.map((a) => a.email ?? a.name ?? '').filter(Boolean).join('|');
  return { title: form.name.trim(), date: form.date, time: form.start, lengthMin: form.lengthMin, ...(who ? { who } : {}) };
}

/** A typed name or email as an attendee. */
export const toAttendee = (text: string): SomethingElseForm['attendees'][number] => (text.includes('@') ? { email: text } : { name: text });
const label = (a: { name?: string; email?: string }) => a.name ?? a.email ?? '';
const initials = (text: string) => text.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

const Warn = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17v.5" /></svg>
);

/** V41PickOther: the details of a meeting that is not on the calendar. */
export default function PickOther() {
  const { navigate, back, canGoBack, replace } = useRouter();
  const [name, setName] = useState('');
  const [date, setDate] = useState(() => dayKey(world.now()));
  const [start, setStart] = useState('09:00');
  const [lengthMin, setLength] = useState(60);
  const [attendees, setAttendees] = useState<SomethingElseForm['attendees']>([]);
  const [typed, setTyped] = useState('');
  const [errors, setErrors] = useState<OtherErrors>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  const addTyped = (): SomethingElseForm['attendees'] => {
    const text = typed.trim().replace(/,$/, '').trim();
    setTyped('');
    if (!text) return attendees;
    const next = [...attendees, toAttendee(text)];
    setAttendees(next);
    return next;
  };

  const submit = () => {
    const all = addTyped();
    const found = checkOther({ name, date }, world.now());
    setErrors(found);
    if (found.name) return nameRef.current?.focus();
    if (found.date) return dateRef.current?.focus();
    navigate('catchupTell', otherParams({ name, date, start, lengthMin, attendees: all }));
  };

  return (
    <div className="cu-screen">
      <header className="cu-head">
        <button type="button" className="v4-icon" aria-label="Back" onClick={() => (canGoBack ? back() : replace('catchupPick'))}><BackIcon /></button>
        <h1>Something else</h1>
      </header>
      <main className="cu-body cu-body-form">
        <p className="cu-lead">Tell Rekord a little about the meeting first.</p>
        <form className="cu-form" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
          <div className="cu-field">
            <label htmlFor="f-name">Name</label>
            <input id="f-name" ref={nameRef} type="text" className="cu-input" value={name} placeholder="For example, Lunch with Dana" autoComplete="off"
              aria-invalid={errors.name ? true : undefined} aria-describedby={errors.name ? 'f-name-msg' : undefined}
              onChange={(e) => { setName(e.target.value); if (errors.name) setErrors({ ...errors, name: undefined }); }} />
            {errors.name && <span id="f-name-msg" className="cu-err"><Warn />{errors.name}</span>}
          </div>
          <div className="cu-two">
            <div className="cu-field">
              <label htmlFor="f-date">Date</label>
              <input id="f-date" ref={dateRef} type="date" className="cu-input" value={date}
                aria-invalid={errors.date ? true : undefined} aria-describedby={errors.date ? 'f-date-msg' : undefined}
                onChange={(e) => { setDate(e.target.value); if (errors.date) setErrors({ ...errors, date: undefined }); }} />
            </div>
            <div className="cu-field">
              <label htmlFor="f-time">Start time</label>
              <input id="f-time" type="time" className="cu-input" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
          </div>
          {errors.date && <span id="f-date-msg" className="cu-err" style={{ marginTop: -6 }}><Warn />{errors.date}</span>}
          <div className="cu-field">
            <label htmlFor="f-len">Length</label>
            <select id="f-len" className="cu-input" value={lengthMin} onChange={(e) => setLength(Number(e.target.value))}>
              {LENGTHS.map((l) => <option key={l.minutes} value={l.minutes}>{l.label}</option>)}
            </select>
          </div>
          <div className="cu-field">
            <label htmlFor="f-who">Who was there</label>
            <div className="cu-chips">
              {attendees.map((a, i) => (
                <span key={`${label(a)}-${i}`} className="cu-chip">
                  <span className="cu-chip-av" aria-hidden="true">{initials(label(a))}</span>{label(a)}
                  <button type="button" aria-label={`Remove ${label(a)}`} onClick={() => setAttendees(attendees.filter((_, j) => j !== i))}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                  </button>
                </span>
              ))}
              <input id="f-who" type="text" value={typed} placeholder="Add a name or email" autoComplete="off" onChange={(e) => setTyped(e.target.value)} onBlur={() => { addTyped(); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && typed.trim()) { e.preventDefault(); addTyped(); }
                  else if (e.key === ',' ) { e.preventDefault(); addTyped(); }
                  else if (e.key === 'Backspace' && !typed && attendees.length) setAttendees(attendees.slice(0, -1));
                }} />
            </div>
            <span className="cu-hint">Names are matched to People. You count as there.</span>
          </div>
        </form>
      </main>
      <div className="cu-foot">
        <button type="button" className="cu-start" onClick={submit}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>Start telling
        </button>
      </div>
    </div>
  );
}
