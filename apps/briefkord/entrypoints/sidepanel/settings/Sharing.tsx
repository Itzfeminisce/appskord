/** Frame SettingsSharing: the name on shared files and the starting choices for Share. */
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '@/lib/store/settings';

const save = (patch: Partial<Settings>) => void saveSettings(patch).catch((error: unknown) => console.error('Briefkord: could not save the sharing settings', error));

export function Sharing() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [name, setName] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    loadSettings().then(
      (loaded) => {
        setS(loaded);
        setName(loaded.sharingName);
      },
      (error: unknown) => console.error('Briefkord: could not load the sharing settings', error),
    );
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  const typeName = (next: string) => {
    setName(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save({ sharingName: next.trim() }), 300);
  };
  const toggle = (patch: Partial<Settings>) => {
    setS((prev) => ({ ...prev, ...patch }));
    save(patch);
  };

  return (
    <main className="st-main is-narrow">
      <h2 className="st-h2">Sharing</h2>
      <section className="st-card" style={{ gap: 8 }}>
        <label htmlFor="share-name" className="st-h4">Your name on files you share</label>
        <input
          id="share-name"
          type="text"
          className="st-input"
          placeholder="For example: Sam"
          value={name}
          onChange={(e) => typeName(e.target.value)}
          onBlur={() => {
            clearTimeout(timer.current);
            save({ sharingName: name.trim() });
          }}
        />
        <span className="st-note">When a teammate imports your edit file, the board says “from” this name. Leave it empty and it says “from a teammate”. It is stored only in the file.</span>
      </section>
      <section className="st-card" style={{ gap: 14 }}>
        <h3 className="st-h4">Starting choices in Share</h3>
        <label className="st-toggle">
          <span className="st-lines" style={{ gap: 2 }}>
            <strong>Include my notes</strong>
            <span>“What to say about it” on each card.</span>
          </span>
          <input type="checkbox" role="switch" checked={s.includeNotes} onChange={(e) => toggle({ includeNotes: e.target.checked })} />
        </label>
        <label className="st-toggle">
          <span className="st-lines" style={{ gap: 2 }}>
            <strong>Include saved page text</strong>
            <span>Lets search and summaries work for the teammate.</span>
          </span>
          <input type="checkbox" role="switch" checked={s.includePageText} onChange={(e) => toggle({ includePageText: e.target.checked })} />
        </label>
        <span className="st-muted">You can still change both each time you share.</span>
      </section>
    </main>
  );
}
