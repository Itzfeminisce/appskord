import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { SUGGESTED } from '@appskord/llm';
import { aiChoice, aiKey, defaultChoice, hostOf, loadPenvConnection, penv, savePenvConnection } from './keys';
import { saveSettings } from './store/settings';

beforeEach(() => fakeBrowser.reset());

describe('keys', () => {
  it('defaults to the first provider with a key, else the first provider, with its suggested model', () => {
    expect(defaultChoice([])).toEqual({ provider: 'groq', model: SUGGESTED.groq.chat![0] });
    expect(defaultChoice(['ANTHROPIC_API_KEY', 'XAI_API_KEY'])).toEqual({ provider: 'anthropic', model: SUGGESTED.anthropic.chat![0] });
  });

  it('uses the picked model once one is saved', async () => {
    await saveSettings({ ai: { provider: 'openai', model: 'some-model' } });
    expect(await aiChoice()).toEqual({ provider: 'openai', model: 'some-model' });
  });

  it('keeps keys in session storage and hands back only the picked provider’s', async () => {
    await penv.connectPaste({ ANTHROPIC_API_KEY: 'sk-test' });
    expect(await aiKey('anthropic')).toBe('sk-test');
    expect(await aiKey('openai')).toBeUndefined();
    expect(await aiKey('ollama')).toBeUndefined();
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
  });

  it('remembers the Penv Cloud connection by names only, and forgets it', async () => {
    const conn = { connectionId: 'c1', org: 'o', project: 'p', env: 'e', keys: ['GROQ_API_KEY'] };
    await savePenvConnection(conn);
    expect(await loadPenvConnection()).toEqual(conn);
    await savePenvConnection(undefined);
    expect(await loadPenvConnection()).toBeUndefined();
  });

  it('asks only for the provider’s own API host', () => {
    expect(hostOf('anthropic')).toBe('https://api.anthropic.com/*');
  });
});
