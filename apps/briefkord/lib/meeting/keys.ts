/** Meeting mode keys (ShortcutsHelp "Meeting mode") and moving through the cards. Pure. */

export type MeetingAction = 'next' | 'previous' | 'notes' | 'full-screen' | 'end';

export interface MeetingKey { key: string; ctrl: boolean; meta: boolean; alt: boolean; typing: boolean }

/** → next, ← previous, N notes, F full screen, Esc leaves. */
export function meetingKey(input: MeetingKey): MeetingAction | null {
  if (input.ctrl || input.meta || input.alt) return null;
  if (input.key === 'Escape') return 'end';
  if (input.typing) return null;
  switch (input.key) {
    case 'ArrowRight': return 'next';
    case 'ArrowLeft': return 'previous';
    case 'n': case 'N': return 'notes';
    case 'f': case 'F': return 'full-screen';
    default: return null;
  }
}

/** The card shown after a step; `count` (one past the last card) is the end screen. */
export function stepTo(index: number, count: number, action: 'next' | 'previous'): number {
  if (count <= 0) return 0;
  const at = Math.min(Math.max(index, 0), count);
  return action === 'next' ? Math.min(at + 1, count) : Math.max(at - 1, 0);
}
