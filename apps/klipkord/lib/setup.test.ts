import { describe, expect, it, vi } from 'vitest';
import {
  aiSettings, builtinAiPresent, canStart, choiceFor, hostFor, isKeyName, jobsFor, noUsableKeys, classifyPaste, cloudSettings, detectMachine, isFirstRun,
  missingKeys, OLLAMA_DOWN, penvRowStatus, pickerGroups, pickerValue, requestAccess, setupChoice, typedFailure,
} from './setup';
import { DEFAULT_SETTINGS, GROQ_BOTH } from './settings';
import { LLMError } from '@appskord/llm';

describe('setupChoice', () => {
  it('picks this computer when WebGPU and built-in AI both work', () => {
    expect(setupChoice({ webgpu: true, builtinAi: true })).toEqual({ ai: 'local', states: [] });
  });

  it('picks Groq and shows slow-computer without WebGPU', () => {
    expect(setupChoice({ webgpu: false, builtinAi: true })).toEqual({ ai: 'cloud', states: ['slow-computer'] });
  });

  it('falls back to Ollama for notes and shows no-built-in-ai', () => {
    expect(setupChoice({ webgpu: true, builtinAi: false })).toEqual({ ai: 'local', states: ['no-built-in-ai'] });
  });

  it('handles both missing (the owner’s machine)', () => {
    expect(setupChoice({ webgpu: false, builtinAi: false })).toEqual({ ai: 'cloud', states: ['no-built-in-ai', 'slow-computer'] });
  });

  it('Faster with Groq sets Groq for both pickers; local picks Whisper and built-in AI, or Ollama without it', () => {
    expect(aiSettings('cloud', true)).toEqual(GROQ_BOTH);
    expect(GROQ_BOTH).toEqual({ transcripts: { provider: 'groq', model: 'whisper-large-v3-turbo' }, notes: { provider: 'groq', model: 'openai/gpt-oss-120b' } });
    expect(aiSettings('local', true)).toEqual({ transcripts: DEFAULT_SETTINGS.transcripts, notes: DEFAULT_SETTINGS.notes });
    expect(aiSettings('local', false).notes).toEqual({ provider: 'ollama', model: '' });
  });

  it('assumes nothing while the check is running', () => {
    expect(setupChoice({ webgpu: null, builtinAi: null })).toEqual({ ai: 'local', states: [] });
  });
});

describe('detectMachine', () => {
  it('reads WebGPU and built-in AI availability', async () => {
    const env = {
      gpu: { requestAdapter: async () => ({}) },
      summarizer: { availability: vi.fn(async (_options?: { outputLanguage?: string }) => 'downloadable') },
      languageModel: { availability: async () => 'unavailable' },
    };
    expect(await detectMachine(env)).toEqual({ webgpu: true, builtinAi: true });
    expect(env.summarizer.availability).toHaveBeenCalledWith({ outputLanguage: 'en' });
  });

  it('counts absent APIs, a null adapter and throwing probes as missing', async () => {
    expect(await detectMachine({})).toEqual({ webgpu: false, builtinAi: false });
    const env = {
      gpu: { requestAdapter: async () => null },
      summarizer: { availability: async () => { throw new Error('no'); } },
      languageModel: { availability: async () => 'unavailable' },
    };
    expect(await detectMachine(env)).toEqual({ webgpu: false, builtinAi: false });
  });

  it('either built-in API is enough', () => {
    expect(builtinAiPresent(undefined, 'available')).toBe(true);
    expect(builtinAiPresent('unavailable', undefined)).toBe(false);
  });
});

describe('isFirstRun', () => {
  it('is true only with no key source, no recordings and nothing confirmed', () => {
    expect(isFirstRun({ keySource: null }, 0)).toBe(true);
    expect(isFirstRun({ keySource: null, onboarded: true }, 0)).toBe(false);
    expect(isFirstRun({ keySource: 'paste' }, 0)).toBe(false);
    expect(isFirstRun({ keySource: null }, 2)).toBe(false);
  });
});

describe('keys', () => {
  it('describes a pasted key', () => {
    expect(classifyPaste('gsk_test')).toEqual({ kind: 'known', name: 'GROQ_API_KEY', title: 'This is a Groq key', jobs: 'Covers transcripts and notes' });
    expect(classifyPaste('sk-or-test')).toMatchObject({ title: 'This is a OpenRouter key', jobs: 'Covers notes' });
    expect(classifyPaste('nope')).toEqual({ kind: 'unknown' });
    expect(classifyPaste('  ')).toEqual({ kind: 'empty' });
  });

  it('allows Start recording once a usable key works', () => {
    expect(canStart([], {})).toBe(false);
    expect(canStart(['GROQ_API_KEY'], { GROQ_API_KEY: 'checking' })).toBe(false);
    expect(canStart(['GROQ_API_KEY'], { GROQ_API_KEY: 'rejected' })).toBe(false);
    expect(canStart(['GROQ_API_KEY'], { GROQ_API_KEY: 'ok' })).toBe(true);
    expect(canStart(['NOTION_TOKEN'], { NOTION_TOKEN: 'ok' })).toBe(false);
  });

  it('turns cloud AI on only for a working Groq key', () => {
    expect(cloudSettings(['GROQ_API_KEY'], { GROQ_API_KEY: 'ok' })).toEqual(GROQ_BOTH);
    expect(cloudSettings(['OPENAI_API_KEY'], { OPENAI_API_KEY: 'ok' })).toBeNull();
    expect(missingKeys(['GROQ_API_KEY'], ['OPENAI_API_KEY'])).toEqual(['GROQ_API_KEY']);
  });
});

describe('settings rows', () => {
  it('names the providers whose keys Penv Cloud shares', () => {
    expect(penvRowStatus(true, ['GROQ_API_KEY'])).toBe('Connected · Groq key');
    expect(penvRowStatus(true, ['GROQ_API_KEY', 'OPENAI_API_KEY'])).toBe('Connected · Groq and OpenAI keys');
    expect(penvRowStatus(true, ['GROQ_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY'])).toBe('Connected · Groq, OpenAI and Gemini keys');
    expect(penvRowStatus(false, ['GROQ_API_KEY'])).toBeNull();
    expect(penvRowStatus(true, [])).toBeNull();
  });
});

describe('model pickers', () => {
  const s = { ...DEFAULT_SETTINGS };
  const ids = (g: { models: { id: string }[] }) => g.models.map((m) => m.id);

  it('maps saved choices to picker values and back', () => {
    expect(pickerValue('transcripts', s)).toEqual({ provider: 'local', model: 'whisper' });
    expect(pickerValue('notes', s)).toEqual({ provider: 'local', model: 'builtin' });
    expect(pickerValue('notes', { ...s, notes: { provider: 'ollama', model: 'llama3.2' } })).toEqual({ provider: 'local', model: 'ollama:llama3.2' });
    expect(choiceFor('notes', { provider: 'local', model: 'ollama:llama3.2' })).toEqual({ provider: 'ollama', model: 'llama3.2' });
    expect(choiceFor('notes', { provider: 'local', model: 'builtin' })).toEqual({ provider: 'builtin', model: 'builtin' });
    expect(choiceFor('notes', { provider: 'anthropic', model: 'claude-opus-5-5' })).toEqual({ provider: 'anthropic', model: 'claude-opus-5-5' });
    expect(choiceFor('transcripts', { provider: 'local', model: 'whisper' })).toEqual({ provider: 'local', model: 'whisper' });
    expect(choiceFor('transcripts', { provider: 'openai', model: 'gpt-transcribe' })).toEqual({ provider: 'openai', model: 'gpt-transcribe' });
  });

  it('asks for the picked provider\'s host, and none for Whisper or built-in AI', () => {
    expect(hostFor({ provider: 'groq', model: 'x' })).toBe('https://api.groq.com/*');
    expect(hostFor({ provider: 'openai', model: 'x' })).toBe('https://api.openai.com/*');
    expect(hostFor({ provider: 'google', model: 'x' })).toBe('https://generativelanguage.googleapis.com/*');
    expect(hostFor({ provider: 'ollama', model: '' })).toBe('http://localhost:11434/*');
    expect(hostFor({ provider: 'local', model: 'whisper' })).toBeNull();
    expect(hostFor({ provider: 'builtin', model: 'builtin' })).toBeNull();
  });

  it('lists On this computer, Groq and OpenAI for transcripts, with suggested models before a list loads', () => {
    const groups = pickerGroups('transcripts', s, { keys: ['GROQ_API_KEY'], lists: {}, builtin: false });
    expect(groups.map((g) => [g.id, g.status])).toEqual([['local', 'local'], ['groq', 'ready'], ['openai', 'needs-key']]);
    expect(groups[0]!.models).toEqual([{ id: 'whisper', name: 'Whisper' }]);
    expect(groups[1]!.models).toEqual([{ id: 'whisper-large-v3-turbo', tag: 'Recommended' }, { id: 'whisper-large-v3' }]);
    expect(groups[2]).toMatchObject({ addKeyLabel: 'Add an OpenAI key', mark: 'OA', models: [] });
  });

  it('lists every chat provider in the frame\'s order, with marks, aliases and key rows', () => {
    const groups = pickerGroups('notes', s, { keys: [], lists: {}, builtin: true, ollama: null });
    expect(groups.map((g) => g.name)).toEqual(['On this computer', 'Groq', 'OpenAI', 'Anthropic', 'Gemini', 'xAI', 'OpenRouter']);
    expect(groups.map((g) => g.mark)).toEqual([undefined, 'Gq', 'OA', 'An', 'Gm', 'xA', 'OR']);
    expect(groups.map((g) => g.addKeyLabel).slice(1)).toEqual(['Add a Groq key', 'Add an OpenAI key', 'Add an Anthropic key', 'Add a Gemini key', 'Add an xAI key', 'Add an OpenRouter key']);
    expect(groups[3]!.aliases).toEqual(['claude']);
    expect(groups[0]).toMatchObject({ models: [{ id: 'builtin', name: 'Chrome’s built-in AI' }], note: OLLAMA_DOWN });
  });

  it('shows Ollama\'s models, loading, refused and failed lists, and a typed model as Your choice', () => {
    const list = (error?: LLMError) => ({ status: 'done' as const, list: { models: [{ id: 'gpt-6.1-sol', tag: 'Recommended' as const }], source: 'live' as const, ...(error ? { error } : {}) } });
    const notes = { ...s, notes: { provider: 'openai' as const, model: 'my-model' } };
    const groups = pickerGroups('notes', notes, {
      keys: ['GROQ_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY'], builtin: false, ollama: ['llama3.2'],
      lists: { groq: { status: 'loading' }, openai: list(), anthropic: list(new LLMError('x', 'auth')), google: list(new LLMError('x', 'offline')) },
    });
    expect(groups[0]!.models).toEqual([{ id: 'ollama:llama3.2', name: 'Ollama · llama3.2' }]);
    expect(groups.slice(1, 5).map((g) => g.status)).toEqual(['loading', 'ready', 'key-refused', 'failed']);
    expect(groups[2]!.models).toEqual([{ id: 'gpt-6.1-sol', tag: 'Recommended' }, { id: 'my-model', tag: 'Your choice' }]);
    expect(ids(groups[1]!)).toEqual(['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
  });

  it('a typed model that fails its test question shows the picker\'s failure copy', () => {
    const refused = new LLMError('x', 'auth');
    expect(typedFailure('my-model', refused)).toEqual({ refused });
    expect(typedFailure('my-model', new LLMError('x', 'model-not-found'))).toEqual({ line: 'No model called “my-model” in your lists.' });
    expect(typedFailure('my-model', new Error('swapped'))).toEqual({ line: 'No model called “my-model” in your lists.' });
    expect(typedFailure('my-model', new LLMError('Could not reach the AI service.', 'offline'))).toEqual({ line: 'Could not reach the AI service.' });
    const groups = pickerGroups('notes', s, { keys: ['OPENAI_API_KEY'], builtin: false, lists: { openai: { status: 'done', list: { models: [], source: 'suggested', error: refused } } } });
    expect(groups.find((g) => g.id === 'openai')).toMatchObject({ status: 'key-refused', models: expect.arrayContaining([{ id: 'gpt-6.1-sol', tag: 'Recommended' }]) });
  });
});

describe('requestAccess', () => {
  const stream = { getTracks: () => [{ stop() {} }] } as unknown as MediaStream;
  const media = (allow: (c: MediaStreamConstraints) => boolean) => ({
    getUserMedia: async (c?: MediaStreamConstraints) => { if (!allow(c ?? {})) throw new Error('denied'); return stream; },
  });

  it('asks for both and reports camera true', async () => {
    expect(await requestAccess(true, media(() => true))).toEqual({ mic: true, camera: true });
  });

  it('mic only never asks for video', async () => {
    const seen: MediaStreamConstraints[] = [];
    await requestAccess(false, media((c) => { seen.push(c); return true; }));
    expect(seen).toEqual([{ audio: true }]);
  });

  it('keeps the mic when the camera is refused', async () => {
    expect(await requestAccess(true, media((c) => !c.video))).toEqual({ mic: true, camera: false });
    expect(await requestAccess(true, media(() => false))).toEqual({ mic: false, camera: false });
  });
});

describe('noUsableKeys', () => {
  it('is true when nothing loaded or every loaded key was rejected', () => {
    expect(noUsableKeys([], {})).toBe(true);
    expect(noUsableKeys(['GROQ_API_KEY'], { GROQ_API_KEY: 'rejected' })).toBe(true);
  });
  it('is false once any key is not rejected', () => {
    expect(noUsableKeys(['GROQ_API_KEY', 'OPENAI_API_KEY'], { GROQ_API_KEY: 'rejected', OPENAI_API_KEY: 'ok' })).toBe(false);
    expect(noUsableKeys(['GROQ_API_KEY'], { GROQ_API_KEY: 'checking' })).toBe(false);
  });
});

describe('pasted key names', () => {
  const name = (v: string) => { const c = classifyPaste(v); return c.kind === 'known' ? c.name : null; };

  it('recognises each prefix and trims the value', () => {
    expect(name('gsk_test')).toBe('GROQ_API_KEY');
    expect(name('sk-ant-test')).toBe('ANTHROPIC_API_KEY');
    expect(name('sk-or-v1-test')).toBe('OPENROUTER_API_KEY');
    expect(name('sk-test')).toBe('OPENAI_API_KEY');
    expect(name('sk-proj-test')).toBe('OPENAI_API_KEY');
    expect(name('  gsk_test \n')).toBe('GROQ_API_KEY');
  });

  it('leaves keys Klipkord does not use unknown', () => {
    expect(name('hello')).toBeNull();
    expect(name('ab'.repeat(20))).toBeNull();
    expect(name('ntn_test')).toBeNull();
    expect(name('pexels_test')).toBeNull();
  });

  it('Groq covers transcripts and notes; the rest write notes', () => {
    expect(jobsFor('GROQ_API_KEY')).toEqual(['transcripts', 'notes']);
    expect(jobsFor('OPENAI_API_KEY')).toEqual(['transcripts', 'notes']);
    expect(jobsFor('OPENROUTER_API_KEY')).toEqual(['notes']);
    expect(jobsFor('ANTHROPIC_API_KEY')).toEqual(['notes']);
  });

  it('knows which key names are usable', () => {
    expect(isKeyName('OPENAI_API_KEY')).toBe(true);
    expect(isKeyName('NOTION_TOKEN')).toBe(false);
  });
});
