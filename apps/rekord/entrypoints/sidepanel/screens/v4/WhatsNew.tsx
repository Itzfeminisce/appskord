import { useEffect, useState, type ReactNode } from 'react';
import { PROVIDERS } from '@appskord/llm';
import { listMeetings } from '@/lib/db';
import { requestBackfill } from '@/lib/memory/backfill';
import { getSettings, updateSettings } from '@/lib/settings';
import { markWhatsNewSeen } from '@/lib/whatsNew';
import { Header } from '../../components/v4/Header';
import { LockIcon } from '../../components/v4/icons';
import { useRouter } from '../../router';
import '../../components/v4/shell.css';
import './v4.css';

/** Rough time to build memory: about 15 seconds a meeting. */
export const backfillMinutes = (meetings: number) => Math.max(1, Math.round((meetings * 15) / 60));

const LINES: { title: string; text: (ai: string) => string; tone: string; icon: ReactNode }[] = [
  {
    title: 'Promises, decisions and people carry over',
    text: () => 'What you owe, what you were promised and what was decided, each with the quote that proves it.',
    tone: 'promise',
    icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12h13M12 6l6 6-6 6" /></svg>,
  },
  {
    title: 'A brief before each meeting',
    text: () => 'Open promises and past decisions with that person, ready when you start.',
    tone: 'decision',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2.5" /><path d="M9 4V3h6v1M9 11h6M9 15h4" /></svg>,
  },
  {
    title: 'Memory stays on this computer',
    text: (ai) => `Memory is kept on this computer. Building it sends transcript text only to your AI (${ai}).`,
    tone: 'local',
    icon: <LockIcon />,
  },
];

interface Offer { meetings: number; ai: string; ask: boolean }

export default function WhatsNew() {
  const { navigate, replace, has } = useRouter();
  const [offer, setOffer] = useState<Offer | null>(null);

  useEffect(() => {
    void markWhatsNewSeen(browser.runtime.getManifest().version).catch((error) => console.error('Rekord: could not save what’s new as seen', error));
    void Promise.all([getSettings(), listMeetings()])
      .then(([settings, meetings]) => setOffer({
        meetings: meetings.filter((m) => m.status === 'done').length,
        ai: PROVIDERS[settings.summary.provider].label,
        // Asked once: after Build memory or Not now the card stays away.
        ask: settings.memory.backfill === 'ask',
      }))
      .catch((error) => console.error('Rekord: could not load your meetings', error));
  }, []);

  const build = () => {
    void requestBackfill().catch((error) => console.error('Rekord: could not start building memory', error));
    navigate('backfill');
  };
  const notNow = async () => {
    try {
      const { memory } = await getSettings();
      await updateSettings({ memory: { ...memory, backfill: 'declined' } });
    } catch (error) {
      console.error('Rekord: could not save your choice', error);
    }
    replace('home');
  };
  const ledger: string = 'ledger';

  return (
    <div className="v4-shell">
      <Header loose />
      <div className="wn-head">
        <span className="wn-pill">New in this update</span>
        <h1 className="wn-title">Rekord now remembers</h1>
      </div>
      <ul className="wn-lines">
        {LINES.map((line) => (
          <li key={line.title}>
            <span className={`wn-icon wn-icon-${line.tone}`}>{line.icon}</span>
            <span className="wn-line">
              <span className="wn-line-title">{line.title}</span>
              <span className="wn-line-text">{line.text(offer?.ai ?? PROVIDERS.groq.label)}</span>
            </span>
          </li>
        ))}
      </ul>
      {offer?.ask && offer.meetings > 0 && (
        <section aria-label="Build memory" className="wn-card">
          <div className="wn-card-text">
            <h2>Build memory from your {offer.meetings} earlier meetings</h2>
            <p>Takes about {backfillMinutes(offer.meetings)} minutes. It runs on {offer.ai} with your key and keeps going in the background if you close Rekord.</p>
          </div>
          <div className="wn-actions">
            <button type="button" className="wn-build" onClick={build}>Build memory</button>
            <button type="button" className="wn-later" onClick={() => void notNow()}>Not now</button>
          </div>
          <span className="wn-once">Asked once. You can build it later from Settings.</span>
        </section>
      )}
      <button type="button" className="wn-ledger" aria-disabled={!has(ledger) || undefined} onClick={() => { if (has(ledger)) navigate(ledger); }}>
        <LockIcon size={14} />See what stays on this computer
      </button>
    </div>
  );
}
