/** Frame PenvConnect: penv-start, penv-waiting, penv-connected, penv-failed, penv-no-keys. */
import { useRef, useState } from 'react';
import { PROVIDERS, providerForKey } from '@appskord/llm';
import { AI_KEY_NAMES, penv, requestHosts, savePenvConnection, type PenvAppConnection } from '@/lib/keys';
import { PENV_HOSTS } from '@/lib/hosts';
import { Dialog, SmallCheck, Spin } from './Dialog';
import { MARK } from './model';

export type PenvState = 'start' | 'waiting' | 'connected' | 'failed' | 'no-keys';

const PENV_CLOUD_URL = 'https://penv.cloud';

export function PenvConnect({ first, keyNames, onClose, onPaste, onChange }: {
  first: PenvState;
  /** AI key names in memory now. */
  keyNames: string[];
  onClose: () => void;
  onPaste: () => void;
  onChange: (conn: PenvAppConnection | undefined) => void;
}) {
  const [state, setState] = useState<PenvState>(first);
  // Only the newest attempt may change the state; Cancel and "Open the tab again" start a new one.
  const attempt = useRef(0);

  const connect = async () => {
    const mine = ++attempt.current;
    setState('waiting');
    // First await keeps the click's gesture for Chrome's prompt.
    await requestHosts(PENV_HOSTS);
    try {
      const conn = await penv.connectPenvApp({ keys: penv.connectKeyNames(AI_KEY_NAMES) });
      if (mine !== attempt.current) return;
      await savePenvConnection(conn);
      onChange(conn);
      const names = (await penv.loadPenvAppKeys(conn)) ?? [];
      if (mine !== attempt.current) return;
      setState(names.some((n) => AI_KEY_NAMES.includes(n)) ? 'connected' : 'no-keys');
    } catch (error) {
      if (mine !== attempt.current) return;
      console.error('Briefkord: could not connect Penv Cloud', error instanceof Error ? error.name : 'error');
      setState('failed');
    }
  };

  const cancel = () => {
    attempt.current++;
    setState('start');
  };

  const disconnect = async () => {
    attempt.current++;
    try {
      await penv.disconnectPenvApp();
    } catch (error) {
      console.error('Briefkord: could not disconnect Penv Cloud', error instanceof Error ? error.name : 'error');
    }
    await savePenvConnection(undefined);
    onChange(undefined);
    setState('start');
  };

  const providers = keyNames.flatMap((name) => providerForKey(name) ?? []);

  return (
    <Dialog label="Connect Penv Cloud" wide={false} onClose={onClose}>
      {state === 'start' && (
        <div className="st-penv">
          <span className="st-mark is-big" aria-hidden="true">pv</span>
          <span className="st-penv-title">Connect Penv Cloud</span>
          <span className="st-penv-text">Keep your AI keys in one place. Briefkord fetches only the keys it needs, for this session.</span>
          <span className="st-penv-text">A Penv Cloud tab opens. Sign in there, then come back.</span>
          <button type="button" autoFocus className="st-btn is-primary is-wide" onClick={() => void connect()}>
            Connect Penv Cloud
          </button>
          <button type="button" className="st-btn is-full" onClick={onPaste}>
            Paste a key instead
          </button>
        </div>
      )}
      {state === 'waiting' && (
        <div aria-busy="true" className="st-penv is-waiting">
          <Spin size={26} />
          <span className="st-penv-title" style={{ fontSize: 15 }}>Waiting for Penv Cloud…</span>
          <span className="st-penv-text">Finish signing in on the Penv Cloud tab. This page updates by itself.</span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="st-btn" style={{ height: 36 }} onClick={() => void connect()}>
              Open the tab again
            </button>
            <button type="button" className="st-btn is-quiet" style={{ height: 36 }} onClick={cancel}>
              Cancel
            </button>
          </span>
        </div>
      )}
      {state === 'connected' && (
        <div className="st-penv">
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="st-check" aria-hidden="true">
              <SmallCheck />
            </span>
            <span className="st-penv-title" style={{ fontSize: 15 }}>Penv Cloud connected</span>
          </span>
          <span className="st-penv-text">Keys Briefkord can use:</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {providers.map((p) => (
              <span key={p} className="st-key-row">
                <span className="st-mark is-light" aria-hidden="true">{MARK[p]}</span>
                <span className="st-grow">{PROVIDERS[p].label}</span>
                <span className="st-ready">Ready</span>
              </span>
            ))}
          </div>
          <span className="st-muted" style={{ fontSize: 12.5 }}>Add or remove keys in Penv Cloud. They show here the next time you open this page.</span>
          <span className="st-pair">
            <button type="button" autoFocus className="st-btn is-primary is-full" onClick={onClose}>
              Done
            </button>
            <button type="button" className="st-btn is-full is-danger-text" onClick={() => void disconnect()}>
              Disconnect
            </button>
          </span>
        </div>
      )}
      {state === 'failed' && (
        <div className="st-penv">
          <div role="alert" className="st-state is-error is-big">
            <strong>Penv Cloud didn’t connect</strong>
            <span>The sign-in was closed or timed out. Nothing was saved.</span>
            <span className="st-state-actions">
              <button type="button" className="st-btn" onClick={() => void connect()}>
                Try again
              </button>
              <button type="button" className="st-btn" onClick={onPaste}>
                Paste a key instead
              </button>
            </span>
          </div>
        </div>
      )}
      {state === 'no-keys' && (
        <div className="st-penv">
          <div role="alert" className="st-state is-warn is-big">
            <strong>Penv Cloud has no AI keys yet</strong>
            <span>Add a key for any provider there, then open this page again.</span>
            <a className="st-btn st-start" href={PENV_CLOUD_URL} target="_blank" rel="noreferrer">
              Open Penv Cloud
            </a>
          </div>
        </div>
      )}
    </Dialog>
  );
}
