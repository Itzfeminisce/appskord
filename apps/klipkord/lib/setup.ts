/**
 * First-run setup: the machine check, which AI option it recommends, and how a pasted key is described.
 * Pure functions over values; `detectMachine` and the permission helpers are the only edges.
 * No key value is ever returned or logged here.
 */
import { availabilityOf } from './check/results';
import { type KeyStatus } from './penv';
import { detectKey, isProviderKeyName, LLMError, PROVIDERS as LLM_PROVIDERS, providerForKey, serviceLabel, SUGGESTED, type PickerList, type ProviderKeyName } from '@appskord/llm';
import type { PickerGroup, PickerOption, PickerValue } from '@appskord/ui';
import { BUILTIN, DEFAULT_SETTINGS, GROQ_BOTH, WHISPER } from './settings';
import type { AiMode, CloudNotes, ModelChoice, NotesProvider, Settings, TranscriptsProvider } from './types';

/** The keys Klipkord uses. */
export type KeyName = ProviderKeyName;
export type KeyJob = 'transcripts' | 'notes';
const KEY_NAMES: KeyName[] = ['GROQ_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'XAI_API_KEY'];

/** True for a key name Klipkord can use. */
export const isKeyName = (name: string): name is KeyName => isProviderKeyName(name);

/** What a key covers in Klipkord: Groq and OpenAI do transcripts and notes; the others write notes. */
export function jobsFor(name: KeyName): KeyJob[] {
  return name === 'GROQ_API_KEY' || name === 'OPENAI_API_KEY' ? ['transcripts', 'notes'] : ['notes'];
}

export const PENV_CLOUD_URL = 'https://penv.cloud';
export const GROQ_KEYS_URL = 'https://console.groq.com/keys';
export const SHORTCUTS_URL = 'chrome://extensions/shortcuts';
export const REPO_URL = 'https://github.com/Itzfeminisce/klipkord-screen-recorder-chrome-extension';

// ---- Machine check ----

/** What this computer can run. `null` while a check has not finished. */
export interface MachineCheck { webgpu: boolean | null; builtinAi: boolean | null }

export type SetupState = 'no-built-in-ai' | 'slow-computer';

export interface SetupChoice {
  ai: AiMode;                // the option marked Recommended and selected by default
  states: SetupState[];      // messages Setup shows
}

/** Both pickers for a first-run option: Groq for both when cloud, else Whisper and Chrome's built-in AI, or Ollama without it. */
export function aiSettings(ai: AiMode, builtinAi: boolean | null): Pick<Settings, 'transcripts' | 'notes'> {
  if (ai === 'cloud') return GROQ_BOTH;
  const notes: Settings['notes'] = builtinAi === false ? { provider: 'ollama', model: '' } : DEFAULT_SETTINGS.notes;
  return { transcripts: DEFAULT_SETTINGS.transcripts, notes };
}

/** Local needs WebGPU for usable speed; without it Groq is the default. Missing built-in AI only moves notes. */
export function setupChoice(check: MachineCheck): SetupChoice {
  const ai: AiMode = check.webgpu === false ? 'cloud' : 'local';
  const states: SetupState[] = [];
  if (check.builtinAi === false) states.push('no-built-in-ai');
  if (check.webgpu === false) states.push('slow-computer');
  return { ai, states };
}

/** True when either built-in AI API can run or fetch its model. */
export function builtinAiPresent(summarizer: unknown, languageModel: unknown): boolean {
  const ok = (raw: unknown) => {
    const a = availabilityOf(raw);
    return a === 'available' || a === 'downloadable' || a === 'downloading';
  };
  return ok(summarizer) || ok(languageModel);
}

export interface MachineEnv {
  gpu?: { requestAdapter(): Promise<unknown> };
  summarizer?: { availability?: (options?: { outputLanguage?: string }) => Promise<unknown> };
  languageModel?: { availability?: () => Promise<unknown> };
}

/** The real browser's environment (T0's machine check, no prompts). */
export function browserEnv(): MachineEnv {
  const g = globalThis as unknown as Record<string, MachineEnv['summarizer']>;
  return { gpu: (navigator as unknown as MachineEnv).gpu, summarizer: g.Summarizer, languageModel: g.LanguageModel };
}

// Without an output language Chrome warns on every probe.
const SUMMARIZER_OPTIONS = { outputLanguage: 'en' };

/** Asks for a WebGPU adapter and the built-in AI availability. A failing probe counts as missing. */
export async function detectMachine(env: MachineEnv = browserEnv()): Promise<MachineCheck> {
  const probe = async (run?: () => Promise<unknown>): Promise<unknown> => {
    try { return await run?.(); } catch { return undefined; }
  };
  const [adapter, summarizer, languageModel] = await Promise.all([
    probe(env.gpu ? () => env.gpu!.requestAdapter() : undefined),
    probe(env.summarizer?.availability ? () => env.summarizer!.availability!(SUMMARIZER_OPTIONS) : undefined),
    probe(env.languageModel?.availability ? () => env.languageModel!.availability!() : undefined),
  ]);
  return { webgpu: !!adapter, builtinAi: builtinAiPresent(summarizer, languageModel) };
}

// ---- First run ----

/** First run: no key source, no recordings and the AI choice never confirmed. */
export function isFirstRun(settings: Pick<Settings, 'keySource' | 'onboarded'>, recordingCount: number): boolean {
  return !settings.onboarded && settings.keySource === null && recordingCount === 0;
}

// ---- Keys ----

export type RowStatus = KeyStatus | 'checking';

export const STATUS_WORD: Record<RowStatus, string> = {
  ok: 'Ready',
  checking: 'Checking…',
  rejected: 'Rejected',
  unreachable: 'Couldn’t check',
};

/** "transcripts and notes" / "notes": what a key covers, in words. */
export function jobsPhrase(name: KeyName): string {
  return jobsFor(name).join(' and ');
}

export type PasteClass =
  | { kind: 'empty' }
  | { kind: 'known'; name: KeyName; title: string; jobs: string }
  | { kind: 'unknown' };

/** What a pasted value is: a recognised key (with row wording), or one Klipkord can't place. */
export function classifyPaste(value: string): PasteClass {
  if (!value.trim()) return { kind: 'empty' };
  const name = detectKey(value, { names: KEY_NAMES });
  if (!name) return { kind: 'unknown' };
  return { kind: 'known', name, title: `This is a ${serviceLabel(name)} key`, jobs: `Covers ${jobsPhrase(name)}` };
}

/** Services offered as chips when a pasted key isn't recognised. */
export const SERVICE_CHOICES: KeyName[] = ['GROQ_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'XAI_API_KEY'];

/** Where a user creates a new key for a service. */
export const KEY_PAGE: Record<KeyName, string> = {
  GROQ_API_KEY: GROQ_KEYS_URL,
  OPENROUTER_API_KEY: 'https://openrouter.ai/keys',
  OPENAI_API_KEY: 'https://platform.openai.com/api-keys',
  ANTHROPIC_API_KEY: 'https://console.anthropic.com/settings/keys',
  GEMINI_API_KEY: 'https://aistudio.google.com/apikey',
  XAI_API_KEY: 'https://console.x.ai',
};

/** Key names the chosen setup needs. Groq does both jobs. */
export const NEEDED_KEYS: string[] = ['GROQ_API_KEY'];

/** The needed keys that are not loaded yet. */
export function missingKeys(needed: string[], loaded: string[]): string[] {
  return needed.filter((n) => !loaded.includes(n));
}

type StatusMap = Record<string, RowStatus | undefined>;

/** "Start recording" is allowed once a usable key is loaded and works (or could not be checked); none is still being checked. */
export function canStart(loaded: string[], status: StatusMap): boolean {
  const usable = loaded.filter((n) => n in KEY_PAGE);
  return usable.some((n) => status[n] === 'ok' || status[n] === 'unreachable');
}

/** True when no key loaded or every loaded key was Rejected (penv-no-usable-keys). */
export function noUsableKeys(loaded: string[], status: StatusMap): boolean {
  return loaded.every((n) => status[n] === 'rejected');
}

/** The AI settings "Start recording" saves once keys work: Groq for both pickers only when a Groq key can transcribe. */
export function cloudSettings(loaded: string[], status: StatusMap): Pick<Settings, 'transcripts' | 'notes'> | null {
  const groq = status.GROQ_API_KEY === 'ok' || status.GROQ_API_KEY === 'unreachable';
  return loaded.includes('GROQ_API_KEY') && groq ? GROQ_BOTH : null;
}

// ---- Settings rows ----

/** "Connected · Groq and OpenAI keys" for the Penv Cloud row; null when not connected. */
export function penvRowStatus(connected: boolean, loaded: string[]): string | null {
  const names = loaded.filter(isKeyName).map((n) => LLM_PROVIDERS[providerForKey(n)!].label);
  if (!connected || !names.length) return null;
  const list = names.length < 2 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `Connected · ${list} ${names.length === 1 ? 'key' : 'keys'}`;
}

// ---- Model pickers ----

export type PickerJob = 'transcripts' | 'notes';

export const PICKER_LABEL: Record<PickerJob, string> = { transcripts: 'Transcripts', notes: 'Notes and Ask' };
export const PICKER_FOOT: Record<PickerJob, string> = {
  transcripts: 'Other providers don’t turn speech into text here, so they aren’t listed.',
  notes: 'Each list comes from the provider, using your key.',
};
/** The cloud groups of each picker, in the frame's order. */
export const PICKER_CLOUD: Record<PickerJob, CloudNotes[]> = {
  transcripts: ['groq', 'openai'],
  notes: ['groq', 'openai', 'anthropic', 'google', 'xai', 'openrouter'],
};
const MARK: Record<CloudNotes, string> = { groq: 'Gq', openai: 'OA', anthropic: 'An', google: 'Gm', xai: 'xA', openrouter: 'OR' };
const ADD_KEY: Record<CloudNotes, string> = {
  groq: 'Add a Groq key', openai: 'Add an OpenAI key', anthropic: 'Add an Anthropic key',
  google: 'Add a Gemini key', xai: 'Add an xAI key', openrouter: 'Add an OpenRouter key',
};
const ALIASES: Partial<Record<CloudNotes, string[]>> = { anthropic: ['claude'], google: ['google'], xai: ['grok'] };
const OLLAMA = 'ollama:';
export const OLLAMA_DOWN = 'Ollama isn’t running. Start it, then open this list again.';

/** A provider's list in the picker: being fetched, or fetched (live, or suggested with the error). */
export type ListState = { status: 'loading' } | { status: 'done'; list: PickerList };

export interface PickerInputs {
  keys: string[];                              // loaded key names, never values
  lists: Partial<Record<CloudNotes, ListState>>;
  builtin: boolean;                            // Chrome's built-in AI can run
  ollama?: string[] | null;                    // Ollama's models; null when it did not answer, absent before asking
}

/** The picker's value for a saved choice. Both local notes engines sit in the "On this computer" group. */
export function pickerValue(job: PickerJob, s: Pick<Settings, 'transcripts' | 'notes'>): PickerValue {
  if (job === 'transcripts') return s.transcripts.provider === 'local' ? { provider: 'local', model: WHISPER } : { ...s.transcripts };
  const { provider, model } = s.notes;
  if (provider === 'builtin') return { provider: 'local', model: BUILTIN };
  if (provider === 'ollama') return { provider: 'local', model: OLLAMA + model };
  return { provider, model };
}

/** The choice to save for a picked row. */
export function choiceFor(job: PickerJob, v: PickerValue): ModelChoice<TranscriptsProvider> | ModelChoice<NotesProvider> {
  if (job === 'transcripts') return v.provider === 'local' ? DEFAULT_SETTINGS.transcripts : { provider: v.provider as TranscriptsProvider, model: v.model };
  if (v.provider !== 'local') return { provider: v.provider as CloudNotes, model: v.model };
  return v.model.startsWith(OLLAMA) ? { provider: 'ollama', model: v.model.slice(OLLAMA.length) } : DEFAULT_SETTINGS.notes;
}

/** A typed model whose test question failed: a refused key shows picker-key-refused; anything else a line under the picker. */
export function typedFailure(model: string, error: unknown): { refused: LLMError } | { line: string } {
  const code = error instanceof LLMError ? error.code : undefined;
  if (code === 'auth') return { refused: error as LLMError };
  if (error instanceof LLMError && code !== 'model-not-found') return { line: error.message };
  return { line: `No model called “${model}” in your lists.` };
}

/** The host Chrome must allow before a provider is used; none for Whisper and built-in AI. */
export function hostFor(choice: ModelChoice<string>): string | null {
  if (choice.provider === 'ollama') return 'http://localhost:11434/*';
  const info = LLM_PROVIDERS[choice.provider as CloudNotes];
  return info && choice.provider !== 'local' && choice.provider !== 'builtin' ? `https://${info.host}/*` : null;
}

function cloudGroup(job: PickerJob, p: CloudNotes, value: PickerValue, inp: PickerInputs): PickerGroup {
  const info = LLM_PROVIDERS[p];
  const base = { id: p, name: info.label, mark: MARK[p], aliases: ALIASES[p], addKeyLabel: ADD_KEY[p] };
  if (!inp.keys.includes(info.keyName!)) return { ...base, status: 'needs-key', models: [] };
  const state = inp.lists[p];
  const suggested = (SUGGESTED[p][job === 'transcripts' ? 'speech' : 'chat'] ?? []).map((id, i): PickerOption => (i === 0 ? { id, tag: 'Recommended' } : { id }));
  const list = state?.status === 'done' ? state.list : undefined;
  // "Sees images" belongs to Motikord's visual critic, so Klipkord hides it.
  const models: PickerOption[] = (list?.models.length ? [...list.models] : suggested).map(({ tag, ...m }): PickerOption => (tag === 'Sees images' ? m : { ...m, ...(tag ? { tag } : {}) }));
  if (value.provider === p && value.model && !models.some((m) => m.id === value.model)) models.push({ id: value.model, tag: 'Your choice' });
  if (state?.status === 'loading') return { ...base, status: 'loading', models };
  if (list?.error?.code === 'auth') return { ...base, status: 'key-refused', models };
  return { ...base, status: list?.error ? 'failed' : 'ready', models };
}

/** Every group of one picker: "On this computer" first, then the cloud providers. */
export function pickerGroups(job: PickerJob, s: Pick<Settings, 'transcripts' | 'notes'>, inp: PickerInputs): PickerGroup[] {
  const value = pickerValue(job, s);
  const local: PickerGroup = { id: 'local', name: 'On this computer', status: 'local', models: [] };
  if (job === 'transcripts') local.models = [{ id: WHISPER, name: 'Whisper' }];
  else {
    if (inp.builtin || value.model === BUILTIN) local.models.push({ id: BUILTIN, name: 'Chrome’s built-in AI' });
    local.models.push(...(inp.ollama ?? []).map((n) => ({ id: OLLAMA + n, name: `Ollama · ${n}` })));
    if (s.notes.provider === 'ollama' && !local.models.some((m) => m.id === value.model)) {
      local.models.push({ id: value.model, name: s.notes.model ? `Ollama · ${s.notes.model}` : 'Ollama' });
    }
    if (inp.ollama === null) local.note = OLLAMA_DOWN;
  }
  return [local, ...PICKER_CLOUD[job].map((p) => cloudGroup(job, p, value, inp))];
}

// ---- Permissions (helper tab) ----

const PERMISSION_RESULT_KEY = 'permissionResult';

export interface PermissionResult { mic: boolean; camera: boolean }

/** Opens the extension tab that shows Chrome's prompt; the side panel can't. */
export async function openPermissionTab(camera: boolean): Promise<{ id?: number; back: () => Promise<void> }> {
  const url = (browser.runtime.getURL as (p: string) => string)('/permission.html');
  const [from] = await browser.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  const tab = await browser.tabs.create({
    url: `${url}?camera=${camera ? 1 : 0}`,
    ...(from?.id !== undefined && { index: from.index + 1, openerTabId: from.id }),
  });
  // Chrome leaves the person on another tab once the helper closes; put them back on the one they came from.
  const back = async () => {
    if (from?.id === undefined) return;
    try {
      await browser.tabs.update(from.id, { active: true });
      await browser.windows.update(from.windowId, { focused: true });
    } catch (error) {
      console.error('Klipkord: could not return to the recording tab', error);
    }
  };
  return { id: tab.id, back };
}

/** Called by the helper tab once Chrome has answered. */
export function reportPermission(result: PermissionResult): Promise<void> {
  return browser.storage.session.set({ [PERMISSION_RESULT_KEY]: { ...result, at: Date.now() } });
}

/** Calls `cb` when the helper tab reports. Returns an unsubscribe function. */
export function onPermissionResult(cb: (result: PermissionResult) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    const v = changes[PERMISSION_RESULT_KEY]?.newValue as (PermissionResult & { at: number }) | undefined;
    if (area === 'session' && v) cb({ mic: v.mic, camera: v.camera });
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/** Whether the mic should be on for this recording: asks through the helper tab when Chrome has not granted it yet. `null` means the helper tab was closed unanswered, so do not start. */
export async function micForStart(
  wantMic: boolean,
  deps: {
    state: () => Promise<PermissionState | null>;
    open: (camera: boolean) => Promise<{ id?: number; back?: () => Promise<void> } | void>;
    wait: (cb: (result: PermissionResult) => void) => () => void;
    closed: (tabId: number, cb: () => void) => () => void;
  },
): Promise<boolean | null> {
  if (!wantMic || (await deps.state()) === 'granted') return wantMic;
  return new Promise<boolean | null>((resolve, reject) => {
    let settled = false;
    let offClosed: (() => void) | undefined;
    let back: (() => Promise<void>) | undefined;
    const finish = (run: () => void) => {
      if (settled) return;
      settled = true;
      offWait();
      offClosed?.();
      void back?.();
      run();
    };
    // Subscribe before opening so a fast answer is not missed.
    const offWait = deps.wait((result) => finish(() => resolve(result.mic)));
    deps.open(false).then(
      (tab) => {
        // A closed tab never reports, so it would leave Start stuck.
        back = tab?.back;
        if (settled) return void back?.(); // answered before open resolved
        if (tab?.id === undefined) return;
        offClosed = deps.closed(tab.id, () => finish(() => resolve(null)));
      },
      (error) => finish(() => reject(error)),
    );
  });
}

/**
 * Asks for the microphone, and the camera too when wanted. A refused camera falls back to the mic alone, so a
 * camera problem never blocks recording. Run from an extension tab, not the side panel.
 */
export async function requestAccess(wantCamera: boolean, media: Pick<MediaDevices, 'getUserMedia'> = navigator.mediaDevices): Promise<PermissionResult> {
  const grab = async (constraints: MediaStreamConstraints): Promise<boolean> => {
    try {
      (await media.getUserMedia(constraints)).getTracks().forEach((t) => t.stop());
      return true;
    } catch {
      return false;
    }
  };
  if (wantCamera && (await grab({ audio: true, video: true }))) return { mic: true, camera: true };
  return { mic: await grab({ audio: true }), camera: false };
}
