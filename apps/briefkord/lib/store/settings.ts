/** Briefkord's settings in `chrome.storage.local`. Keys never live here; they stay in session storage via the shared packages. */
import type { PickerValue } from '@appskord/ui';

const STORAGE_KEY = 'settings';

export interface Settings {
  sharingName: string;
  includeNotes: boolean;
  includePageText: boolean;
  lastBoardId?: string;
  lastSectionId?: string;
  ai?: PickerValue;
}

export const DEFAULT_SETTINGS: Settings = { sharingName: '', includeNotes: false, includePageText: true };

/** The stored settings over the defaults; a field of the wrong type falls back to its default. */
export function readSettings(stored: unknown): Settings {
  const s = (typeof stored === 'object' && stored !== null ? stored : {}) as Record<string, unknown>;
  const text = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
  const ai = s.ai as Partial<PickerValue> | undefined;
  return {
    sharingName: typeof s.sharingName === 'string' ? s.sharingName : DEFAULT_SETTINGS.sharingName,
    includeNotes: typeof s.includeNotes === 'boolean' ? s.includeNotes : DEFAULT_SETTINGS.includeNotes,
    includePageText: typeof s.includePageText === 'boolean' ? s.includePageText : DEFAULT_SETTINGS.includePageText,
    ...(text(s.lastBoardId) ? { lastBoardId: text(s.lastBoardId) } : {}),
    ...(text(s.lastSectionId) ? { lastSectionId: text(s.lastSectionId) } : {}),
    ...(typeof ai?.provider === 'string' && typeof ai.model === 'string' ? { ai: { provider: ai.provider, model: ai.model } } : {}),
  };
}

export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  return readSettings(stored[STORAGE_KEY]);
}

/** Merges `patch` into the stored settings; an `undefined` field is removed. */
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = readSettings({ ...(await loadSettings()), ...patch });
  await browser.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}
