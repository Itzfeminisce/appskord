import { describe, expect, it } from 'vitest';
import { LLMError } from '@appskord/llm';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import type { Settings } from '@/lib/types';
import { choiceFor, hostsFor, isListed, loadFailed, openHosts, OLLAMA_DOWN, pickerGroups, pickerValue, typedFailure, typedProviderFor } from './SettingsAI';

const base = (over: Partial<Pick<Settings, 'transcription' | 'summary'>> = {}) => ({
  transcription: DEFAULT_SETTINGS.transcription,
  summary: DEFAULT_SETTINGS.summary,
  ...over,
});

describe('Rekord model pickers', () => {
  it('lists Deepgram, Groq and OpenAI for Transcription, with nova-3 tagged', () => {
    const s = base({ transcription: { provider: 'deepgram', model: 'nova-3' } });
    const groups = pickerGroups('transcription', s, { keys: ['DEEPGRAM_API_KEY', 'GROQ_API_KEY'], status: {}, lists: {} });
    expect(groups.map((g) => g.id)).toEqual(['deepgram', 'groq', 'openai']);
    expect(groups[0]).toMatchObject({ status: 'ready', mark: 'Dg', models: [{ id: 'nova-3', tag: 'Real time · tells voices apart' }] });
    expect(groups[1]!.models[0]).toEqual({ id: 'whisper-large-v3-turbo', tag: 'Recommended' });
    expect(groups[2]).toMatchObject({ status: 'needs-key', addKeyLabel: 'Add an OpenAI key', models: [] });
  });

  it('hides Sees images, and Recommended on OpenAI speech', () => {
    const lists = {
      openai: { status: 'done' as const, list: { models: [{ id: 'gpt-transcribe', tag: 'Recommended' as const }], source: 'live' as const } },
      groq: { status: 'done' as const, list: { models: [{ id: 'gemma-vision', tag: 'Sees images' as const }, { id: 'x' }], source: 'live' as const } },
    };
    const keys = ['GROQ_API_KEY', 'OPENAI_API_KEY'];
    const speech = pickerGroups('transcription', base(), { keys, status: {}, lists });
    expect(speech[2]!.models).toEqual([{ id: 'gpt-transcribe' }]);
    const chat = pickerGroups('summary', base(), { keys, status: {}, lists });
    expect(chat[0]!.models.slice(0, 2)).toEqual([{ id: 'gemma-vision' }, { id: 'x' }]);
  });

  it('lists the chat providers for Assistant with On this computer last', () => {
    const groups = pickerGroups('summary', base(), { keys: ['GROQ_API_KEY'], status: {}, lists: {}, ollama: ['llama3.2'] });
    expect(groups.map((g) => g.id)).toEqual(['groq', 'openai', 'anthropic', 'google', 'xai', 'openrouter', 'local']);
    expect(groups[3]).toMatchObject({ name: 'Gemini', mark: 'Gm', aliases: ['google'], addKeyLabel: 'Add a Gemini key' });
    expect(groups[6]).toMatchObject({ name: 'On this computer', status: 'local', models: [{ id: 'ollama:llama3.2', name: 'Ollama · llama3.2' }] });
  });

  it('shows a refused key, a failed list and Ollama not running', () => {
    const lists = { openai: { status: 'done' as const, list: { models: [{ id: 'gpt-6.1-sol' }], source: 'suggested' as const, error: new LLMError('x', 'offline') } } };
    const groups = pickerGroups('summary', base(), { keys: ['GROQ_API_KEY', 'OPENAI_API_KEY'], status: { GROQ_API_KEY: 'rejected' }, lists, ollama: null });
    expect(groups[0]!.status).toBe('key-refused');
    expect(groups[1]!.status).toBe('failed');
    expect(groups[6]!.note).toBe(OLLAMA_DOWN);
  });

  it('keeps a saved model the list does not offer as Your choice', () => {
    const s = base({ summary: { provider: 'groq', model: 'my-model' } });
    const groups = pickerGroups('summary', s, { keys: ['GROQ_API_KEY'], status: {}, lists: {} });
    expect(groups[0]!.models.at(-1)).toEqual({ id: 'my-model', tag: 'Your choice' });
  });

  it('round-trips Ollama through the On this computer group and keeps its address', () => {
    const s = base({ summary: { provider: 'ollama', model: 'llama3.2', baseUrl: 'http://localhost:11434/v1' } });
    const v = pickerValue('summary', s);
    expect(v).toEqual({ provider: 'local', model: 'ollama:llama3.2' });
    expect(choiceFor('summary', { provider: 'local', model: 'ollama:qwen3' }, s)).toEqual({ summary: { provider: 'ollama', model: 'qwen3', baseUrl: 'http://localhost:11434/v1' } });
  });

  it('saves the picked provider and model only, dropping a gone model', () => {
    const s = base({ summary: { provider: 'groq', model: 'openai/gpt-oss-120b', gone: 'llama-3.3-70b-versatile' } });
    expect(choiceFor('summary', { provider: 'anthropic', model: 'claude-haiku-5-5' }, s)).toEqual({ summary: { provider: 'anthropic', model: 'claude-haiku-5-5' } });
    expect(choiceFor('transcription', { provider: 'deepgram', model: 'nova-3' }, s)).toEqual({ transcription: { provider: 'deepgram', model: 'nova-3' } });
  });

  it('asks only for the picked provider’s host', () => {
    expect(hostsFor({ transcription: { provider: 'deepgram', model: 'nova-3' } })).toEqual(['https://api.deepgram.com/*', 'wss://api.deepgram.com/*']);
    expect(hostsFor({ summary: { provider: 'anthropic', model: 'claude-haiku-5-5' } })).toEqual(['https://api.anthropic.com/*']);
    expect(hostsFor({ summary: { provider: 'ollama', model: 'llama3.2' } })).toEqual(['http://localhost:11434/*']);
  });

  it('sends a typed name to the current cloud provider, else the first with a key', () => {
    expect(typedProviderFor('summary', base({ summary: { provider: 'openai', model: 'gpt-6-luna' } }), [])).toBe('openai');
    expect(typedProviderFor('summary', base({ summary: { provider: 'ollama', model: 'llama3.2' } }), ['OPENAI_API_KEY'])).toBe('openai');
  });

  it('turns a failed test question into the picker’s words', () => {
    expect(typedFailure('nope', new LLMError('x', 'model-not-found'))).toEqual({ line: 'No model called “nope” in your lists.' });
    expect('refused' in typedFailure('nope', new LLMError('x', 'auth'))).toBe(true);
  });

  it('asks for Ollama on the first open, until its list has loaded', () => {
    expect(openHosts('summary', [], undefined)).toEqual(['http://localhost:11434/*']);
    expect(openHosts('summary', [], null)).toEqual(['http://localhost:11434/*']);
    expect(openHosts('summary', [], ['llama3.2'])).toEqual([]);
    expect(openHosts('transcription', [], undefined)).toEqual([]);
  });

  it('shows a failed state when the key load rejects', () => {
    const state = loadFailed(new Error('no vault'));
    expect(state).toMatchObject({ status: 'done', list: { models: [], source: 'suggested' } });
    const groups = pickerGroups('summary', base(), { keys: ['GROQ_API_KEY'], status: {}, lists: { groq: state } });
    expect(groups.find((g) => g.id === 'groq')!.status).toBe('failed');
  });

  it('never retries Local or Deepgram as a key list', () => {
    expect(['local', 'deepgram', 'ollama'].some(isListed)).toBe(false);
    expect(isListed('groq') && isListed('openai')).toBe(true);
  });
});
