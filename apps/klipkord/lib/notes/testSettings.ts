import { DEFAULT_SETTINGS, GROQ_BOTH } from '../settings';
import type { Settings } from '../types';

/** Settings for tests that choose Groq for notes. */
export const defaultSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ...GROQ_BOTH, keySource: 'paste' });
