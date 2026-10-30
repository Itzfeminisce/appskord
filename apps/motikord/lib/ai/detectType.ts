import type { ClipType, Settings } from '../types';
import { chat } from '../llm';
import { getSettings } from '../settings';
import { CLIP_TYPES } from '../recipe/validate';
import { toAiError } from './errors';
import { detectSystem } from './prompts';
import { parseJsonReply, type AiOptions } from './writeRecipe';

const KEYWORDS: [ClipType, RegExp][] = [
  ['captions', /\b(caption|subtitle|transcript|script|voice ?over|spoken)/i],
  ['quote', /\b(quote|saying|said|motto)\b|[“"].{6,}[”"]/i],
  ['chart', /\b(chart|graph|stats?|statistics|percent|growth|revenue|numbers|data)\b|\d+\s?%/i],
  ['logo', /\b(logo|brand reveal|intro sting|ident)\b/i],
  ['explainer', /\b(how to|explain|steps?|tutorial|guide|why)\b/i],
  ['promo', /\b(sale|discount|launch|buy|offer|product|shop|event|tickets?)\b/i],
];

/** A local guess for when the model's answer is not a clip type. */
export function guessType(prompt: string): ClipType {
  return KEYWORDS.find(([, re]) => re.test(prompt))?.[0] ?? 'social';
}

/** One short model call that picks the clip type; Settings defaultType ("Always use this type") skips it. */
export async function detectType(
  prompt: string,
  opts: AiOptions & { settings?: Pick<Settings, 'defaultType'> } = {},
): Promise<{ type: ClipType; by: 'groq' | 'builtin' | 'settings' | 'guess' }> {
  const settings = opts.settings ?? (await getSettings());
  if (settings.defaultType) return { type: settings.defaultType, by: 'settings' };
  const { settings: _ignored, ...chatOpts } = opts;
  let reply;
  try {
    reply = await chat([{ role: 'system', content: detectSystem() }, { role: 'user', content: prompt }], { ...chatOpts, json: true, maxTokens: 20, temperature: 0 });
  } catch (e) {
    const err = toAiError(e, 'make');
    if (err.code === 'cancelled') throw err;
    return { type: guessType(prompt), by: 'guess' }; // best effort; the recipe call surfaces real errors
  }
  const parsed = parseJsonReply(reply.text);
  const raw = (typeof parsed === 'object' && parsed !== null ? (parsed as { type?: unknown }).type : reply.text);
  const type = typeof raw === 'string' ? raw.trim().toLowerCase().replace(/[^a-z]/g, '') : '';
  if ((CLIP_TYPES as readonly string[]).includes(type)) return { type: type as ClipType, by: reply.by };
  return { type: guessType(prompt), by: 'guess' };
}
