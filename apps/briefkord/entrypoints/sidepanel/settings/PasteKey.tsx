/** Frame PasteKey: provider, masked key, "Check and save". Never shows a stored key; the field starts empty. */
import { useState } from 'react';
import { detectKey, PROVIDERS, providerForKey, verifyKey, type CloudProviderId, type ProviderKeyName, type Verdict } from '@appskord/llm';
import { AI_KEY_NAMES, AI_PROVIDERS, hostOf, keyNameOf, penv, requestHosts } from '@/lib/keys';
import { ChevronIcon, CloseIcon, Dialog, EyeIcon, EyeOffIcon, Spin } from './Dialog';
import { MARK } from './model';

type Check = { kind: 'idle' } | { kind: 'checking' } | { kind: 'failed'; verdict: Exclude<Verdict, 'ready'> };

export function PasteKey({ provider: first, onClose, onSaved }: { provider: CloudProviderId; onClose: () => void; onSaved: (provider: CloudProviderId) => void }) {
  const [provider, setProvider] = useState<CloudProviderId>(first);
  const [value, setValue] = useState('');
  const [shown, setShown] = useState(false);
  const [check, setCheck] = useState<Check>({ kind: 'idle' });
  const label = PROVIDERS[provider].label;

  const type = (next: string) => {
    setValue(next);
    setCheck({ kind: 'idle' });
    // A pasted key names its provider by its prefix.
    const name = detectKey(next, { names: AI_KEY_NAMES as ProviderKeyName[] });
    const found = name ? providerForKey(name) : undefined;
    if (found) setProvider(found);
  };

  const save = async () => {
    const p = provider;
    setCheck({ kind: 'checking' });
    try {
      const verdict = await verifyKey(keyNameOf(p) as ProviderKeyName, value, [hostOf(p)], {
        request: async (origins) => ((await requestHosts([...origins])) ? 'granted' : 'denied'),
        save: async (name, key) => void (await penv.connectPaste({ [name]: key })),
      });
      if (verdict === 'ready') {
        setValue('');
        onSaved(p);
        return;
      }
      setCheck({ kind: 'failed', verdict });
    } catch (error) {
      console.error('Briefkord: could not check the key', error instanceof Error ? error.name : 'error');
      setCheck({ kind: 'failed', verdict: 'unreachable' });
    }
  };

  return (
    <Dialog label="Paste a key" onClose={onClose}>
      <div className="st-dialog-body">
        <div className="st-dialog-top">
          <div className="st-lines" style={{ gap: 4 }}>
            <h2>Paste a key</h2>
            <p>For when you don’t use Penv Cloud.</p>
          </div>
          <button type="button" className="st-close" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="st-field">
          <label htmlFor="pk-provider" className="st-label">Provider</label>
          <div className="st-select">
            <span className="st-mark is-grey" aria-hidden="true">{MARK[provider]}</span>
            <span className="st-grow">{label}</span>
            <ChevronIcon />
            <select id="pk-provider" value={provider} onChange={(e) => { setProvider(e.target.value as CloudProviderId); setCheck({ kind: 'idle' }); }}>
              {AI_PROVIDERS.map((p) => (
                <option key={p} value={p}>{PROVIDERS[p].label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="st-field">
          <label htmlFor="pk-key" className="st-label">Key</label>
          <div className="st-key">
            <input
              id="pk-key"
              type={shown ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              value={value}
              autoFocus
              onChange={(e) => type(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && value.trim() && check.kind !== 'checking' && void save()}
            />
            <button type="button" aria-label={shown ? 'Hide key' : 'Show key'} onClick={() => setShown((s) => !s)}>
              {shown ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
          <a className="st-link" style={{ fontSize: 12.5 }} href={PROVIDERS[provider].keysUrl} target="_blank" rel="noreferrer">
            Get a key from {label}
          </a>
        </div>
        <div className="st-info">Briefkord checks the key with one small request, then keeps it in this browser session. It is cleared when Chrome closes and is never shown again.</div>
        {check.kind === 'checking' && (
          <div aria-busy="true" className="st-state is-busy">
            <Spin />
            Checking the key with {label}…
          </div>
        )}
        {check.kind === 'failed' && check.verdict === 'rejected' && (
          <div role="alert" className="st-state is-error">
            <strong>{label} refused this key</strong>
            <span>Check you copied all of it, or make a new one. Nothing was saved.</span>
          </div>
        )}
        {check.kind === 'failed' && check.verdict === 'denied' && (
          <div role="alert" className="st-state is-error">
            <strong>Briefkord can’t reach {label} yet</strong>
          </div>
        )}
        {check.kind === 'failed' && check.verdict === 'unreachable' && (
          <div role="alert" className="st-state is-error">
            <strong>{label} isn’t answering</strong>
          </div>
        )}
      </div>
      <footer className="st-dialog-foot">
        <button type="button" className="st-btn is-big" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="st-btn is-big is-primary" disabled={!value.trim() || check.kind === 'checking'} onClick={() => void save()}>
          Check and save
        </button>
      </footer>
    </Dialog>
  );
}
