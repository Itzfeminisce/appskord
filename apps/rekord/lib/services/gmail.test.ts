import { describe, expect, it } from 'vitest';
import { composeUrl } from './gmail';

describe('Gmail compose URL', () => {
  it('fills to, subject and body, encoded', () => {
    const url = new URL(composeUrl({ to: ['sarah@northwind.co'], subject: 'Q3 usage numbers', body: 'Hi Sarah, could you send them today? Thank you & bye' }));
    expect(url.origin + url.pathname).toBe('https://mail.google.com/mail/');
    expect(url.searchParams.get('view')).toBe('cm');
    expect(url.searchParams.get('fs')).toBe('1');
    expect(url.searchParams.get('to')).toBe('sarah@northwind.co');
    expect(url.searchParams.get('su')).toBe('Q3 usage numbers');
    expect(url.searchParams.get('body')).toBe('Hi Sarah, could you send them today? Thank you & bye');
  });

  it('leaves out an empty recipient', () => {
    expect(composeUrl({ to: [' '], subject: 's', body: 'b' })).not.toContain('to=');
  });
});
