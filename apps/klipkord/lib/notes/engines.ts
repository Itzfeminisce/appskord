import { chat, PROVIDERS, type FetchLike } from '../llm';
import { updateSettings } from '../settings';
import type { CloudNotes, ModelChoice, NotesProvider, Settings } from '../types';

export const OLLAMA_URL = 'http://localhost:11434';

export interface CompleteOptions { json?: boolean; signal?: AbortSignal }

export interface Engine {
  id: NotesProvider;
  /** Characters of transcript one call can take; longer transcripts are condensed in chunks. */
  maxChars: number;
  complete(system: string, user: string, opts?: CompleteOptions): Promise<string>;
}

interface LanguageModelApi {
  availability(): Promise<string>;
  create(o?: { initialPrompts?: { role: string; content: string }[]; signal?: AbortSignal }): Promise<{
    prompt(input: string, o?: { signal?: AbortSignal }): Promise<string>;
    destroy(): void;
  }>;
}

const languageModel = (g: object): LanguageModelApi | undefined => (g as { LanguageModel?: LanguageModelApi }).LanguageModel;

export async function builtinAvailable(g: object = globalThis): Promise<boolean> {
  try { return (await languageModel(g)?.availability()) === 'available'; } catch { return false; }
}

/** Chrome's built-in model has a small context, so it gets small chunks. */
function builtinEngine(g: object): Engine {
  return {
    id: 'builtin', maxChars: 8_000,
    async complete(system, user, opts) {
      const api = languageModel(g);
      if (!api) throw new Error('Chrome’s built-in AI is not available.');
      const session = await api.create({ initialPrompts: [{ role: 'system', content: system }], signal: opts?.signal });
      try { return await session.prompt(user, { signal: opts?.signal }); } finally { session.destroy(); }
    },
  };
}

/** The first model Ollama has, or null when Ollama does not answer or has none. */
export async function ollamaModel(fetchFn: FetchLike): Promise<string | null> {
  try {
    const res = await fetchFn(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { models?: { name?: unknown }[] };
    const name = body.models?.find((m) => typeof m.name === 'string')?.name;
    return typeof name === 'string' ? name : null;
  } catch {
    return null;
  }
}

function ollamaEngine(model: string, fetchFn: FetchLike): Engine {
  return {
    id: 'ollama', maxChars: 16_000,
    async complete(system, user, opts) {
      const res = await fetchFn(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, stream: false, ...(opts?.json ? { format: 'json' } : {}), options: { temperature: 0.2, num_ctx: 8192 },
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        }),
        signal: opts?.signal,
      });
      if (!res.ok) throw new Error(`Ollama returned an error (${res.status}).`);
      const content = ((await res.json()) as { message?: { content?: unknown } }).message?.content;
      if (typeof content !== 'string') throw new Error('Ollama sent an unexpected reply.');
      return content;
    },
  };
}

/** The Ollama model to use: the picked one when Ollama has it, else the first it has. */
async function ollamaPick(wanted: string, fetchFn: FetchLike): Promise<string | null> {
  if (!wanted) return ollamaModel(fetchFn);
  try {
    const res = await fetchFn(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2_000) });
    if (!res.ok) return null;
    const names = ((await res.json()) as { models?: { name?: unknown }[] }).models?.map((m) => m.name) ?? [];
    return names.includes(wanted) ? wanted : ((names.find((n) => typeof n === 'string') as string | undefined) ?? null);
  } catch {
    return null;
  }
}

function cloudEngine(id: CloudNotes, model: string, deps: EngineDeps): Engine {
  return {
    id, maxChars: 30_000,
    complete: (system, user, opts) =>
      chat([{ role: 'system', content: system }, { role: 'user', content: user }], {
        provider: id, model, keys: deps.keys, json: opts?.json, signal: opts?.signal,
        onRepick: model ? (next) => (deps.onModelGone ?? saveGone)({ provider: id, model: next, gone: model }) : undefined,
      }, deps.fetchFn),
  };
}

const saveGone = (notes: ModelChoice<NotesProvider>) =>
  void updateSettings({ notes }).catch((error) => console.error('Klipkord: could not save the new notes model', error));

/** Cloud notes providers, in fallback order. */
export const CLOUD_NOTES: CloudNotes[] = ['groq', 'openai', 'anthropic', 'openrouter', 'google', 'xai'];
export const isCloudNotes = (p: NotesProvider): p is CloudNotes => (CLOUD_NOTES as string[]).includes(p);

/** The user's pick first, then built-in AI, Ollama and the cloud providers in that order. */
export function engineOrder(preferred: NotesProvider): NotesProvider[] {
  return [preferred, ...(['builtin', 'ollama', ...CLOUD_NOTES] as const).filter((e) => e !== preferred)];
}

export interface EngineDeps {
  settings: Pick<Settings, 'notes'>;
  keys: Record<string, string>;
  fetchFn: FetchLike;
  /** Defaults to Chrome's `LanguageModel`; tests pass a fake. */
  globalObject?: object;
  /** The picked model was gone and the provider's listed one answered instead. */
  onModelGone?: (choice: ModelChoice<NotesProvider>) => void;
}

/** Engines that can run now, in the order to try them. Empty when none can. Only the picked one uses the picked model. */
export async function availableEngines(deps: EngineDeps): Promise<Engine[]> {
  const g = deps.globalObject ?? globalThis;
  const picked = deps.settings.notes;
  const out: Engine[] = [];
  for (const id of engineOrder(picked.provider)) {
    const model = id === picked.provider ? picked.model : '';
    if (id === 'builtin' && (await builtinAvailable(g))) out.push(builtinEngine(g));
    else if (id === 'ollama') {
      const name = await ollamaPick(model, deps.fetchFn);
      if (name) out.push(ollamaEngine(name, deps.fetchFn));
    } else if (isCloudNotes(id) && deps.keys[PROVIDERS[id].keyName]) out.push(cloudEngine(id, model, deps));
  }
  return out;
}
