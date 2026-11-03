/** Frame AIFirstUse: the shared model picker, "Keys for AI" (Penv Cloud, paste a key) and the site-access note. */
import { useCallback, useEffect, useState } from 'react';
import { chatCloud, LLMError, listModelsFor, PROVIDERS, providerForKey, type CloudProviderId, type ErrorText } from '@appskord/llm';
import { ModelPicker, type PickerValue } from '@appskord/ui';
import {
  AI_PROVIDERS, aiKey, defaultChoice, isAiProvider, keyNameOf, loadedKeyNames, loadPenvConnection, requestHostAccess, type PenvAppConnection,
} from '@/lib/keys';
import { loadSettings, saveSettings } from '@/lib/store/settings';
import { PasteKey } from './PasteKey';
import { PenvConnect, type PenvState } from './PenvConnect';
import { needsList, pickerGroups, PICKER_FOOT, PICKER_LABEL, type ListState } from './model';

type Open = { kind: 'paste'; provider: CloudProviderId } | { kind: 'penv'; state: PenvState };

const testText: ErrorText = ({ reason, label }) => (reason === 'auth' ? `${label} refused the key` : `${label} isn’t answering`);

export function AiKeys() {
  const [keyNames, setKeyNames] = useState<string[]>([]);
  const [conn, setConn] = useState<PenvAppConnection>();
  const [picked, setPicked] = useState<PickerValue>();
  const [lists, setLists] = useState<Partial<Record<CloudProviderId, ListState>>>({});
  const [open, setOpen] = useState<Open>();
  const [saved, setSaved] = useState<CloudProviderId>();
  const [line, setLine] = useState<string>();

  const refresh = useCallback(async () => {
    const [names, c, s] = await Promise.all([loadedKeyNames(), loadPenvConnection(), loadSettings()]);
    setKeyNames(names);
    setConn(c);
    setPicked(s.ai && isAiProvider(s.ai.provider) ? s.ai : undefined);
  }, []);

  useEffect(() => {
    const run = () => void refresh().catch((error: unknown) => console.error('Briefkord: could not load the AI settings', error));
    run();
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if ((area === 'session' && 'apiKeys' in changes) || (area === 'local' && ('settings' in changes || 'penvConnection' in changes))) run();
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => browser.storage.onChanged.removeListener(onChanged);
  }, [refresh]);

  // A key added or removed: its list loads again on the next open.
  const keyList = keyNames.join();
  useEffect(() => setLists({}), [keyList]);

  const value = picked ?? defaultChoice(keyNames);
  const pickedProvider = isAiProvider(value.provider) ? value.provider : AI_PROVIDERS[0]!;

  const load = (p: CloudProviderId) => {
    setLists((l) => ({ ...l, [p]: { status: 'loading' } }));
    aiKey(p)
      .then((key) => listModelsFor(p, 'chat', { key }))
      .then(
        (list) => setLists((l) => ({ ...l, [p]: { status: 'done', list } })),
        (error: unknown) => {
          console.error('Briefkord: could not load the model list', error);
          setLists((l) => ({ ...l, [p]: { status: 'failed' } }));
        },
      );
  };

  const onOpen = () => {
    for (const p of AI_PROVIDERS) if (keyNames.includes(keyNameOf(p)) && needsList(lists[p])) load(p);
  };

  const pick = async (next: PickerValue, typed: boolean) => {
    if (!isAiProvider(next.provider)) return;
    const p = next.provider;
    // Asked inside the click, so Chrome shows its prompt; an allowed host answers at once.
    if (!(await requestHostAccess(p))) return;
    setLine(undefined);
    if (typed) {
      try {
        await chatCloud([{ role: 'user', content: 'Reply with OK.' }], {
          app: 'Briefkord', text: testText, provider: p, key: await aiKey(p), model: next.model, modelGone: 'report', maxTokens: 16,
        });
      } catch (error) {
        console.error('Briefkord: could not use the typed model', error instanceof Error ? error.name : 'error');
        const code = error instanceof LLMError ? error.code : undefined;
        setLine(code === 'model-not-found' ? `No model called “${next.model}” in your lists.` : `${PROVIDERS[p].label} isn’t answering`);
        return;
      }
    }
    await saveSettings({ ai: { provider: p, model: next.model } });
    setPicked({ provider: p, model: next.model });
  };

  const typedProvider = keyNames.includes(keyNameOf(pickedProvider)) ? pickedProvider : (AI_PROVIDERS.find((p) => keyNames.includes(keyNameOf(p))) ?? pickedProvider);
  const penvKeys = keyNames.filter((n) => conn?.keys.includes(n));
  const penvProvider = penvKeys.includes(keyNameOf(pickedProvider)) ? pickedProvider : providerForKey(penvKeys[0] ?? '');

  return (
    <main className="st-main">
      <div className="st-cols">
        <section className="st-col is-picker">
          <ModelPicker
            label={PICKER_LABEL}
            foot={PICKER_FOOT}
            groups={pickerGroups(value, keyNames, lists)}
            value={value}
            typedProvider={typedProvider}
            onOpen={onOpen}
            onRetry={(p) => isAiProvider(p) && load(p)}
            onAddKey={(p) => setOpen({ kind: 'paste', provider: p && isAiProvider(p) ? p : pickedProvider })}
            onConnectCloud={() => setOpen({ kind: 'penv', state: 'start' })}
            onPick={(v, typed) => void pick(v, typed)}
          />
          {line && (
            <div role="alert" className="st-state is-error">
              <strong>{line}</strong>
            </div>
          )}
        </section>
        <div className="st-col is-side">
          <section aria-labelledby="keys-h" className="st-card">
            <h2 id="keys-h" className="st-h3">Keys for AI</h2>
            <div className="st-penv-row">
              <span className="st-mark" aria-hidden="true">pv</span>
              <span className="st-lines">
                <strong>Penv Cloud</strong>
                {conn && penvProvider && <span>Connected · {PROVIDERS[penvProvider].label} key</span>}
              </span>
              {conn ? (
                <button type="button" className="st-btn is-small" onClick={() => setOpen({ kind: 'penv', state: 'connected' })}>
                  Manage
                </button>
              ) : (
                <button type="button" className="st-btn is-small" onClick={() => setOpen({ kind: 'penv', state: 'start' })}>
                  Connect Penv Cloud
                </button>
              )}
            </div>
            <button type="button" className="st-btn st-start" onClick={() => setOpen({ kind: 'paste', provider: pickedProvider })}>
              Paste a key instead
            </button>
            {saved && (
              <div role="status" className="st-state is-ok">
                <strong>{PROVIDERS[saved].label} key saved</strong>
                <span>Its models now show in the list. Pick one to start.</span>
              </div>
            )}
            <span className="st-muted">Keys stay in this browser session and are cleared when Chrome closes. Add a key and its models appear in the list.</span>
          </section>
          <span className="st-note">
            The first time you use a provider,{' '}
            <button type="button" className="st-text-btn" onClick={() => void requestHostAccess(pickedProvider)}>
              Chrome asks once
            </button>{' '}
            to let Briefkord reach its site. Only that site, only for AI.
          </span>
        </div>
      </div>
      {open?.kind === 'paste' && (
        <PasteKey
          provider={open.provider}
          onClose={() => setOpen(undefined)}
          onSaved={(p) => {
            setOpen(undefined);
            setSaved(p);
            void refresh();
          }}
        />
      )}
      {open?.kind === 'penv' && (
        <PenvConnect
          first={open.state}
          keyNames={penvKeys.length ? penvKeys : keyNames}
          onClose={() => setOpen(undefined)}
          onPaste={() => setOpen({ kind: 'paste', provider: pickedProvider })}
          onChange={(c) => {
            setConn(c);
            void refresh();
          }}
        />
      )}
    </main>
  );
}
