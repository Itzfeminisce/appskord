import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { stateFor } from '../lib/ai/errors';
import { reasonFor } from './MakingFailed';
import { penvKeysLine } from './Settings';
import { LLMError, type PickerList } from '@appskord/llm';
import { DEFAULT_SETTINGS } from '../lib/settings';
import type { Settings } from '../lib/types';
import SettingsModel, { checkProblemFor, choiceFor, listOnOpen, modelCheckProblemLine, ModelSection, pickerGroups, pickerValue, seconds, typedProviderFor, type ListState } from './SettingsModel';

describe('SettingsModel', () => {
  const html = renderToStaticMarkup(<SettingsModel />).replace(/&quot;/g, '"');
  it('renders every check state with the frame copy', () => {
    for (const text of [
      'Asking gpt-6-astra-2026-09-01 a test question…', 'gpt-6-astra-2026-09-01 answered in 1.4 s. Ready for clips.', 'Check model',
      'OpenAI doesn’t have gpt-6-maxi', 'Check the spelling, or pick a suggested model. Motikord keeps using gpt-6.1-sol until this one works.', 'Use gpt-6.1-sol', 'Show models',
      'gpt-transcribe can’t write clips', 'It works with sound, not text. Pick a chat model like gpt-6.1-sol.',
      'Add an Anthropic key to use it', 'You can choose a model now. Clips start once a key works.', 'Paste a key', 'Use Penv Cloud',
    ]) expect(html).toContain(text);
  });
  it('says the check time in tenths of a second', () => {
    expect(seconds(1234)).toBe('1.2');
    expect(seconds(20)).toBe('0.1');
  });
});

const base: Settings = { ...DEFAULT_SETTINGS, ai: 'cloud', provider: 'openai', models: {} };
const done = (list: PickerList): ListState => ({ status: 'done', list });

describe('the Model picker', () => {
  const keys = { OPENAI_API_KEY: 'sk-test', GROQ_API_KEY: 'gsk_test' };
  it('lists OpenAI first and On this computer last, with the frame marks and key rows', () => {
    const groups = pickerGroups(base, { keys, lists: {}, builtInAi: true });
    expect(groups.map((g) => g.id)).toEqual(['openai', 'groq', 'anthropic', 'google', 'xai', 'openrouter', 'local']);
    expect(groups.map((g) => g.mark)).toEqual(['OA', 'Gq', 'An', 'Gm', 'xA', 'OR', undefined]);
    expect(groups.find((g) => g.id === 'anthropic')).toMatchObject({ status: 'needs-key', addKeyLabel: 'Add an Anthropic key', aliases: ['claude'] });
    expect(groups.find((g) => g.id === 'google')).toMatchObject({ name: 'Gemini', addKeyLabel: 'Add a Gemini key' });
    expect(groups.find((g) => g.id === 'xai')).toMatchObject({ addKeyLabel: 'Add an xAI key', aliases: ['grok'] });
    expect(groups.at(-1)).toMatchObject({ name: 'On this computer', status: 'local', models: [{ id: 'builtin', name: 'Chrome’s built-in AI', tag: 'Simpler clips' }] });
  });
  it('shows the loaded list, a refused key, and a failed list', () => {
    const ok = done({ models: [{ id: 'gpt-6.1-sol', tag: 'Recommended' }, { id: 'gpt-6-astra', tag: 'Sees images' }], source: 'live' });
    const g = (lists: Partial<Record<'openai', ListState>>) => pickerGroups(base, { keys, lists, builtInAi: true })[0]!;
    expect(g({ openai: ok })).toMatchObject({ status: 'ready', models: [{ id: 'gpt-6.1-sol', tag: 'Recommended' }, { id: 'gpt-6-astra', tag: 'Sees images' }] });
    expect(g({ openai: { status: 'loading' } }).status).toBe('loading');
    expect(g({ openai: done({ models: [], source: 'suggested', error: new LLMError('x', 'auth') }) }).status).toBe('key-refused');
    expect(g({ openai: done({ models: [], source: 'suggested', error: new LLMError('x', 'no-list') }) }).status).toBe('failed');
  });
  it('keeps a typed model in its group as Your choice', () => {
    const s = { ...base, models: { openai: 'gpt-6-astra-2026-09-01' } };
    expect(pickerGroups(s, { keys, lists: {}, builtInAi: true })[0]!.models).toEqual([{ id: 'gpt-6-astra-2026-09-01', tag: 'Your choice' }]);
  });
  it('writes provider and models[provider]; On this computer sets ai local', () => {
    expect(choiceFor({ provider: 'groq', model: 'openai/gpt-oss-20b' })).toEqual({ ai: 'cloud', provider: 'groq', models: { groq: 'openai/gpt-oss-20b' } });
    expect(choiceFor({ provider: 'local', model: 'builtin' })).toEqual({ ai: 'local' });
    expect(pickerValue({ ...base, ai: 'local' }).value).toEqual({ provider: 'local', model: 'builtin' });
  });
  it('a retired model shows Recommended and picker-model-gone; never an empty model; OpenRouter keeps its id', () => {
    expect(pickerValue({ ...base, provider: 'groq', models: { groq: 'llama-3.3-70b-versatile' } })).toEqual({ value: { provider: 'groq', model: 'openai/gpt-oss-120b' }, gone: 'llama-3.3-70b-versatile' });
    expect(pickerValue({ ...base, provider: 'groq', models: {} }).value.model).toBe('openai/gpt-oss-120b');
    expect(pickerValue({ ...base, provider: 'openrouter', models: { openrouter: 'meta-llama/llama-4-scout-17b-16e-instruct' } })).toEqual({ value: { provider: 'openrouter', model: 'meta-llama/llama-4-scout-17b-16e-instruct' } });
  });
  it('sends a typed name to the current cloud provider, else the first with a key', () => {
    expect(typedProviderFor(base, {})).toBe('openai');
    expect(typedProviderFor({ ...base, ai: 'local' }, { GROQ_API_KEY: 'gsk_test' })).toBe('groq');
    expect(typedProviderFor({ ...base, ai: 'local' }, {})).toBe('openai');
  });
  it('renders the picker, the check link and the hint, and never a key', () => {
    const html = renderToStaticMarkup(<ModelSection s={base} keys={keys} builtInAi save={() => undefined} onKeys={() => undefined} onPasteKey={() => undefined} onPenv={() => undefined} />);
    for (const text of ['Model', 'gpt-6.1-sol', 'OpenAI · Ready', 'Check model', 'Large, strong models write the best clips. Small ones are faster but simpler.']) expect(html).toContain(text);
    expect(html).not.toContain('sk-test');
    expect(html).not.toContain('gsk_test');
  });
  it('hides Chrome’s built-in AI where Chrome has none', () => {
    expect(pickerGroups(base, { keys, lists: {}, builtInAi: false }).at(-1)!.models).toEqual([]);
  });
});

// X's bug: Settings asked for the list on open without the provider's host, so Chrome blocked it and the list "failed".
describe('the live list on open', () => {
  it('loads only with a key and the host already allowed, and never prompts', async () => {
    const contains = vi.fn(async () => false);
    expect(await listOnOpen('openai', 'sk-test', contains)).toBe(false);
    expect(contains).toHaveBeenCalledWith({ origins: ['https://api.openai.com/*'] });
    expect(await listOnOpen('openai', 'sk-test', async () => true)).toBe(true);
    expect(await listOnOpen('openai', undefined, async () => true)).toBe(false);
    expect(await listOnOpen('groq', 'gsk_test', async () => { throw new Error('no permissions API'); })).toBe(false);
  });
});

describe('Settings Penv Cloud row', () => {
  it('names the chosen provider first, then the other keys and Pexels', () => {
    expect(penvKeysLine('openai', { GROQ_API_KEY: 'gsk_test', OPENAI_API_KEY: 'sk-test', PEXELS_API_KEY: 'px-test' }, true)).toBe('OpenAI, Groq and Pexels keys');
    expect(penvKeysLine('groq', { GROQ_API_KEY: 'gsk_test' }, true)).toBe('Groq key');
  });
  it('claims no keys it does not have: a fresh profile is not connected', () => {
    expect(penvKeysLine('groq', {}, false)).toBe('Not connected');
    expect(penvKeysLine('groq', { GROQ_API_KEY: 'gsk_test' }, false)).toBe('Not connected');
    expect(penvKeysLine('groq', {}, true)).toBe('No keys yet');
  });
});

describe('MakingFailed', () => {
  it('gives the failed step the state’s message line', () => {
    expect(reasonFor('making-failed', 'groq', 'x')).toBe('The AI’s answer didn’t work, even on a second try.');
    expect(reasonFor('provider-down', 'groq', 'x')).toBe('Groq isn’t responding');
    expect(reasonFor('provider-busy', 'openai', 'x')).toBe('OpenAI is still busy');
    expect(reasonFor('offline', 'groq', 'x')).toBe('You’re offline');
    expect(reasonFor('model-not-found', 'openai', 'gpt-6-maxi')).toBe('OpenAI doesn’t have gpt-6-maxi');
  });
  it('maps a missing model to model-not-found', () => {
    expect(stateFor('model-not-found', 'make')).toBe('model-not-found');
    expect(stateFor('not-for-text', 'make')).toBe('model-not-for-text');
  });
});

describe('Check model results', () => {
  it('maps each failure to its frame result', () => {
    expect(checkProblemFor('auth')).toBe('key-refused');
    expect(checkProblemFor('offline')).toBe('offline');
    expect(checkProblemFor('rate-limited')).toBe('busy');
    expect(checkProblemFor('server')).toBe('server-error');
    expect(checkProblemFor('bad-reply')).toBe('server-error');
  });
  it('uses the frame lines', () => {
    expect(modelCheckProblemLine('key-refused', 'openai', 'gpt-6.1-sol')).toBe('OpenAI refused the key. Check it in Paste a key.');
    expect(modelCheckProblemLine('offline', 'openai', 'gpt-6.1-sol')).toBe('Couldn’t reach OpenAI. Check your connection, then check gpt-6.1-sol again.');
    expect(modelCheckProblemLine('busy', 'openai', 'gpt-6.1-sol')).toBe('OpenAI is busy. Try gpt-6.1-sol again in a moment.');
    expect(modelCheckProblemLine('server-error', 'openai', 'gpt-6.1-sol')).toBe('OpenAI had a problem on its side. Try gpt-6.1-sol again soon.');
  });
});
