import { describe, expect, it } from 'vitest';
import { PROVIDERS } from '@/lib/llm';
import { header, shortModel } from './deps';

describe('Ask AI header', () => {
  it('names the provider from @appskord/llm and the short model, never the id', () => {
    expect(shortModel('llama-3.3-70b-versatile')).toBe('Llama 3.3');
    expect(shortModel('gpt-4.1-mini')).toBe('GPT-4.1 mini');
    expect(shortModel('claude-haiku-4-5')).toBe('Claude Haiku 4.5');
    expect(shortModel('openai/gpt-oss-120b')).toBe('GPT-oss');
    expect(header(PROVIDERS.anthropic)).toBe('Anthropic · Claude Haiku 4.5');
  });
});
