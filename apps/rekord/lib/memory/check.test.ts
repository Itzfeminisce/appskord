import { describe, expect, it } from 'vitest';
import { normalise, quoteFound } from './check';

const seg = (startMs: number, text: string) => ({ startMs, endMs: startMs + 5_000, text });
const quote = (text: string, atMs: number) => ({ text, atMs });

describe('quoteFound', () => {
  const segments = [
    seg(2_000_000, 'Okay so on the pricing side.'),
    seg(2_015_000, "I'll send Sarah the revised pricing deck by Friday, promise."),
    seg(2_400_000, 'Do we keep the free plan?'),
  ];

  it('normalises case, punctuation and curly quotes', () => {
    expect(normalise('I’ll SEND, the deck!')).toEqual(['ill', 'send', 'the', 'deck']);
  });

  it('finds an exact quote near its time', () => {
    expect(quoteFound(quote('I’ll send Sarah the revised pricing deck by Friday.', 2_020_000), segments)).toBe(true);
  });

  it('forgives small ASR slips and a dropped word', () => {
    expect(quoteFound(quote('I will send Sara the revized pricing deck by Friday', 2_020_000), segments)).toBe(true);
  });

  it('rejects a quote outside the window', () => {
    expect(quoteFound(quote('Do we keep the free plan?', 2_020_000), segments)).toBe(false);
    expect(quoteFound(quote('Do we keep the free plan?', 2_020_000), segments, 400_000)).toBe(true);
  });

  it('rejects words that were never said', () => {
    expect(quoteFound(quote('We will cancel the pricing deck entirely tomorrow', 2_020_000), segments)).toBe(false);
    expect(quoteFound(quote('free plan', 2_020_000), [seg(2_020_000, 'fee plans')])).toBe(false);
    expect(quoteFound(quote('', 2_020_000), segments)).toBe(false);
  });

  it('matches across segment boundaries', () => {
    const split = [seg(10_000, 'Fine, the launch email'), seg(15_000, 'goes out on the 14th.')];
    expect(quoteFound(quote('Fine, the launch email goes out on the 14th.', 12_000), split)).toBe(true);
  });
});
