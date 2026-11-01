import { devTools } from '../../lib/router';

/** Dev builds only: jump to any screen by frame name, and open the machine check. Never in the release zip. */
export function DevSwitcher<S extends string>({ names, current, go }: { names: readonly S[]; current: S; go: (s: S) => void }) {
  if (!devTools) return null;
  return (
    <div className="dev-switcher" data-dev-tools>
      <select aria-label="Screen" value={current} onChange={(e) => go(e.target.value as S)}>
        {names.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <a href={browser.runtime.getURL('/check.html')} target="_blank" rel="noreferrer">check</a>
    </div>
  );
}
