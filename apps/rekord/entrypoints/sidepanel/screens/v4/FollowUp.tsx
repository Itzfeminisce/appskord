import { useEffect, useState } from 'react';
import { getMeeting } from '@/lib/db';
import { record } from '@/lib/ledger';
import { itemsForMeeting, listItems, listPeople } from '@/lib/memory/store';
import { bodyTooLong, composeUrl } from '@/lib/services/gmail';
import {
  draftFollowUp, followUpFacts, GMAIL_LEDGER_WHAT, plainDraft,
  type FollowUpDeps, type FollowUpFacts, type FollowUpLength, type Recipient,
} from '@/lib/services/followUp';
import { Spinner } from '../../components';
import { BackIcon } from '../../components/v4/icons';
import { world } from '../../components/v4/world';
import { useRouter } from '../../router';
import './after.css';

/** Test and dev-frame hook: the AI's fetch and config. */
export const followUpDeps: { current?: FollowUpDeps } = {};
/** AI drafts for this panel session, by `<meetingId>:<length>`, so switching length or coming back does not ask again. */
export const followUpSession: { drafts: Record<string, string> } = { drafts: {} };

const XIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>
);

/** V4FollowUp: the AI's follow-up email, for the user to check, open in Gmail or copy. Rekord never sends it. */
export default function FollowUp() {
  const { route, back } = useRouter();
  const meetingId = route.params.meetingId ?? '';
  const [facts, setFacts] = useState<FollowUpFacts>();
  const [title, setTitle] = useState('');
  const [to, setTo] = useState<Recipient[]>([]);
  const [adding, setAdding] = useState(false);
  const [address, setAddress] = useState('');
  const [subject, setSubject] = useState('');
  const [length, setLength] = useState<FollowUpLength>('full');
  const [body, setBody] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    Promise.all([getMeeting(meetingId), itemsForMeeting(meetingId), listPeople(), listItems()])
      .then(([meeting, items, people, all]) => {
        if (!alive || !meeting) return;
        const f = followUpFacts(meeting, items, people, { now: world.now(), events: world.events, earlier: all });
        setFacts(f); setTitle(meeting.title); setTo(f.recipients); setSubject(f.subject);
      })
      .catch((e) => console.error('Rekord: could not load the follow-up', e));
    return () => { alive = false; };
  }, [meetingId]);

  useEffect(() => {
    if (!facts) return;
    const key = `${meetingId}:${length}`;
    const cached = followUpSession.drafts[key];
    if (cached) { setBody(cached); setError(''); return; }
    let alive = true;
    setDrafting(true); setError(''); setBody('');
    draftFollowUp(facts, length, followUpDeps.current)
      .then((text) => { followUpSession.drafts[key] = text; if (alive) setBody(text); })
      .catch((e: unknown) => {
        if (!alive) return;
        // The plain draft keeps every fact, so the user can still send it.
        setBody(plainDraft(facts, length));
        setError(e instanceof Error ? e.message : 'The AI service sent an unexpected reply. Try again.');
      })
      .finally(() => alive && setDrafting(false));
    return () => { alive = false; };
  }, [facts, length, meetingId]);

  const addRecipient = () => {
    const email = address.trim();
    if (email.includes('@') && !to.some((r) => r.email.toLowerCase() === email.toLowerCase())) setTo([...to, { name: email, email }]);
    setAddress(''); setAdding(false);
  };

  const draft = { to: to.map((r) => r.email), subject, body };
  const gmail = composeUrl(draft);

  return (
    <main className="af-page">
      <header className="af-head">
        <button type="button" className="af-back" aria-label="Back to meetings" onClick={back}><BackIcon /></button>
      </header>
      <div className="af-body af-gap14">
        <h1>Follow-up for {title}</h1>
        <div className="af-field">
          <span className="af-label">To</span>
          <div className="fu-to">
            {to.map((r) => (
              <span key={r.email} className="fu-chip">{r.name}
                <button type="button" aria-label={`Remove ${r.name}`} onClick={() => setTo(to.filter((x) => x.email !== r.email))}><XIcon /></button>
              </span>
            ))}
            {adding ? (
              <input
                className="fu-add-input" type="email" aria-label="Add" autoFocus value={address}
                onChange={(e) => setAddress(e.target.value)} onBlur={addRecipient}
                onKeyDown={(e) => { if (e.key === 'Enter') addRecipient(); if (e.key === 'Escape') { setAddress(''); setAdding(false); } }}
              />
            ) : (
              <button type="button" className="fu-add" onClick={() => setAdding(true)}>Add</button>
            )}
          </div>
        </div>
        <div className="af-field">
          <label htmlFor="fu-sub" className="af-label">Subject</label>
          <input id="fu-sub" type="text" className="af-input" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div className="af-field">
          <div className="fu-msg-top">
            <label htmlFor="fu-body" className="af-label">Message</label>
            <div role="radiogroup" aria-label="Length" className="af-seg">
              {(['short', 'full'] as const).map((l) => (
                <button key={l} type="button" role="radio" aria-checked={length === l} onClick={() => setLength(l)}>{l === 'short' ? 'Short' : 'Full'}</button>
              ))}
            </div>
          </div>
          <div className="fu-text">
            <textarea id="fu-body" rows={8} value={body} readOnly={drafting} aria-busy={drafting || undefined} onChange={(e) => setBody(e.target.value)} />
            {drafting && <span className="fu-spin"><Spinner label="Drafting" size={18} /></span>}
          </div>
        </div>
        {error && <p role="alert" className="af-alert">{error}</p>}
        <div className="fu-actions">
          <div className="fu-row">
            <a
              href={gmail} target="_blank" rel="noreferrer" className="fu-gmail" aria-disabled={drafting || undefined}
              onClick={(e) => {
                if (drafting) { e.preventDefault(); return; }
                if (bodyTooLong(draft)) navigator.clipboard.writeText(body).catch((err) => console.error('Rekord: could not copy the email', err));
                void record({ meetingId, service: 'gmail', what: GMAIL_LEDGER_WHAT }).catch((err) => console.error('Rekord: could not record the Gmail draft', err));
              }}
            >Open in Gmail</a>
            <button type="button" className="fu-copy" onClick={() => { navigator.clipboard.writeText(body).catch((e) => console.error('Rekord: could not copy the email', e)); }}>Copy text</button>
          </div>
          <p className="fu-note">Gmail opens a new email with this text. Nothing is sent until you send it.</p>
        </div>
      </div>
    </main>
  );
}
