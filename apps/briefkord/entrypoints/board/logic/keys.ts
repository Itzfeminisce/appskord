/** The board tab's keys, from FRAMES "Board tab layout" and ShortcutsHelp. Pure, so the map is tested without a browser. */

export type Tool = 'select' | 'note' | 'checklist' | 'diagram' | 'arrow' | 'group';

export type KeyAction =
  | { type: 'tool'; tool: Tool }
  | { type: 'search' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'help' }
  | { type: 'open-large' }
  | { type: 'duplicate' }
  | { type: 'delete' }
  | { type: 'escape' }
  | { type: 'list-move'; by: -1 | 1 };

export interface KeyInput {
  key: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
  /** Focus is in a text field, so letters type instead of switching tools. */
  typing: boolean;
  hasSelection: boolean;
}

const TOOLS: Record<string, Tool> = { v: 'select', n: 'note', c: 'checklist', d: 'diagram', a: 'arrow', g: 'group' };

export function keyAction(input: KeyInput): KeyAction | null {
  const mod = input.ctrl || input.meta;
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  if (mod && key === 'k') return { type: 'search' };
  if (input.key === 'Escape') return { type: 'escape' };
  if (input.typing) return null;
  if (mod && !input.alt) {
    if (key === 'z') return { type: input.shift ? 'redo' : 'undo' };
    if (key === 'y') return { type: 'redo' };
    if (key === 'd' && input.hasSelection) return { type: 'duplicate' };
    return null;
  }
  if (input.alt) {
    if (!input.hasSelection) return null;
    if (input.key === 'ArrowUp') return { type: 'list-move', by: -1 };
    if (input.key === 'ArrowDown') return { type: 'list-move', by: 1 };
    return null;
  }
  if (input.key === '?') return { type: 'help' };
  if ((input.key === 'Delete' || input.key === 'Backspace') && input.hasSelection) return { type: 'delete' };
  if (input.key === ' ' && input.hasSelection) return { type: 'open-large' };
  if (!input.shift && TOOLS[key]) return { type: 'tool', tool: TOOLS[key] };
  return null;
}
