import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

export type PickerStatus = 'ready' | 'needs-key' | 'key-refused' | 'local' | 'loading' | 'failed';

export interface PickerOption {
  id: string;
  /** Shown instead of the id (local models such as “Chrome’s built-in AI”). */
  name?: string;
  /** A tag from the frames: “Recommended”, “Fastest”, “Your choice”… */
  tag?: string;
}

export interface PickerGroup {
  id: string;
  name: string;
  status: PickerStatus;
  /** Two letters on the button; a local group shows the laptop icon instead. */
  mark?: string;
  models: PickerOption[];
  /** The key row of a needs-key group: “Add an Anthropic key”. */
  addKeyLabel?: string;
  /** Other words the search finds this provider by (“claude” for Anthropic). */
  aliases?: string[];
  /** A muted line under the group's models (“Ollama isn’t running. Start it, then open this list again.”). */
  note?: string;
}

export interface PickerValue {
  provider: string;
  model: string;
}

export interface ModelPickerProps {
  label: string;
  groups: PickerGroup[];
  value: PickerValue;
  foot: string;
  /** `typed` is true when the model came from the “Use …” row. */
  onPick: (value: PickerValue, typed: boolean) => void;
  /** Opens the Keys section; no provider for “Paste a key instead”. */
  onAddKey: (provider?: string) => void;
  onRetry: (provider: string) => void;
  /** Called each time the list opens, so the app can load the lists. */
  onOpen?: () => void;
  /** The provider a typed model name goes to; defaults to the current one. */
  typedProvider?: string;
  /** Set when the saved model is gone and the app picked `value.model` instead. */
  gone?: { old: string; app: string };
  /** Shows “Connect Penv Cloud” when no cloud provider has a key. */
  onConnectCloud?: () => void;
}

const STATUS: Record<PickerStatus, string> = {
  ready: 'Ready',
  'needs-key': 'Needs a key',
  'key-refused': 'Key refused',
  local: 'Nothing is sent',
  loading: 'Getting the list…',
  failed: 'Ready',
};

const orList = (names: string[]) =>
  names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;

function Laptop() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="5" width="16" height="11" rx="2" />
      <path d="M2 19h20" />
    </svg>
  );
}

export function ModelPicker({
  label,
  groups,
  value,
  foot,
  onPick,
  onAddKey,
  onRetry,
  onOpen,
  typedProvider,
  gone,
  onConnectCloud,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const uid = useId();
  const listId = `${uid}-list`;

  const current = groups.find((g) => g.id === value.provider);
  const currentModel = current?.models.find((m) => m.id === value.model);
  const local = current?.status === 'local';
  const line2 = local
    ? 'On this computer · nothing is sent'
    : `${current?.name ?? value.provider} · ${gone ? 'picked for you' : current ? STATUS[current.status] : ''}`;

  const close = (refocus: boolean) => {
    setOpen(false);
    setQuery('');
    if (refocus) button.current?.focus();
  };
  const show = () => {
    setOpen(true);
    setQuery('');
    setActive(0);
    onOpen?.();
  };

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const outside = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);

  const q = query.trim();
  const ql = q.toLowerCase();
  const providerHit = (g: PickerGroup) =>
    g.name.toLowerCase().includes(ql) || (g.aliases ?? []).some((a) => a.toLowerCase().includes(ql));
  const cloud = groups.filter((g) => g.status !== 'local');
  const noKeys = cloud.length > 0 && cloud.every((g) => g.status === 'needs-key');
  const shown = groups
    .filter((g) => !(noKeys && !ql && g.status === 'needs-key'))
    .map((g) => {
      const hit = !ql || providerHit(g);
      const models =
        g.status === 'loading' || g.status === 'key-refused' || g.status === 'needs-key'
          ? []
          : g.models.filter((m) => hit || m.id.toLowerCase().includes(ql) || (m.name ?? '').toLowerCase().includes(ql));
      const keyRow = (g.status === 'needs-key' || g.status === 'key-refused') && hit;
      const visible = models.length > 0 || keyRow || (hit && (g.status === 'loading' || !!g.note));
      return { g, models, keyRow, visible };
    })
    .filter((s) => s.visible);
  const typedGroup = groups.find((g) => g.id === (typedProvider ?? value.provider));
  const noMatch = !!ql && shown.length === 0;
  const typedRow = noMatch && typedGroup && typedGroup.status !== 'local' ? typedGroup : undefined;

  const options: { key: string; pick: () => void }[] = [];
  for (const s of shown)
    for (const m of s.models)
      options.push({ key: `${s.g.id}|${m.id}`, pick: () => pick({ provider: s.g.id, model: m.id }, false) });
  if (typedRow) options.push({ key: 'typed', pick: () => pick({ provider: typedRow.id, model: q }, true) });
  const at = Math.min(active, Math.max(options.length - 1, 0));
  const optId = (i: number) => `${uid}-opt-${i}`;

  function addKey(provider: string) {
    close(true);
    onAddKey(provider);
  }

  function pick(v: PickerValue, typed: boolean) {
    onPick(v, typed);
    close(true);
  }

  const onListKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!options.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((at + step + options.length) % options.length);
    } else if (e.key === 'Enter' && e.target === search.current) {
      e.preventDefault();
      options[at]?.pick();
    }
  };
  const onButtonKey = (e: KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      show();
    }
  };

  const loading = shown.find((s) => s.g.status === 'loading');
  const footText = noMatch
    ? 'A typed name is checked once with a short test question before it is used.'
    : loading
      ? `Getting ${loading.g.name}’s list… You can keep typing.`
      : foot;

  let index = 0;
  return (
    <div className="mp" ref={root}>
      <span className="mp-label">{label}</span>
      <button
        ref={button}
        type="button"
        className={['mp-button', open && 'is-open', gone && !open && 'is-gone'].filter(Boolean).join(' ')}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={onButtonKey}
      >
        <span className="mp-mark">
          {local ? <Laptop /> : (current?.mark ?? (current?.name ?? value.provider).slice(0, 2))}
        </span>
        <span className="mp-lines">
          <span className="mp-model">{currentModel?.name ?? value.model}</span>
          <span className="mp-provider">{line2}</span>
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#5F6168"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {gone && !open && (
        <span className="mp-gone">
          {current?.name ?? value.provider} no longer offers {gone.old}, so {gone.app} uses {value.model}. Open the list
          to pick another.
        </span>
      )}
      {open && (
        <div className="mp-pop" onKeyDown={onListKey}>
          <div className="mp-search-wrap">
            <label className="mp-search">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#6E7079"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5" />
              </svg>
              <input
                ref={search}
                type="text"
                placeholder="Search models"
                aria-label="Search models"
                role="combobox"
                aria-expanded={true}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={options.length ? optId(at) : undefined}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
              />
            </label>
          </div>
          <div className="mp-list">
            <div
              id={listId}
              role="listbox"
              aria-label={`${label} model`}
              aria-owns={options.map((_, i) => optId(i)).join(' ') || undefined}
            />
            {shown.map(({ g, models, keyRow }) => (
              <div key={g.id} className={`mp-group is-${g.status}`}>
                <div className="mp-group-head">
                  <span className="mp-group-name">{g.name}</span>
                  <span className={`mp-status is-${g.status}`}>{STATUS[g.status]}</span>
                </div>
                {g.status === 'loading' && (
                  <div className="mp-skeleton" aria-hidden="true">
                    <span style={{ width: '70%' }} />
                    <span style={{ width: '55%' }} />
                    <span style={{ width: '62%' }} />
                  </div>
                )}
                {g.status === 'key-refused' && keyRow && (
                  <>
                    <div className="mp-refused">
                      {g.name} refused the key. Check it in Keys, then open this list again.
                    </div>
                    <button type="button" className="mp-key" onClick={() => addKey(g.id)}>
                      Check the {g.name} key
                    </button>
                  </>
                )}
                {models.map((m) => {
                  const i = index++;
                  const selected = g.id === value.provider && m.id === value.model;
                  return (
                    <button
                      key={m.id}
                      id={optId(i)}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      tabIndex={-1}
                      className={['mp-option', selected && 'is-selected', i === at && 'is-active']
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => options[i]?.pick()}
                      onMouseMove={() => i !== at && setActive(i)}
                    >
                      <span className="mp-option-name">{m.name ?? m.id}</span>
                      {m.tag && <span className="mp-tag">{m.tag}</span>}
                      <span className="mp-check">
                        {selected && (
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M5 12l5 5 9-10" />
                          </svg>
                        )}
                      </span>
                    </button>
                  );
                })}
                {g.note && <div className="mp-note">{g.note}</div>}
                {g.status === 'needs-key' && keyRow && (
                  <button type="button" className="mp-key" onClick={() => addKey(g.id)}>
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    {g.addKeyLabel}
                  </button>
                )}
                {g.status === 'failed' && (
                  <div className="mp-notice">
                    <span>
                      {g.name}’s full list didn’t load, so the suggested models show instead. You can still type any
                      model name.
                    </span>
                    <button type="button" className="mp-link" onClick={() => onRetry(g.id)}>
                      Try again
                    </button>
                  </div>
                )}
              </div>
            ))}
            {noKeys && !ql && (
              <div className="mp-notice">
                <span>Add a key to pick models from {orList(cloud.map((g) => g.name))}.</span>
                <span className="mp-notice-actions">
                  {onConnectCloud && (
                    <button type="button" className="mp-link" onClick={onConnectCloud}>
                      Connect Penv Cloud
                    </button>
                  )}
                  <button
                    type="button"
                    className="mp-link is-quiet"
                    onClick={() => {
                      close(true);
                      onAddKey();
                    }}
                  >
                    Paste a key instead
                  </button>
                </span>
              </div>
            )}
            {noMatch && (
              <>
                <div className="mp-nomatch">No model called “{q}” in your lists.</div>
                {typedRow && (
                  <button
                    id={optId(options.length - 1)}
                    type="button"
                    role="option"
                    aria-selected={false}
                    tabIndex={-1}
                    className={['mp-typed', at === options.length - 1 && 'is-active'].filter(Boolean).join(' ')}
                    onClick={() => options[options.length - 1]?.pick()}
                  >
                    Use “{q}” with {typedRow.name}
                  </button>
                )}
              </>
            )}
          </div>
          <div className="mp-foot">{footText}</div>
        </div>
      )}
    </div>
  );
}
