/** Puts dictated words into a text at the cursor, with the spaces the words need. Pure. */

export interface Inserted {
  value: string;
  /** What goes in at `start`, spaces included; replaces start..end. */
  text: string;
  start: number;
  end: number;
  /** The words themselves in the new value, for the teal tint. */
  from: number;
  to: number;
}

const OPENS = /[\s([{"“‘'-]$/;
const CLOSES = /^[\s.,;:!?)\]}"”’'-]/;

export function insertWords(value: string, start: number, end: number, words: string): Inserted | undefined {
  const said = words.trim().replace(/\s+/g, ' ');
  if (!said) return undefined;
  const a = Math.max(0, Math.min(start, value.length));
  const b = Math.max(a, Math.min(end, value.length));
  const before = value.slice(0, a);
  const after = value.slice(b);
  const lead = before && !OPENS.test(before) ? ' ' : '';
  const trail = after && !CLOSES.test(after) ? ' ' : '';
  const text = lead + said + trail;
  return { value: before + text + after, text, start: a, end: b, from: a + lead.length, to: a + lead.length + said.length };
}
