import { describe, expect, it } from 'vitest';
import { PROVIDERS } from '@/lib/llm';
import { header, shortModel } from './deps';

describe('Ask AI header', () => {
  it('names the provider from @appskord/llm and the short model, never the id', () => {
    expect(shortModel('gpt-6-luna')).toBe('GPT-6 Luna');
    expect(shortModel('claude-haiku-5-5')).toBe('Claude Haiku 5.5');
    expect(shortModel('openai/gpt-oss-120b')).toBe('GPT-oss');
    expect(header(PROVIDERS.anthropic)).toBe('Anthropic · Claude Haiku 5.5');
  });
});
