import type { Aspect, Asset, ClipType, PresetSlot } from '../types';
import { CLIP_TYPES, MAX_CLIP_MS } from '../recipe/validate';
import { PRESETS } from '../render/presets';
import { LAYOUTS } from '../render/reflow';

/** One line per clip type; detection and writing both lean on it. */
export const TYPE_HINTS: Record<ClipType, string> = {
  promo: 'a product, sale, launch or event ad with a call to action',
  quote: 'one quote or saying with who said it',
  chart: 'numbers, stats, growth or a comparison shown as a chart',
  explainer: 'a how-to or steps that explain an idea, scene by scene',
  logo: 'a short logo or brand reveal, little text',
  captions: 'spoken words or a script shown as timed captions',
  social: 'a post, announcement, tip or hook for social media',
};

export function detectSystem(): string {
  const lines = CLIP_TYPES.map((t) => `- ${t}: ${TYPE_HINTS[t]}`).join('\n');
  return `You sort short video clip ideas into one type.\nTypes:\n${lines}\nReply with JSON only: {"type":"<one type id>"}.`;
}

const presetLine = (slot: PresetSlot) =>
  PRESETS.filter((p) => p.slot === slot).map((p) => `${p.id} (${p.defaultMs}ms)`).join(', ');

export interface RecipePromptInput {
  type: ClipType; aspect: Aspect; assets: Asset[]; lengthMs?: number;
  brand?: { colours?: string[]; headingFont?: string; bodyFont?: string };
}

/** Everything the model may use, and nothing else: presets and layouts come from lib/render. */
export function recipeSystem(input: RecipePromptInput): string {
  const media = input.assets.filter((a) => a.kind !== 'audio' && a.kind !== 'font');
  const assets = media.length
    ? media.map((a) => `- "${a.id}": ${a.kind === 'video' ? 'video' : 'image'} layer, ${a.kind}, "${a.name}"${a.width && a.height ? `, ${a.width}x${a.height}` : ''}`).join('\n')
    : '- none: use no image or video layers';
  const brand = input.brand;
  return [
    `You design short animated clips as JSON scene recipes. Clip type: ${input.type} (${TYPE_HINTS[input.type]}). Size: ${input.aspect}.`,
    `Reply with JSON only, no code, in this shape:`,
    `{"name":"short clip name","scenes":[{"id":"s1","durationMs":3000,"background":"#111114","layout":"center","layers":[LAYER]}]}`,
    `LAYER is one of:`,
    `text: {"id":"t1","name":"Title","type":"text","role":"title|body|caption|label","text":"...","font":"Geist","sizePx":96,"weight":700,"colour":"#FFFFFF","align":"center","lineHeight":1.15,"startMs":0,"endMs":3000,"box":BOX,"opacity":1,"in":MOTION,"out":MOTION}`,
    `shape: {"id":"b1","name":"Bar","type":"shape","shape":"rect|circle|line","fill":"#BE185D","radius":8,"startMs":0,"endMs":3000,"box":BOX,"opacity":1}`,
    `chart: {"id":"c1","name":"Chart","type":"chart","chart":"bar|line|number","values":[{"label":"Q1","value":3}],"colour":"#BE185D","startMs":0,"endMs":3000,"box":BOX,"opacity":1}`,
    `image or video: {"id":"m1","name":"Photo","type":"image|video","assetId":"<listed id>","fit":"cover|contain","startMs":0,"endMs":3000,"box":BOX,"opacity":1}`,
    `BOX: {"x":0.1,"y":0.4,"w":0.8,"h":0.2} as fractions of the ${input.aspect} canvas; x and y from -1 to 2, w and h from 0 to 2; optional "rotation" in degrees.`,
    `MOTION: {"preset":"<id>","feel":"smooth|snappy|bouncy|steady","durationMs":600}. Optional "in", "during" and "out" on any layer.`,
    `"in" presets: ${presetLine('in')}.`,
    `"during" presets: ${presetLine('during')}.`,
    `"out" presets: ${presetLine('out')}.`,
    `Layouts: ${LAYOUTS.join(', ')}.`,
    `Media ids you may use (never invent one):\n${assets}`,
    `Rules: use only the preset ids and layouts listed. Colours are "#RRGGBB" hex or "transparent", nothing else.`,
    `Every id is unique. Layer times are ms from the scene start and end by the scene's durationMs.`,
    `Keep text short and large, high contrast against the background, and inside the middle 80% of the canvas.`,
    `Give each text at least 1500 ms on screen. The whole clip is ${input.lengthMs ? `about ${Math.round(input.lengthMs / 1000)}` : '6 to 20'} seconds and at most ${MAX_CLIP_MS / 1000}.`,
    brand?.colours?.length ? `Brand colours: ${brand.colours.join(', ')}.` : '',
    brand?.headingFont || brand?.bodyFont ? `Fonts: titles "${brand.headingFont ?? 'Geist'}", other text "${brand.bodyFont ?? 'Geist'}".` : '',
    `Write on-screen text in the language of the prompt.`,
  ].filter(Boolean).join('\n');
}

export function editSystem(): string {
  return [
    `You change a short animated clip's JSON scene recipe. You get the recipe and a change request.`,
    `Reply with JSON only: {"ops":[...]} where each op is an RFC 6902 JSON Patch op: replace, add, remove or move.`,
    `{"op":"replace","path":"/scenes/0/layers/1/sizePx","value":120}, {"op":"add","path":"/scenes/-","value":{...}}, {"op":"remove","path":"/scenes/2"}, {"op":"move","from":"/scenes/2","path":"/scenes/0"}.`,
    `Paths start with /name, /scenes, /music or /creditsEndCard. Never change /assets; media layers use only asset ids already in it.`,
    `Use only these "in" presets: ${presetLine('in')}; "during": ${presetLine('during')}; "out": ${presetLine('out')}.`,
    `Layouts: ${LAYOUTS.join(', ')}. Colours are "#RRGGBB" hex or "transparent". Boxes are fractions of the canvas (x, y from -1 to 2; w, h from 0 to 2).`,
    `The clip stays at most ${MAX_CLIP_MS / 1000} seconds. Change only what was asked, with as few ops as you can.`,
  ].join('\n');
}

/** The follow-up for one retry: the problems the validator found. */
export function retryMessage(problems: string[]): string {
  const list = problems.slice(0, 12).map((p) => `- ${p}`).join('\n');
  return `That reply did not work. Fix these problems and reply with the whole JSON again:\n${list}`;
}
