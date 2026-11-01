import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { stateFor } from '../lib/ai/errors';
import { reasonFor } from './MakingFailed';
import { penvKeysLine } from './Settings';
import SettingsModel, { checkProblemFor, listOnOpen, modelCheckProblemLine, ModelOptions, seconds } from './SettingsModel';

describe('SettingsModel', () => {
  const html = renderToStaticMarkup(<SettingsModel />).replace(/&quot;/g, '"');
  it('renders every state with the frame copy', () => {
    for (const text of [
      'model-picker-open · Settings (Model)', 'Suggested', 'Recommended', 'Faster', 'From OpenAI', 'Use “gpt-4” as typed', 'Typing filters the list. Enter uses exactly what you typed.',
      'Getting OpenAI’s list… You can keep typing.',
      'OpenAI’s full list didn’t load, so the suggestions show instead. You can still type any model name.', 'Try again',
      'Your choice', 'Not in the list. Check it once to be sure.', 'Check model',
      'Asking gpt-4o-2024-11-20 a test question…', 'gpt-4o-2024-11-20 answered in 1.4 s. Ready for clips.',
      'OpenAI doesn’t have gpt-4o-maxi', 'Check the spelling, or pick a suggested model. Motikord keeps using gpt-4.1 until this one works.', 'Use gpt-4.1', 'Show models',
      'whisper-1 can’t write clips', 'It works with sound, not text. Pick a chat model like gpt-4.1.',
      'Add an Anthropic key to use it', 'You can choose a model now. Clips start once a key works.', 'Paste a key', 'Use Penv Cloud',
      'Chrome picks its own built-in model. There’s nothing to choose.',
    ]) expect(html).toContain(text);
  });
  it('drops the old warning states', () => {
    expect(html).not.toContain('Couldn’t load');
    expect(html).not.toContain('Loading OpenAI’s models');
  });
  it('filters by what you typed and offers it as typed', () => {
    const list = renderToStaticMarkup(<ModelOptions provider="openai" live={['gpt-4o-mini', 'o3']} query="mini" chosen="gpt-4.1" onPick={() => undefined} />).replace(/&quot;/g, '"');
    expect(list).toContain('gpt-4.1-mini');
    expect(list).toContain('gpt-4o-mini');
    expect(list).not.toContain('>o3<');
    expect(list).toContain('Use “mini” as typed');
    const exact = renderToStaticMarkup(<ModelOptions provider="openai" live={[]} query="gpt-4o" chosen="gpt-4.1" onPick={() => undefined} />);
    expect(exact).not.toContain('as typed');
  });
  it('says the check time in tenths of a second', () => {
    expect(seconds(1234)).toBe('1.2');
    expect(seconds(20)).toBe('0.1');
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
    expect(penvKeysLine('openai', { OPENAI_API_KEY: 'sk-test', GROQ_API_KEY: 'gsk_test' })).toBe('OpenAI, Groq and Pexels keys');
    expect(penvKeysLine('groq', {})).toBe('Groq and Pexels keys');
  });
});

describe('MakingFailed', () => {
  it('gives the failed step the state’s message line', () => {
    expect(reasonFor('making-failed', 'groq', 'x')).toBe('The AI’s answer didn’t work, even on a second try.');
    expect(reasonFor('provider-down', 'groq', 'x')).toBe('Groq isn’t responding');
    expect(reasonFor('provider-busy', 'openai', 'x')).toBe('OpenAI is still busy');
    expect(reasonFor('offline', 'groq', 'x')).toBe('You’re offline');
    expect(reasonFor('model-not-found', 'openai', 'gpt-4o-maxi')).toBe('OpenAI doesn’t have gpt-4o-maxi');
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
    expect(modelCheckProblemLine('key-refused', 'openai', 'gpt-4.1')).toBe('OpenAI refused the key. Check it in Paste a key.');
    expect(modelCheckProblemLine('offline', 'openai', 'gpt-4.1')).toBe('Couldn’t reach OpenAI. Check your connection, then check gpt-4.1 again.');
    expect(modelCheckProblemLine('busy', 'openai', 'gpt-4.1')).toBe('OpenAI is busy. Try gpt-4.1 again in a moment.');
    expect(modelCheckProblemLine('server-error', 'openai', 'gpt-4.1')).toBe('OpenAI had a problem on its side. Try gpt-4.1 again soon.');
  });
});
