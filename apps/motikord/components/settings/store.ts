import { useEffect, useState } from 'react';
import { isPackId, type PackId } from '../../lib/look/packs';

// The v3 switches, kept under their own storage key so v2 settings are never touched.
const KEY = 'settingsV3';

export type Fps = 60 | 30;
export type PreviewQuality = 'auto' | 'full' | 'light';
export interface SettingsV3Data {
  /** "Default style": Auto or one of the 8 packs; v2's settings only know the first four. */
  style: 'auto' | PackId;
  /** "Finishing": motion blur, soft light, fine grain and a gentle grade on every export. */
  finishing: boolean;
  fps: Fps;
  previewQuality: PreviewQuality;
  /** "Show key frames first". */
  keyFramesFirst: boolean;
  /** "Auto captions": narration goes to Groq or OpenAI. */
  captions: boolean;
  /** "AI voiceover": only the script goes to OpenAI. */
  voiceover: boolean;
}

export const DEFAULTS_V3: SettingsV3Data = { style: 'auto', finishing: true, fps: 60, previewQuality: 'auto', keyFramesFirst: true, captions: false, voiceover: false };

const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

/** Fills every missing or invalid field from the defaults. */
export function mergeV3(stored: unknown): SettingsV3Data {
  const s = (typeof stored === 'object' && stored !== null ? stored : {}) as Record<string, unknown>;
  return {
    style: isPackId(s.style) ? s.style : 'auto',
    finishing: bool(s.finishing, DEFAULTS_V3.finishing),
    fps: s.fps === 30 ? 30 : 60,
    previewQuality: s.previewQuality === 'full' || s.previewQuality === 'light' ? s.previewQuality : 'auto',
    keyFramesFirst: bool(s.keyFramesFirst, DEFAULTS_V3.keyFramesFirst),
    captions: bool(s.captions, DEFAULTS_V3.captions),
    voiceover: bool(s.voiceover, DEFAULTS_V3.voiceover),
  };
}

export async function getV3(): Promise<SettingsV3Data> {
  return mergeV3((await browser.storage.local.get(KEY))[KEY]);
}

export async function updateV3(patch: Partial<SettingsV3Data>): Promise<SettingsV3Data> {
  const next = mergeV3({ ...(await getV3()), ...patch });
  await browser.storage.local.set({ [KEY]: next });
  return next;
}

/** The saved v3 settings, live: the defaults first, then what is stored; `set` saves and shows at once. */
export function useV3(): [SettingsV3Data, (patch: Partial<SettingsV3Data>) => void, boolean] {
  const [s, setS] = useState<SettingsV3Data>(DEFAULTS_V3);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    getV3().then((v) => { setS(v); setLoaded(true); }).catch((error: unknown) => console.error('Motikord: could not read v3 settings', error));
    const on = (changes: Record<string, { newValue?: unknown }>, area: string) => { if (area === 'local' && KEY in changes) setS(mergeV3(changes[KEY]!.newValue)); };
    browser.storage.onChanged.addListener(on);
    return () => browser.storage.onChanged.removeListener(on);
  }, []);
  const set = (patch: Partial<SettingsV3Data>) => {
    setS((cur) => ({ ...cur, ...patch }));
    updateV3(patch).catch((error: unknown) => console.error('Motikord: could not save v3 settings', error));
  };
  return [s, set, loaded];
}

// What the machine check found, written by the check page and read here for "This computer: ... · checked today".
const MACHINE_KEY = 'machineCheckV3';
export interface MachineResult { at: number; fps60: boolean }

export async function getMachineResult(): Promise<MachineResult | undefined> {
  const v = (await browser.storage.local.get(MACHINE_KEY))[MACHINE_KEY] as Partial<MachineResult> | undefined;
  return v && typeof v.at === 'number' && typeof v.fps60 === 'boolean' ? { at: v.at, fps60: v.fps60 } : undefined;
}
export const saveMachineResult = (r: MachineResult) => browser.storage.local.set({ [MACHINE_KEY]: r });

/** "today", "yesterday" or "3 days ago". */
export function when(at: number, now: number): string {
  const days = Math.max(0, Math.floor((now - at) / 86_400_000));
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}
