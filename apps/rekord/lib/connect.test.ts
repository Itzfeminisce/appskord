import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { connectErrorMessage, optionalKeyNames, pickProviders, requiredKeyNames, transcriptionKeyRejected, verifyTranscriptionKey } from './connect';
import { checkKeys, connectPaste, connectPenv, ensureKeys, forgetAll, type KeyResults, loadKeys, loadToken, PenvError, saveKeyStatus } from './penv';
import { DEFAULT_SETTINGS } from './settings';

const TARGET = { org: 'acme', project: 'notes', env: 'dev' };
const penvOk = () =>
  vi.fn(async () => new Response(JSON.stringify({ keys: [{ name: 'GROQ_API_KEY', value: 'gsk_test' }] }), { status: 200 }));

describe('connect', () => {
  beforeEach(() => fakeBrowser.reset());

  it('lists the key names the chosen providers need', () => {
    expect(requiredKeyNames(DEFAULT_SETTINGS)).toEqual(['GROQ_API_KEY']);
    expect(
      requiredKeyNames({ transcription: { provider: 'openai', model: 'gpt-transcribe' }, summary: { provider: 'ollama', model: 'x' } }),
    ).toEqual(['OPENAI_API_KEY']);
  });

  it('checkKeys checks each key against its own provider', async () => {
    const statusFor: Record<string, number> = {
      'https://api.groq.com/openai/v1/models': 200,
      'https://api.openai.com/v1/models': 401,
      'https://api.anthropic.com/v1/models': 403,
      'https://openrouter.ai/api/v1/models': 503,
    };
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('deepgram')) throw new TypeError('offline');
      return new Response('{}', { status: statusFor[String(url)] ?? 500 });
    });
    const results = await checkKeys(
      {
        GROQ_API_KEY: 'gsk_test',
        OPENAI_API_KEY: 'sk_test',
        ANTHROPIC_API_KEY: 'sk_test',
        OPENROUTER_API_KEY: 'sk_test',
        DEEPGRAM_API_KEY: 'dg_test',
        OTHER_THING: 'x_test',
      },
      fetchImpl as typeof fetch,
    );
    expect(results).toEqual({
      GROQ_API_KEY: 'ok',
      OPENAI_API_KEY: 'rejected',
      ANTHROPIC_API_KEY: 'rejected',
      OPENROUTER_API_KEY: 'unreachable',
      DEEPGRAM_API_KEY: 'unreachable',
    });
    const calls = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    const headersOf = (part: string) => calls.find(([u]) => u.includes(part))?.[1].headers;
    expect(headersOf('groq')).toEqual({ Authorization: 'Bearer gsk_test' });
    expect(headersOf('anthropic')).toMatchObject({ 'x-api-key': 'sk_test', 'anthropic-version': '2023-06-01' });
    expect(headersOf('deepgram')).toEqual({ Authorization: 'Token dg_test' });
    expect(JSON.stringify(results)).not.toMatch(/_test/);
  });

  it('pickProviders keeps working providers and falls back in order', () => {
    const base = { ...DEFAULT_SETTINGS, features: { ...DEFAULT_SETTINGS.features } };
    const all: KeyResults = { GROQ_API_KEY: 'ok', DEEPGRAM_API_KEY: 'ok' };
    expect(pickProviders(all, base)).toEqual({
      transcription: base.transcription,
      summary: base.summary,
      features: base.features,
    });
    const groqBad = pickProviders(
      { GROQ_API_KEY: 'rejected', OPENAI_API_KEY: 'ok', ANTHROPIC_API_KEY: 'ok', DEEPGRAM_API_KEY: 'unreachable' },
      base,
    );
    expect(groqBad.transcription).toEqual({ provider: 'openai', model: 'gpt-transcribe' });
    expect(groqBad.summary.provider).toBe('openai');
    expect(groqBad.features).toEqual({ ...base.features, speakerNames: false });
    const onlyAnthropic = pickProviders({ GROQ_API_KEY: 'rejected', ANTHROPIC_API_KEY: 'ok' }, base);
    expect(onlyAnthropic.transcription).toEqual(base.transcription);
    expect(onlyAnthropic.summary.provider).toBe('anthropic');
    const ollama = pickProviders({}, { ...base, summary: { provider: 'ollama', model: 'llama3.2' } });
    expect(ollama.summary).toEqual({ provider: 'ollama', model: 'llama3.2' });
  });

  it('keeps a rejected key and reports it to Start', async () => {
    await connectPenv('pck_test', TARGET, penvOk());
    const rejected = vi.fn(async () => new Response('', { status: 401 }));
    const results = await checkKeys(await loadKeys(), rejected);
    await saveKeyStatus(results);
    expect(await loadKeys()).toEqual({ GROQ_API_KEY: 'gsk_test' });
    expect(await loadToken()).toBe('pck_test');
    expect(await ensureKeys(penvOk())).toBe('ready');
    expect(await transcriptionKeyRejected(DEFAULT_SETTINGS, rejected)).toBe(true);
    const fixed = vi.fn(async () => new Response('{}', { status: 200 }));
    expect(await transcriptionKeyRejected(DEFAULT_SETTINGS, fixed)).toBe(false);
    expect(await transcriptionKeyRejected(DEFAULT_SETTINGS, rejected)).toBe(false);
    await saveKeyStatus(results);
    await forgetAll();
    expect(await transcriptionKeyRejected(DEFAULT_SETTINGS)).toBe(false);
  });

  it('verifies the transcription key with GET /models', async () => {
    const ok = vi.fn(async () => new Response('{}', { status: 200 }));
    await verifyTranscriptionKey(DEFAULT_SETTINGS, { GROQ_API_KEY: 'gsk_test' }, ok);
    expect(ok).toHaveBeenCalledWith('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: 'Bearer gsk_test' },
    });
    const rejected = vi.fn(async () => new Response('', { status: 401 }));
    const err = await verifyTranscriptionKey(DEFAULT_SETTINGS, { GROQ_API_KEY: 'gsk_test' }, rejected).catch((e) => e);
    expect(connectErrorMessage(err)).toMatch(/rejected GROQ_API_KEY/);
    expect(connectErrorMessage(err)).not.toContain('gsk_test');
    await expect(verifyTranscriptionKey(DEFAULT_SETTINGS, {}, ok)).rejects.toThrow(/No GROQ_API_KEY/);
  });

  it('turns penv errors into plain words', () => {
    expect(connectErrorMessage(new PenvError('unauthorized', 'x', 401))).toMatch(/didn’t accept that token/);
    expect(connectErrorMessage(new PenvError('not-found', 'x', 404))).toMatch(/couldn’t find that environment/);
    expect(connectErrorMessage(new PenvError('write-only', 'x'))).toMatch(/write-only/);
    expect(connectErrorMessage(new TypeError('fetch failed'))).toMatch(/Couldn’t reach/);
  });

  it('keeps the optional DEEPGRAM_API_KEY but never requires it', async () => {
    expect(optionalKeyNames(DEFAULT_SETTINGS)).toEqual(['DEEPGRAM_API_KEY', 'NOTION_TOKEN']);
    expect(requiredKeyNames(DEFAULT_SETTINGS)).not.toContain('DEEPGRAM_API_KEY');
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      keys: [{ name: 'GROQ_API_KEY', value: 'gsk_test' }, { name: 'DEEPGRAM_API_KEY', value: 'dg_test' }],
    }), { status: 200 }));
    expect(await connectPenv('pck_test', TARGET, fetchImpl)).toEqual(['DEEPGRAM_API_KEY', 'GROQ_API_KEY']);
    expect((await loadKeys()).DEEPGRAM_API_KEY).toBe('dg_test');
    expect(await connectPaste({ GROQ_API_KEY: 'gsk_test', DEEPGRAM_API_KEY: ' dg_test ' })).toEqual(['DEEPGRAM_API_KEY', 'GROQ_API_KEY']);
    expect((await loadKeys()).DEEPGRAM_API_KEY).toBe('dg_test');
  });
});
