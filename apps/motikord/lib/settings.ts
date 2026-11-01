import { DEFAULT_PROVIDER, isProvider } from './providers';
import type { CustomSource, LookStyle, MediaSettings, Mood, Pace, Provider, Settings } from './types';

const STORAGE_KEY = 'settings';

export const DEFAULT_SETTINGS: Settings = {
  ai: 'cloud',
  keySource: null,
  provider: DEFAULT_PROVIDER,
  models: {},
  defaultAspect: '9:16',
  defaultExport: { kind: 'mp4', quality: '1080p' },
  voiceOn: true,
  voiceLang: '',
  smoothPreview: true,
  media: { on: {}, custom: [], allLicences: false },
  onboarded: false,
  look: { style: 'auto', pace: 'normal', mood: 'upbeat' },
  critic: true,
  beatSync: false,
  aiImages: false,
  imageProvider: 'openai',
  lookCardSeen: false,
};

const LOOK_STYLES: readonly LookStyle[] = ['auto', 'clean', 'bold', 'playful', 'corporate'];
const PACES: readonly Pace[] = ['calm', 'normal', 'fast'];
const MOODS: readonly Mood[] = ['upbeat', 'calm', 'warm', 'dramatic', 'none'];
const pick = <T>(list: readonly T[], v: unknown, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

type Nested = 'defaultExport' | 'media' | 'models' | 'look';
/** Settings saved before Media sources kept the two libraries here. */
interface OldLibraries { openverse?: boolean; pexels?: boolean; allLicences?: boolean }
export type SettingsPatch = Omit<Partial<Settings>, Nested> & { [K in Nested]?: Partial<Settings[K]> } & { libraries?: OldLibraries };

/** Fills every missing field from the defaults, including inside `defaultExport`, `media` and `look`; old `libraries` move into `media`. Settings from before providers get Groq; from before voice prompts get the mic on in Chrome's language. */
export function mergeSettings(stored: SettingsPatch | undefined): Settings {
  const { libraries, ...s } = stored ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    provider: isProvider(s.provider) ? s.provider : DEFAULT_PROVIDER,
    voiceOn: typeof s.voiceOn === 'boolean' ? s.voiceOn : true,
    voiceLang: typeof s.voiceLang === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(s.voiceLang) ? s.voiceLang : '',
    models: cleanModels(s.models),
    defaultExport: { ...DEFAULT_SETTINGS.defaultExport, ...s.defaultExport },
    media: mergeMedia(s.media, libraries),
    look: {
      style: pick(LOOK_STYLES, s.look?.style, DEFAULT_SETTINGS.look.style),
      pace: pick(PACES, s.look?.pace, DEFAULT_SETTINGS.look.pace),
      mood: pick(MOODS, s.look?.mood, DEFAULT_SETTINGS.look.mood),
    },
    critic: bool(s.critic, DEFAULT_SETTINGS.critic),
    beatSync: bool(s.beatSync, DEFAULT_SETTINGS.beatSync),
    aiImages: bool(s.aiImages, DEFAULT_SETTINGS.aiImages),
    imageProvider: 'openai',
    lookCardSeen: bool(s.lookCardSeen, DEFAULT_SETTINGS.lookCardSeen),
  };
}

function mergeMedia(media: Partial<MediaSettings> | undefined, old: OldLibraries | undefined): MediaSettings {
  const on: MediaSettings['on'] = {};
  if (typeof old?.openverse === 'boolean') on.openverse = old.openverse;
  if (typeof old?.pexels === 'boolean') on.pexels = old.pexels;
  for (const [k, v] of Object.entries(media?.on ?? {})) if (typeof v === 'boolean') on[k as keyof MediaSettings['on']] = v;
  const custom = Array.isArray(media?.custom) ? media.custom.filter((c): c is CustomSource => !!c && typeof c.id === 'string' && typeof c.url === 'string') : [];
  const allLicences = typeof media?.allLicences === 'boolean' ? media.allLicences : old?.allLicences === true;
  return { on, custom, allLicences };
}

function cleanModels(models: SettingsPatch['models']): Settings['models'] {
  const out: Settings['models'] = {};
  for (const [k, v] of Object.entries(models ?? {})) if (isProvider(k) && typeof v === 'string' && v) out[k] = v;
  return out;
}

export async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  return mergeSettings(stored[STORAGE_KEY] as SettingsPatch | undefined);
}

/** Merges top-level fields; `defaultExport`, `media`, `models` and `look` merge one level deeper (`media.on` two). Returns the new settings. */
export async function updateSettings(partial: SettingsPatch): Promise<Settings> {
  const current = await getSettings();
  const next: Settings = mergeSettings({
    ...current,
    ...partial,
    models: { ...current.models, ...partial.models },
    defaultExport: { ...current.defaultExport, ...partial.defaultExport },
    look: { ...current.look, ...partial.look },
    media: { ...current.media, ...partial.media, on: { ...current.media.on, ...partial.media?.on } },
  });
  await browser.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

/** Calls `cb` with the full settings whenever they change. Returns an unsubscribe function. */
export function onSettingsChanged(cb: (settings: Settings) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && STORAGE_KEY in changes) cb(mergeSettings(changes[STORAGE_KEY]!.newValue as SettingsPatch));
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/** Keys live only in chrome.storage.session under these names; never in the recipe, IndexedDB or a log. */
export type KeyName = Provider | 'pexels' | 'pixabay' | 'freesound' | 'jamendo' | 'unsplash' | `custom:${string}`;

export async function getKey(name: KeyName): Promise<string | undefined> {
  const stored = await browser.storage.session.get(name);
  const key = stored[name];
  return typeof key === 'string' && key ? key : undefined;
}
export async function setKey(name: KeyName, key: string): Promise<void> {
  await browser.storage.session.set({ [name]: key });
}
export async function clearKey(name: KeyName): Promise<void> {
  await browser.storage.session.remove(name as string);
}
