import { useCallback, useEffect, useState } from 'react';
import { planForget } from '@/lib/memory/link';
import { removePersonFiles } from '@/lib/folder';
import { forgetPerson } from '@/lib/memory/store';
import { canRedactPerson, redactPerson } from '@/lib/redact';
import { getSettings } from '@/lib/settings';
import { world } from '../../components/v4/world';
import { useRouter } from '../../router';
import { PersonPage } from './Person';
import { peopleFlash, refreshBadge, usePeopleData } from './PeopleParts';
import { firstName } from './peopleView';

/** V4Forget: what forgetting a person removes, over their page; nothing goes until "Forget". */
export default function Forget() {
  const { route, back, replace } = useRouter();
  const [data, reload] = usePeopleData();
  const [folder, setFolder] = useState(false);
  const [redact, setRedact] = useState(false);
  const [busy, setBusy] = useState(false);
  const person = data?.people.find((p) => p.id === route.params.personId);
  const focusSheet = useCallback((el: HTMLElement | null) => el?.focus(), []);

  useEffect(() => {
    getSettings().then((s) => setFolder(s.memory.folder)).catch(() => undefined);
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') back(); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [back]);
  useEffect(() => { if (data && !person) back(); }, [data, person, back]);
  if (!data || !person) return <div className="pp-page" />;

  const now = world.now();
  const first = firstName(person.name);
  const plan = planForget(person.id, data.items, now);

  const forget = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Redaction reads the person's names, so it runs before they are gone.
      if (redact && canRedactPerson) await redactPerson(person.id, { now: world.now() });
      await forgetPerson(person.id, world.now());
      if (folder) await removePersonFiles([person.id]);
      refreshBadge();
      peopleFlash.message = `${first} is forgotten.`;
      replace('people');
    } catch (error) {
      console.error('Rekord: could not forget the person', error);
      setBusy(false);
    }
  };

  return (
    <div className="pp-page pf-host">
      <PersonPage person={person} data={data} onChanged={reload} inert />
      <div className="pf-scrim" onClick={() => back()} aria-hidden="true" />
      <section role="dialog" aria-modal="true" aria-labelledby="pf-title" className="pf-sheet" tabIndex={-1} ref={focusSheet}>
        <span className="pf-grip" aria-hidden="true" />
        <h1 id="pf-title">Forget {person.name}?</h1>
        <div className="pf-gone">
          <ul>
            <li><span className="pf-dot" />{first}’s person page</li>
            {plan.promises > 0 && <li><span className="pf-dot" /><span><span className="pp-mono">{plan.promises}</span> promises</span></li>}
            {plan.decisionLinks > 0 && <li><span className="pf-dot" /><span><span className="pp-mono">{plan.decisionLinks}</span> decision links</span></li>}
            <li><span className="pf-dot" />Search entries</li>
            {folder && <li><span className="pf-dot" />The People file in the Rekord folder</li>}
          </ul>
        </div>
        <label htmlFor="pf-redact" className="pf-redact">
          <input id="pf-redact" type="checkbox" checked={redact} disabled={!canRedactPerson} onChange={(e) => setRedact(e.target.checked)} />
          <span>{`Also redact ${first}’s words from `}<span className="pp-mono">{person.meetingIds.length}</span> meetings’ transcripts and audio</span>
        </label>
        <div className="pf-actions">
          <button type="button" className="pf-forget" disabled={busy} onClick={() => void forget()}>{`Forget ${first}`}</button>
          <button type="button" className="pf-keep" onClick={() => back()}>Keep</button>
        </div>
      </section>
    </div>
  );
}
