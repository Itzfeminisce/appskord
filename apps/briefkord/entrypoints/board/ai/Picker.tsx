/** The shared model picker on an AI surface; picking saves the one model all four actions use. */
import { useState } from 'react';
import { listModelsFor, type CloudProviderId } from '@appskord/llm';
import { ModelPicker, type PickerValue } from '@appskord/ui';
import { pickerGroups, PICKER_FOOT, type ListState } from '@/entrypoints/sidepanel/settings/model';
import { AI_PROVIDERS, aiKey, isAiProvider, keyNameOf, requestHostAccess } from '@/lib/keys';
import { saveSettings } from '@/lib/store/settings';
import { openAiSettings, type Choice } from './choice';

export function AiPicker({ choice, label }: { choice: Choice; label: string }) {
  const [lists, setLists] = useState<Partial<Record<CloudProviderId, ListState>>>({});
  const { value, keyNames } = choice;

  const load = (p: CloudProviderId) => {
    setLists((l) => ({ ...l, [p]: { status: 'loading' } }));
    aiKey(p)
      .then((key) => listModelsFor(p, 'chat', { key }))
      .then(
        (list) => setLists((l) => ({ ...l, [p]: { status: 'done', list } })),
        (error: unknown) => console.error('Briefkord: could not load the model list', error),
      );
  };

  const pick = async (next: PickerValue) => {
    if (!isAiProvider(next.provider)) return;
    // Asked inside the click, so Chrome shows its prompt; an allowed host answers at once.
    await requestHostAccess(next.provider);
    await saveSettings({ ai: { provider: next.provider, model: next.model } });
  };

  const typed = isAiProvider(value.provider) && keyNames.includes(keyNameOf(value.provider)) ? value.provider : AI_PROVIDERS.find((p) => keyNames.includes(keyNameOf(p)));
  return (
    <ModelPicker
      label={label}
      foot={PICKER_FOOT}
      groups={pickerGroups(value, keyNames, lists)}
      value={value}
      typedProvider={typed}
      onOpen={() => {
        for (const p of AI_PROVIDERS) if (keyNames.includes(keyNameOf(p)) && !lists[p]) load(p);
      }}
      onRetry={(p) => isAiProvider(p) && load(p)}
      onAddKey={openAiSettings}
      onConnectCloud={openAiSettings}
      onPick={(v) => void pick(v).catch((error: unknown) => console.error('Briefkord: could not save the model', error))}
    />
  );
}

/** Opens the picker list on a surface, for "Pick another model". */
export function openPicker(root: HTMLElement | null): void {
  root?.querySelector<HTMLButtonElement>('.mp-button')?.click();
}
