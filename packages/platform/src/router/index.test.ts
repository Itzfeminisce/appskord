import { describe, expect, it } from 'vitest';
import { canGoBack, clearBackState, parseSearch, pushState, searchParams, stringifySearch } from './index';

const at = (index: number, extra: object = {}) => ({ state: { __TSR_index: index, ...extra } });

describe('search strings', () => {
  it('round-trips plain strings and drops empty values', () => {
    expect(stringifySearch({ clip: '123', scene: undefined, layer: '' })).toBe('?clip=123');
    expect(parseSearch('?clip=123&x=a%20b')).toEqual({ clip: '123', x: 'a b' });
    expect(stringifySearch({})).toBe('');
  });
});

describe('searchParams', () => {
  const validate = searchParams({ clip: 'string', page: 'number', open: 'boolean' });

  it('keeps only the named keys, each as its kind', () => {
    expect(validate({ clip: '123', page: '2', open: 'true', key: 'gsk_test' })).toEqual({
      clip: '123',
      page: 2,
      open: true,
    });
  });

  it('drops values of the wrong kind', () => {
    expect(validate({ clip: '', page: 'two', open: 'yes' })).toEqual({});
  });
});

describe('back floor', () => {
  it('can go back after a push and not on the first entry', () => {
    expect(canGoBack(at(0))).toBe(false);
    expect(canGoBack(at(1, pushState(at(0))))).toBe(true);
  });

  it('a replace stops Back at that entry, and pushes carry the floor', () => {
    const replaced = at(2, clearBackState(at(2)));
    expect(canGoBack(replaced)).toBe(false);
    expect(canGoBack(at(3, pushState(replaced)))).toBe(true);
    expect(pushState(replaced)).toEqual({ appskordFloor: 2 });
  });
});
