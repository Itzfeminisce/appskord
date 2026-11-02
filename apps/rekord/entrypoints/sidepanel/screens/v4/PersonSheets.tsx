import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Person } from '@/lib/memory/types';
import { Avatar, type PeopleData } from './PeopleParts';
import { matchesSearch } from './peopleView';

const SearchIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
);

/** A bottom sheet over the person page; Escape and the scrim close it. */
function PersonSheet({ id, title, onClose, children }: { id: string; title: string; onClose: () => void; children: ReactNode }) {
  const focus = useCallback((el: HTMLElement | null) => el?.focus(), []);
  useEffect(() => {
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [onClose]);
  return (
    <>
      <div className="pf-scrim" onClick={onClose} aria-hidden="true" />
      <section role="dialog" aria-modal="true" aria-labelledby={id} className="pf-sheet ps-sheet" tabIndex={-1} ref={focus}>
        <span className="pf-grip" aria-hidden="true" />
        <h1 id={id}>{title}</h1>
        {children}
      </section>
    </>
  );
}

function Field({ id, label, type = 'text', value, onChange }: { id: string; label: string; type?: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="ps-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export interface PersonDetails { name: string; email?: string; company?: string }

/** V4PersonRename: name, email and company in one sheet. */
export function RenameSheet({ person, onSave, onClose }: { person: Person; onSave: (d: PersonDetails) => void; onClose: () => void }) {
  const [name, setName] = useState(person.name);
  const [email, setEmail] = useState(person.email ?? '');
  const [company, setCompany] = useState(person.company ?? '');
  const save = () => {
    if (!name.trim()) return;
    onSave({ name: name.trim(), email: email.trim() || undefined, company: company.trim() || undefined });
  };
  return (
    <PersonSheet id="ps-rename" title={`Rename ${person.name}`} onClose={onClose}>
      <form className="ps-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field id="ps-name" label="Name" value={name} onChange={setName} />
        <Field id="ps-email" label="Email" type="email" value={email} onChange={setEmail} />
        <Field id="ps-company" label="Company" value={company} onChange={setCompany} />
        <p className="ps-hint">Rekord uses this name in briefs, follow-ups and your Rekord folder.</p>
        <div className="ps-actions">
          <button type="submit" className="ps-primary" disabled={!name.trim()}>Save</button>
          <button type="button" className="ps-cancel" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </PersonSheet>
  );
}

/** Everyone else, most meetings first. */
export function pickList(person: Person, people: Person[], query: string): Person[] {
  return people.filter((p) => p.id !== person.id && matchesSearch(p, query))
    .sort((a, b) => b.meetingIds.length - a.meetingIds.length || a.name.localeCompare(b.name));
}

/** V4PersonPick: "Merge Sarah Chen with…" when Rekord has no suggestion. */
export function PickSheet({ person, data, picked: initial, onMerge, onClose }: {
  person: Person; data: PeopleData; picked?: string; onMerge: (other: Person) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(initial);
  const list = pickList(person, data.people, query);
  const other = data.people.find((p) => p.id === picked && p.id !== person.id);
  const line = (p: Person) => {
    if (p.email) return p.email;
    const first = data.meetings.find((m) => p.meetingIds.includes(m.id));
    return first ? `No email · guest in ${first.title}` : 'No email';
  };
  return (
    <PersonSheet id="ps-pick" title={`Merge ${person.name} with…`} onClose={onClose}>
      <div className="ps-search">
        <span className="ps-search-icon"><SearchIcon /></span>
        <input type="search" aria-label="Search people" placeholder="Search people" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div role="radiogroup" aria-label="People" className="ps-people">
        {list.map((p) => (
          <label key={p.id} htmlFor={`ps-p-${p.id}`} className={p.id === picked ? 'ps-person ps-person-on' : 'ps-person'}>
            <input id={`ps-p-${p.id}`} name="ps-person" type="radio" value={p.id} checked={p.id === picked} onChange={() => setPicked(p.id)} />
            <Avatar person={p} />
            <span className="ps-person-text"><span className="ps-person-name">{p.name}</span><span className="ps-person-line">{line(p)}</span></span>
            <span className="ps-person-count">{`${p.meetingIds.length} ${p.meetingIds.length === 1 ? 'meeting' : 'meetings'}`}</span>
          </label>
        ))}
      </div>
      <p className="ps-hint">{`Their meetings, promises and decisions move to ${person.name}. You can split them out again.`}</p>
      <div className="ps-actions">
        <button type="button" className="ps-primary" disabled={!other} onClick={() => { if (other) onMerge(other); }}>{`Merge into ${person.name}`}</button>
        <button type="button" className="ps-cancel" onClick={onClose}>Cancel</button>
      </div>
    </PersonSheet>
  );
}
