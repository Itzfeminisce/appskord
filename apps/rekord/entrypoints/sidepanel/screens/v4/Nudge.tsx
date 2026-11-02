import { useCallback, useEffect, useRef, useState } from 'react';
import { clock } from '@/lib/calendar';
import { LLMError } from '@/lib/llm';
import { draftNudge, NUDGE_TONES, type NudgeInput, type NudgeTone } from '@/lib/memory/nudge';
import { tabOf } from '@/lib/memory/rank';
import { listItems } from '@/lib/memory/store';
import type { MemoryItem } from '@/lib/memory/types';
import { composeUrl } from '@/lib/services/gmail';
import { useCalendar } from '../../components/CalendarCard';
import { world } from '../../components/v4/world';
import { LoopsHome } from './Home';
import { counterpartId, dueChip, firstName, meetingLine, myName, nextMeetingWith } from './loops';
import { useSheetItem } from './Promise';
import { AgainIcon, CloseButton, MailIcon, QuoteBlock, Sheet, useCloseSheet, useMemoryView, type MemoryView } from './parts';

const TONE_LABEL: Record<NudgeTone, string> = { friendly: 'Friendly', short: 'Short', firm: 'Firm' };

/** Drafts kept for this session, so reopening a reminder does not ask the AI again. */
export const draftKey = (itemId: string, tone: NudgeTone) => `rekord.nudge.${itemId}.${tone}`;
async function savedDraft(key: string): Promise<string | undefined> {
  try { return (await browser.storage.session.get(key))[key] as string | undefined; } catch { return undefined; }
}
async function saveDraft(key: string, text: string) {
  try { await browser.storage.session.set({ [key]: text }); } catch { /* session storage missing: the draft lives in the screen */ }
}

function NudgeSheet({ item, view }: { item: MemoryItem; view: MemoryView }) {
  const close = useCloseSheet();
  const calendar = useCalendar();
  const person = view.people.get(counterpartId(item) ?? '');
  const name = person ? firstName(person.name) : '';
  const [tone, setTone] = useState<NudgeTone>('friendly');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const asked = useRef(0);
  const now = world.now();
  const events = world.events ?? (calendar.status === 'ready' ? calendar.events : []);
  const next = nextMeetingWith(person, events, now);

  const write = useCallback(async (t: NudgeTone, fresh: boolean) => {
    const key = draftKey(item.id, t);
    const run = ++asked.current;
    setError(undefined);
    const saved = fresh ? undefined : await savedDraft(key);
    if (saved !== undefined) { if (run === asked.current) setBody(saved); return; }
    setBusy(true);
    try {
      const chip = dueChip(item, now);
      const input: NudgeInput = {
        item, tone: t, toName: name || 'there',
        me: myName([item, ...(await listItems())]),
        madeIn: meetingLine(item.quote.meetingId, view.meetings),
        due: item.due ? chip.label.toLowerCase() : undefined,
        nextMeeting: next ? `today at ${clock(next.start)}` : undefined,
      };
      const text = await draftNudge(input);
      await saveDraft(key, text);
      if (run === asked.current) setBody(text);
    } catch (e) {
      if (run === asked.current) setError(e instanceof LLMError ? e.message : 'The AI service sent an unexpected reply. Try again.');
    } finally {
      if (run === asked.current) setBusy(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, name, next?.id, view.meetings]);

  useEffect(() => { void write(tone, false); }, [tone, write]);

  const to = person?.email ? [person.email] : [];
  const openGmail = () => {
    void browser.tabs.create({ url: composeUrl({ to, subject: item.text, body }) });
  };
  const copy = () => { void navigator.clipboard?.writeText(body).catch(() => undefined); };

  return (
    <Sheet label={`Remind ${name}`} onClose={close}>
      <div className="lp-sheet-head">
        <h1 className="lp-h1-nudge">{`Remind ${name} about ${item.text}`}</h1>
        <CloseButton onClose={close} />
      </div>
      <div>
        <div className="lp-field"><span>To</span><span className="lp-field-mono">{person?.email ?? ''}</span></div>
        <div className="lp-field"><span>Subject</span><span>{item.text}</span></div>
      </div>
      <QuoteBlock quote={item.quote} meetings={view.meetings} variant="compact" />
      <div className="lp-draft">
        <label htmlFor="lp-nudge-body">Draft, written from this quote</label>
        <textarea id="lp-nudge-body" rows={5} value={body} disabled={busy} aria-busy={busy || undefined} onChange={(e) => setBody(e.target.value)} />
        {error && <span role="alert" className="lp-error">{error}</span>}
      </div>
      <div className="lp-tone-row">
        <div role="group" aria-label="Tone" className="lp-pills">
          {NUDGE_TONES.map((t) => (
            <button key={t} type="button" className="lp-pill" aria-pressed={t === tone} onClick={() => setTone(t)}><span>{TONE_LABEL[t]}</span></button>
          ))}
        </div>
        <button type="button" className="lp-again" disabled={busy} onClick={() => void write(tone, true)}><AgainIcon />Write again</button>
      </div>
      <div className="lp-actions">
        <div className="lp-actions-grid lp-actions-grid-gmail">
          <button type="button" className="lp-primary" disabled={!body} onClick={openGmail}><MailIcon />Open in Gmail</button>
          <button type="button" className="lp-secondary lp-tall" disabled={!body} onClick={copy}>Copy text</button>
        </div>
        <p className="lp-note">Gmail opens with this draft. Rekord never sends email itself.</p>
      </div>
    </Sheet>
  );
}

export default function NudgeScreen() {
  const [item] = useSheetItem();
  const [view] = useMemoryView();
  return (
    <LoopsHome tab={item ? tabOf(item) : undefined} sheet>
      {item && view.ready && <NudgeSheet item={item} view={view} />}
    </LoopsHome>
  );
}
