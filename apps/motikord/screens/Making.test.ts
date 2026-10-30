import { describe, expect, it } from 'vitest';
import { shouldRemake } from './Making';

describe('shouldRemake', () => {
  it('remakes a running run on a new type', () => expect(shouldRemake('running', 'quote', 'promo', false)).toBe(true));
  it('leaves a done or failed run alone on remount', () => {
    expect(shouldRemake('done', 'quote', 'promo', false)).toBe(false);
    expect(shouldRemake('failed', 'quote', 'promo', false)).toBe(false);
  });
  it('remakes a finished run when Change asked for it', () => expect(shouldRemake('failed', 'quote', 'promo', true)).toBe(true));
  it('does nothing for the same type or no type', () => {
    expect(shouldRemake('running', 'promo', 'promo', true)).toBe(false);
    expect(shouldRemake('running', undefined, 'promo', true)).toBe(false);
  });
});
