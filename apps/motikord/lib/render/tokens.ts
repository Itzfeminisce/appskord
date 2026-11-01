import type { Feel, StyleId } from '../types';

/** A pack's motion token: the curve its layers and transitions use and its base duration ("Renderer tokens" card). */
export interface MotionToken { name: 'ease-out' | 'overshoot' | 'bouncy' | 'steady'; feel: Feel; ms: number }

export const MOTION_TOKENS: Record<StyleId, MotionToken> = {
  clean: { name: 'ease-out', feel: 'smooth', ms: 400 },
  bold: { name: 'overshoot', feel: 'snappy', ms: 250 },
  playful: { name: 'bouncy', feel: 'bouncy', ms: 450 },
  corporate: { name: 'steady', feel: 'steady', ms: 500 },
};

export const WORD_STAGGER_MS = 60;
export const LINE_STAGGER_MS = 120;
export const HIGHLIGHT_WIPE_MS = 400;
export const KEN_BURNS_SCALE = 1.14;
/** Background drift: one slow loop, as a fraction of the canvas short side. */
export const DRIFT_MS = 12000;
export const DRIFT_AMOUNT = 0.03;
export const GRAIN_SEED = 0x6d6f7469;
export const GRAIN_TILE = 128;
