import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, GROQ_BOTH, getSettings, mergeSettings, migrateAi, onSettingsChanged, updateSettings, usesCloud } from './settings';

describe('settings', () => {
  beforeEach(() => fakeBrowser.reset());

  it('returns defaults when nothing is stored', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('fills missing nested fields from the defaults', () => {
    const s = mergeSettings({ language: 'en', capture: { mode: 'screen' } as never });
    expect(s.language).toBe('en');
    expect(s.capture).toEqual({ ...DEFAULT_SETTINGS.capture, mode: 'screen' });
    expect(s.bubble).toEqual(DEFAULT_SETTINGS.bubble);
  });

  it('has the v2 defaults', () => {
    expect(DEFAULT_SETTINGS.bubble.mode).toBe('floating');
    expect(DEFAULT_SETTINGS.draw).toEqual({ tool: 'pen', color: '#C2410C' });
    expect(DEFAULT_SETTINGS.cleanup).toEqual({ pauses: true, fillers: true, minPause: 2 });
    expect(DEFAULT_SETTINGS.drive).toBeUndefined();
  });

  it('fills the v2 fields into stored v1 settings', () => {
    const s = mergeSettings({ bubble: { corner: 'top-right', size: 'S' }, cleanup: { minPause: 3 } as never });
    expect(s.bubble).toEqual({ corner: 'top-right', size: 'S', mode: 'floating' });
    expect(s.draw).toEqual(DEFAULT_SETTINGS.draw);
    expect(s.cleanup).toEqual({ pauses: true, fillers: true, minPause: 3 });
  });

  it('merges draw and cleanup one level deep', async () => {
    await updateSettings({ draw: { tool: 'rings' }, cleanup: { fillers: false } });
    const s = await getSettings();
    expect(s.draw).toEqual({ tool: 'rings', color: '#C2410C' });
    expect(s.cleanup).toEqual({ pauses: true, fillers: false, minPause: 2 });
  });

  it('merges partial updates one level deep', async () => {
    await updateSettings({ capture: { quality: '720p' }, bubble: { size: 'L' } });
    await updateSettings({ notes: { provider: 'anthropic', model: 'claude-opus-5-5' }, capture: { mic: false } });
    const s = await getSettings();
    expect(s.notes).toEqual({ provider: 'anthropic', model: 'claude-opus-5-5' });
    expect(s.capture).toEqual({ ...DEFAULT_SETTINGS.capture, quality: '720p', mic: false });
    expect(s.bubble).toEqual({ corner: 'bottom-left', size: 'L', mode: 'floating' });
  });

  it('defaults to Whisper and Chrome\'s built-in AI', () => {
    expect(DEFAULT_SETTINGS.transcripts).toEqual({ provider: 'local', model: 'whisper' });
    expect(DEFAULT_SETTINGS.notes).toEqual({ provider: 'builtin', model: 'builtin' });
    expect(usesCloud(DEFAULT_SETTINGS)).toBe(false);
    expect(usesCloud({ ...DEFAULT_SETTINGS, notes: { provider: 'openai', model: 'gpt-6.1-sol' } })).toBe(true);
  });

  it('moves ai: cloud to Groq for both pickers with today\'s models, and drops the old fields', () => {
    const s = mergeSettings({ ai: 'cloud', notesEngine: 'groq', language: 'fr' } as never);
    expect(s.transcripts).toEqual({ provider: 'groq', model: 'whisper-large-v3-turbo' });
    expect(s.notes).toEqual({ provider: 'groq', model: 'openai/gpt-oss-120b' });
    expect(s.language).toBe('fr');
    expect('ai' in s || 'notesEngine' in s).toBe(false);
  });

  it('moves ai: local to Whisper and keeps the old notes engine', () => {
    expect(migrateAi({ ai: 'local', notesEngine: 'builtin' } as never)).toEqual({ transcripts: DEFAULT_SETTINGS.transcripts, notes: DEFAULT_SETTINGS.notes });
    expect(migrateAi({ ai: 'local', notesEngine: 'ollama' } as never).notes).toEqual({ provider: 'ollama', model: '' });
    expect(migrateAi({ ai: 'local', notesEngine: 'groq' } as never)).toEqual({ transcripts: DEFAULT_SETTINGS.transcripts, notes: GROQ_BOTH.notes });
  });

  it('writes only the new fields back once anything is saved', async () => {
    await fakeBrowser.storage.local.set({ settings: { ai: 'cloud', notesEngine: 'groq' } });
    await updateSettings({ language: 'de' });
    const stored = (await fakeBrowser.storage.local.get('settings')).settings as Record<string, unknown>;
    expect(stored.ai).toBeUndefined();
    expect(stored.notesEngine).toBeUndefined();
    expect(stored.transcripts).toEqual(GROQ_BOTH.transcripts);
  });

  it('keeps a new pick over the old fields', () => {
    const s = mergeSettings({ ai: 'cloud', notes: { provider: 'openai', model: 'gpt-6-luna' } } as never);
    expect(s.notes).toEqual({ provider: 'openai', model: 'gpt-6-luna' });
    expect(s.transcripts).toEqual(GROQ_BOTH.transcripts);
  });

  it('replaces a retired model with the provider\'s Recommended one and remembers it (picker-model-gone)', () => {
    const s = mergeSettings({ notes: { provider: 'groq', model: 'llama-3.3-70b-versatile' }, transcripts: { provider: 'openai', model: 'gpt-4o-transcribe' } });
    expect(s.notes).toEqual({ provider: 'groq', model: 'openai/gpt-oss-120b', gone: 'llama-3.3-70b-versatile' });
    expect(s.transcripts).toEqual({ provider: 'openai', model: 'gpt-transcribe', gone: 'gpt-4o-transcribe' });
  });

  it('keeps a stored id for a provider with no Recommended model, and never leaves a cloud pick empty', () => {
    const slug = 'meta-llama/llama-4-maverick-17b-128e-instruct';
    expect(mergeSettings({ notes: { provider: 'openrouter', model: slug } }).notes).toEqual({ provider: 'openrouter', model: slug });
    expect(mergeSettings({ notes: { provider: 'groq', model: '' } }).notes).toEqual({ provider: 'groq', model: 'openai/gpt-oss-120b' });
    expect(mergeSettings({ transcripts: { provider: 'openai', model: '' } }).transcripts).toEqual({ provider: 'openai', model: 'gpt-transcribe' });
  });

  it('notifies listeners and unsubscribes', async () => {
    const cb = vi.fn();
    const off = onSettingsChanged(cb);
    await updateSettings({ language: 'fr' });
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ language: 'fr' }));
    off();
    await updateSettings({ language: 'de' });
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
