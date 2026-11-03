/** Settings: "AI and keys", "Sharing", "Storage", "Where your data goes". `?show=` names the part to open. */
import { useEffect, useState } from 'react';
import '@appskord/ui/ModelPicker.css';
import { BackIcon } from '../icons';
import { useGo } from '../ui';
import { AiKeys } from './AiKeys';
import { partFor, PARTS, type SettingsPart } from './model';
import { Privacy } from './Privacy';
import { Sharing } from './Sharing';
import { Storage } from './Storage';
import './settings.css';

export function Settings({ show }: { show?: string }) {
  const go = useGo();
  const [part, setPart] = useState<SettingsPart>(() => partFor(show));
  useEffect(() => setPart(partFor(show)), [show]);

  return (
    <div className="st">
      <header className="st-head">
        <button type="button" className="st-back" aria-label="Back" onClick={() => go('/')}>
          <BackIcon />
        </button>
        <h1>Settings</h1>
      </header>
      <div className="st-body">
        <nav aria-label="Settings sections" className="st-nav">
          {PARTS.map((p) => (
            <button key={p.id} type="button" aria-current={p.id === part ? 'page' : undefined} onClick={() => setPart(p.id)}>
              {p.label}
            </button>
          ))}
        </nav>
        {part === 'ai' && <AiKeys />}
        {part === 'sharing' && <Sharing />}
        {part === 'storage' && <Storage />}
        {part === 'privacy' && <Privacy />}
      </div>
    </div>
  );
}
