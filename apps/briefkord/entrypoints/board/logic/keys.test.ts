import { describe, expect, it } from 'vitest';
import { keyAction, type KeyInput } from './keys';

const key = (k: string, patch: Partial<KeyInput> = {}): KeyInput => ({ key: k, ctrl: false, meta: false, shift: false, alt: false, typing: false, hasSelection: false, ...patch });

describe('keyAction', () => {
  it('maps the tool letters from FRAMES', () => {
    expect(['v', 'n', 'c', 'd', 'a', 'g'].map((k) => keyAction(key(k)))).toEqual([
      { type: 'tool', tool: 'select' },
      { type: 'tool', tool: 'note' },
      { type: 'tool', tool: 'checklist' },
      { type: 'tool', tool: 'diagram' },
      { type: 'tool', tool: 'arrow' },
      { type: 'tool', tool: 'group' },
    ]);
    expect(keyAction(key('N'))).toEqual({ type: 'tool', tool: 'note' });
  });

  it('maps undo, redo and search with Ctrl or Cmd', () => {
    expect(keyAction(key('z', { ctrl: true }))).toEqual({ type: 'undo' });
    expect(keyAction(key('Z', { ctrl: true, shift: true }))).toEqual({ type: 'redo' });
    expect(keyAction(key('y', { meta: true }))).toEqual({ type: 'redo' });
    expect(keyAction(key('k', { meta: true }))).toEqual({ type: 'search' });
  });

  it('acts on cards only when some are selected', () => {
    expect(keyAction(key('Delete'))).toBeNull();
    expect(keyAction(key('Delete', { hasSelection: true }))).toEqual({ type: 'delete' });
    expect(keyAction(key('Backspace', { hasSelection: true }))).toEqual({ type: 'delete' });
    expect(keyAction(key(' ', { hasSelection: true }))).toEqual({ type: 'open-large' });
    expect(keyAction(key(' '))).toBeNull();
    expect(keyAction(key('d', { ctrl: true, hasSelection: true }))).toEqual({ type: 'duplicate' });
    expect(keyAction(key('ArrowUp', { alt: true, hasSelection: true }))).toEqual({ type: 'list-move', by: -1 });
    expect(keyAction(key('ArrowDown', { alt: true, hasSelection: true }))).toEqual({ type: 'list-move', by: 1 });
  });

  it('leaves letters to a text field but still takes Esc and Ctrl K', () => {
    expect(keyAction(key('n', { typing: true }))).toBeNull();
    expect(keyAction(key('z', { ctrl: true, typing: true }))).toBeNull();
    expect(keyAction(key('Escape', { typing: true }))).toEqual({ type: 'escape' });
    expect(keyAction(key('k', { ctrl: true, typing: true }))).toEqual({ type: 'search' });
  });

  it('opens the shortcuts with ?', () => {
    expect(keyAction(key('?', { shift: true }))).toEqual({ type: 'help' });
  });
});
