import { devTools } from '../../lib/router';

const SHOT_KEY = 'motikord.shot';

/** `shot=1` (or `clean`) in the page query or after the hash hides the dev picker; `shot=0` shows it again; undefined leaves it as it was. */
export function shotFlag(search: string, hash: string): boolean | undefined {
  const q = [search.replace(/^\?/, ''), hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''].join('&');
  const p = new URLSearchParams(q);
  if (p.has('clean')) return true;
  const v = p.get('shot');
  return v === null ? undefined : v !== '0' && v !== 'false';
}

// Read once at load, before the router's `#/dev/<frame>` redirect drops the query; kept for this tab so it survives navigation.
let hidden = false;
if (devTools && typeof location !== 'undefined') {
  const asked = shotFlag(location.search, location.hash);
  try {
    if (asked !== undefined) sessionStorage.setItem(SHOT_KEY, asked ? '1' : '0');
    hidden = asked ?? sessionStorage.getItem(SHOT_KEY) === '1';
  } catch {
    hidden = asked ?? false;
  }
}

/** Dev builds only: jump to any screen by frame name, and open the machine check. Never in the release zip; hidden with `?shot=1`. */
export function DevSwitcher<S extends string>({ names, current, go }: { names: readonly S[]; current: S; go: (s: S) => void }) {
  if (!devTools || hidden) return null;
  return (
    <div className="dev-switcher" data-dev-tools>
      <select aria-label="Screen" value={current} onChange={(e) => go(e.target.value as S)}>
        {names.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <a href={browser.runtime.getURL('/check.html')} target="_blank" rel="noreferrer">check</a>
    </div>
  );
}
