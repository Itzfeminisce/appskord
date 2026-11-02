import { useEffect, useState } from 'react';
import { LINEAR_HOSTS, requestHosts } from '@/lib/hosts';
import { loadKeys, mergeKeys } from '@/lib/penv';
import { LINEAR_KEY, LINEAR_KEYS_URL, LinearError, listTeams, savedTeam, saveTeam, type LinearDeps, type LinearTeam } from '@/lib/services/linear';
import { getSettings } from '@/lib/settings';
import { Spinner } from '../../components';
import { BackIcon } from '../../components/v4/icons';
import { useRouter } from '../../router';
import './after.css';

/** Set when the user pasted the Linear key, so Rekord never says a pasted key came from Penv Cloud. */
export const LINEAR_PASTED_KEY = 'rekord.linear.pasted';

type ConnectDeps = LinearDeps & { loadKeys?: () => Promise<Record<string, string>>; hasHosts?: () => Promise<boolean>; penvKeys?: () => Promise<boolean> };
/** Test and dev-frame hooks: Linear's fetch, where keys come from, and whether Chrome already allows Linear. */
export const linearConnectDeps: { current?: ConnectDeps } = {};
/** Dev frames: the frame's second state under the first, with its own hooks and the key already pasted and rejected. */
export const linearConnectDev: { board?: { label: string; deps: ConnectDeps; pasted: string } } = {};

const hasLinearHosts = () => browser.permissions.contains({ origins: LINEAR_HOSTS }).catch(() => false);
/** The key came from Penv Cloud: keys load from there and this one was not pasted. */
async function fromPenv(): Promise<boolean> {
  const [settings, stored] = await Promise.all([getSettings(), browser.storage.local.get(LINEAR_PASTED_KEY)]);
  return settings.keySource !== 'paste' && stored[LINEAR_PASTED_KEY] !== true;
}

const PASTE_DEBOUNCE_MS = 500;
/** The saved team if still there, else the only team; with several, none until the user picks. */
const pick = (teams: LinearTeam[], saved?: LinearTeam) => teams.find((t) => t.id === saved?.id)?.id ?? (teams.length === 1 ? teams[0]!.id : '');

/** V4LinearConnect: LINEAR_API_KEY from Penv Cloud first (its status only, never the key), a pasted key as the fallback. */
export default function LinearConnect() {
  const board = linearConnectDev.board;
  if (!board) return <Connect deps={linearConnectDeps.current ?? {}} />;
  return (
    <main className="lc-board">
      <section className="lc-board-part"><Connect deps={linearConnectDeps.current ?? {}} /></section>
      <div className="lc-board-label">{board.label}</div>
      <section className="lc-board-part"><Connect deps={board.deps} start={{ pasted: board.pasted, rejected: true }} /></section>
    </main>
  );
}

function Connect({ deps, start }: { deps: ConnectDeps; start?: { pasted: string; rejected: boolean } }) {
  const { back, canGoBack, replace } = useRouter();
  const [penvKey, setPenvKey] = useState('');
  const [how, setHow] = useState<'penv' | 'paste'>(start ? 'paste' : 'penv');
  const [pasted, setPasted] = useState(start?.pasted ?? '');
  const [teams, setTeams] = useState<LinearTeam[]>([]);
  const [teamId, setTeamId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rejected, setRejected] = useState(start?.rejected ?? false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const keys = await (deps.loadKeys ?? loadKeys)().catch(() => ({} as Record<string, string>));
      const key = keys[LINEAR_KEY]?.trim() ?? '';
      const penv = key && (await (deps.penvKeys ?? fromPenv)().catch(() => false));
      if (!alive) return;
      if (!penv) { setHow('paste'); return; }
      setPenvKey(key);
      // Teams load now only when Chrome already allows Linear; otherwise Connect asks first.
      if (!(await (deps.hasHosts ?? hasLinearHosts)())) return;
      const [found, saved] = await Promise.all([listTeams(key, deps).catch(() => []), savedTeam().catch(() => undefined)]);
      if (alive) { setTeams(found); setTeamId(pick(found, saved)); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A pasted key loads its teams once typing pauses (when Chrome already allows Linear), so the user picks the team.
  useEffect(() => {
    if (how !== 'paste' || !pasted.trim()) return;
    let alive = true;
    const timer = setTimeout(() => {
      void (async () => {
        if (!(await (deps.hasHosts ?? hasLinearHosts)())) return;
        const [found, saved] = await Promise.all([listTeams(pasted.trim(), deps).catch(() => []), savedTeam().catch(() => undefined)]);
        if (alive && found.length) { setTeams(found); setTeamId(pick(found, saved)); }
      })();
    }, PASTE_DEBOUNCE_MS);
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasted, how]);

  async function connect() {
    if (busy) return;
    setError('');
    setRejected(false);
    // Asked before any other await, so the click still counts as the gesture Chrome wants.
    const allowed = requestHosts(LINEAR_HOSTS);
    const key = how === 'paste' ? pasted.trim() : penvKey;
    if (!key) {
      setError(how === 'paste' ? 'Paste your Linear key to continue.' : 'Rekord didn’t find LINEAR_API_KEY in Penv Cloud. Paste a key instead.');
      return;
    }
    setBusy(true);
    if (!(await allowed)) {
      setError('Rekord needs your permission to reach Linear. Try again and choose Allow.');
      setBusy(false);
      return;
    }
    try {
      const list = how === 'penv' && teams.length ? teams : await listTeams(key, deps);
      if (list.length === 0) throw new LinearError('auth');
      const team = list.find((t) => t.id === teamId) ?? (list.length === 1 ? list[0] : undefined);
      if (!team) { setTeams(list); setTeamId(''); setBusy(false); return; } // the user picks the team, then connects
      if (how === 'paste') {
        await mergeKeys({ [LINEAR_KEY]: key });
        await browser.storage.local.set({ [LINEAR_PASTED_KEY]: true });
      } else {
        await browser.storage.local.remove(LINEAR_PASTED_KEY);
      }
      await saveTeam(team);
      if (canGoBack) back(); else replace('home');
    } catch (e) {
      if (e instanceof LinearError && e.code === 'auth') setRejected(true);
      else setError(e instanceof LinearError ? e.message : 'Linear didn’t connect. Try again in a moment.');
      setBusy(false);
    }
  }

  const keyField = (
    <>
      <input
        id="lc-key" className={rejected ? 'lc-key lc-bad' : 'lc-key'} type="text" aria-label={penvKey ? 'Linear API key' : undefined} placeholder="lin_api_…"
        autoComplete="off" spellCheck={false} aria-invalid={rejected || undefined} aria-describedby={rejected ? 'lc-key-error' : undefined}
        value={pasted} onChange={(e) => { setPasted(e.target.value); setRejected(false); }} onKeyDown={(e) => { if (e.key === 'Enter') void connect(); }}
      />
      {rejected && <p id="lc-key-error" role="alert" className="lc-error">Linear didn’t accept this key. Check it’s a personal API key, or create a new one.</p>}
    </>
  );

  return (
    <main className="af-page">
      <header className="af-head">
        <button type="button" className="af-back" aria-label="Back to connected apps" onClick={back}><BackIcon /></button>
      </header>
      <div className="lc-intro">
        <h1>Connect Linear</h1>
        <p>Send action items to Linear as issues. Your key stays in this browser.</p>
      </div>
      <div className="lc-body">
        {penvKey ? (
          <div role="radiogroup" aria-label="How to connect" className="lc-options">
            <label className={how === 'penv' ? 'lc-card lc-penv on' : 'lc-card lc-penv'}>
              <span className="lc-line">
                <input type="radio" name="how" checked={how === 'penv'} onChange={() => setHow('penv')} />
                <span aria-hidden="true" className="lc-radio" />
                <span className="lc-name">Use <span className="lc-mono">LINEAR_API_KEY</span> from Penv Cloud</span>
              </span>
              <span className="lc-found"><span className="lc-dot" />Found in Penv Cloud</span>
            </label>
            <div className={how === 'paste' ? 'lc-card on' : 'lc-card'}>
              <label className="lc-paste-label">
                <input type="radio" name="how" checked={how === 'paste'} onChange={() => setHow('paste')} />
                <span aria-hidden="true" className="lc-radio" />
                <span className="lc-paste-name">Paste a key instead</span>
              </label>
              {how === 'paste' && keyField}
              <a href={LINEAR_KEYS_URL} target="_blank" rel="noreferrer" className="lc-link">Create a key in Linear</a>
              {how === 'paste' && <span className="lc-hint lc-key-hint">Create one in Linear › Settings › Security &amp; access</span>}
            </div>
          </div>
        ) : (
          <div className="lc-card on lc-solo">
            <label htmlFor="lc-key" className="lc-solo-label">Linear API key</label>
            {keyField}
            <a href={LINEAR_KEYS_URL} target="_blank" rel="noreferrer" className="lc-link">Create a key in Linear</a>
            <span className="lc-hint">Create one in Linear › Settings › Security &amp; access</span>
          </div>
        )}
        {(penvKey || teams.length > 0) && <div className="lc-team">
          <label htmlFor="lc-team" className="af-label">Send issues to</label>
          <select id="lc-team" value={teamId} disabled={teams.length === 0} onChange={(e) => setTeamId(e.target.value)}>
            {teams.length > 1 && !teamId && <option value="" />}
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <span className="lc-hint">You can change the team each time you send.</span>
        </div>}
        {rejected && how === 'penv' && <p role="alert" className="lc-error">Linear didn’t accept this key. Check it’s a personal API key, or create a new one.</p>}
        {error && <p role="alert" className="af-alert">{error}</p>}
        <button type="button" className="af-primary lc-connect" onClick={() => void connect()} disabled={busy} aria-busy={busy || undefined}>
          {busy && <Spinner label="Connecting to Linear" size={16} />}
          Connect Linear
        </button>
      </div>
    </main>
  );
}
