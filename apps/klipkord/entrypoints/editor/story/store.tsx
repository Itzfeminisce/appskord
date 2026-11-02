import type { ReactNode } from 'react';
import type { Overlay } from '@/lib/project/types';

/** T14's own UI state: the Text and cards panel and the brand kit dialog. */
export interface StoryState { panel: boolean; brandKit: boolean }

let state: StoryState = { panel: false, brandKit: false };
const listeners = new Set<() => void>();

export const storyState = (): StoryState => state;

export function setStory(patch: Partial<StoryState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function subscribeStory(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** Names from the Cards and Overlays frames. */
export const OVERLAY_NAMES: Record<Overlay['kind'], string> = {
  text: 'Text', arrow: 'Arrow', callout: 'Callout', highlight: 'Highlight', spotlight: 'Spotlight', blur: 'Blur',
};
export const OVERLAY_KINDS = Object.keys(OVERLAY_NAMES) as Overlay['kind'][];

/** Icon paths copied from the Cards frame's add buttons. */
export const OVERLAY_ICONS: Record<Overlay['kind'], ReactNode> = {
  text: <><path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M12 4v16" /></>,
  arrow: <><path d="M5 19L19 5" /><path d="M9 5h10v10" /></>,
  callout: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  highlight: <rect x="4" y="4" width="16" height="16" rx="2" />,
  spotlight: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /></>,
  blur: <>{[6, 12, 18].flatMap((y) => [6, 12, 18].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1" />))}</>,
};
