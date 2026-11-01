import type { Aspect, Asset, ClipType, PresetSlot } from '../types';
import { CLIP_TYPES, MAX_CLIP_MS } from '../recipe/validate';
import { PRESETS } from '../render/presets';
import { LAYOUTS } from '../render/reflow';
import { exampleFor } from './examples';

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

/** How many scenes each type should have: one idea per scene. */
export const SCENE_RANGE: Record<ClipType, [number, number]> = {
  promo: [4, 7], social: [4, 7], explainer: [4, 7], chart: [2, 4], captions: [2, 8], quote: [1, 3], logo: [1, 3],
};
const DEFAULT_SECONDS: Record<ClipType, number> = { promo: 14, social: 12, explainer: 16, chart: 10, captions: 12, quote: 7, logo: 5 };
/** Clip length in ms: what was asked, else a good length for the type, within 60 s. */
export const targetMs = (input: Pick<RecipePromptInput, 'type' | 'lengthMs'>) => Math.min(MAX_CLIP_MS, input.lengthMs ?? DEFAULT_SECONDS[input.type] * 1000);

const brandLine = (input: RecipePromptInput) => {
  const b = input.brand;
  return [
    b?.colours?.length ? `Brand colours (use them for backgrounds and accents): ${b.colours.join(', ')}.` : '',
    b?.headingFont || b?.bodyFont ? `Fonts: titles "${b.headingFont ?? 'Geist'}", other text "${b.bodyFont ?? 'Geist'}".` : '',
  ].filter(Boolean).join('\n');
};

/** Step 1: a creative plan, written like a motion designer, before any recipe JSON. */
export function planSystem(input: RecipePromptInput): string {
  const [lo, hi] = SCENE_RANGE[input.type];
  const secs = Math.round(targetMs(input) / 1000);
  return [
    `You plan short animated clips like a senior motion designer. Clip type: ${input.type} (${TYPE_HINTS[input.type]}). Size: ${input.aspect}. Length: ${secs} seconds.`,
    `Turn the idea into a story: a hook that stops the scroll, then beats that build, then a clear ending${input.type === 'promo' || input.type === 'social' ? ' with a call to action' : ''}.`,
    `Plan ${lo} to ${hi} scenes, one idea each, 2 to 4 seconds each, adding up to about ${secs} seconds.`,
    input.type === 'quote' || input.type === 'captions'
      ? `Keep the quoted or spoken words exactly as given, split at natural pauses; add a fresh closing line or name card.`
      : `Write every headline fresh: 3 to 7 punchy words. Never copy the idea's sentence or split it into pieces; rewrite it as a designer would. Pull out the offer, benefit, proof, numbers and dates.`,
    `Per scene: "headline", a "support" line of up to 8 words (or ""), a "visual" idea using shapes, cards, rules, circles or a chart, a "layout" from ${LAYOUTS.join(', ')} (vary it across scenes), "bg" and "accent" hex colours with strong contrast, and "motion": in, during and out presets with feels.`,
    brandLine(input),
    `Reply with JSON only, compact on one line: {"name":"2-4 words","hook":"...","scenes":[{"ms":3000,"headline":"...","support":"...","visual":"...","layout":"center","bg":"#0F172A","accent":"#F59E0B","motion":"pop-in bouncy, pulse, fade-out"}]}`,
    `Write the text in the language of the idea.`,
  ].filter(Boolean).join('\n');
}

/** Step 2: everything the model may use, and nothing else: presets and layouts come from lib/render. */
export function recipeSystem(input: RecipePromptInput): string {
  const media = input.assets.filter((a) => a.kind !== 'audio' && a.kind !== 'font');
  const assets = media.length
    ? media.map((a) => `- "${a.id}": ${a.kind === 'video' ? 'video' : 'image'} layer, ${a.kind}, "${a.name}"${a.width && a.height ? `, ${a.width}x${a.height}` : ''}`).join('\n')
    : '- none: use no image or video layers';
  const [lo, hi] = SCENE_RANGE[input.type];
  const secs = Math.round(targetMs(input) / 1000);
  return [
    `You are a senior motion designer who writes short animated clips as JSON scene recipes. Clip type: ${input.type} (${TYPE_HINTS[input.type]}). Size: ${input.aspect}.`,
    `Reply with one valid JSON object only, no code, written compactly on one line with no spaces or line breaks, in this shape:`,
    `{"name":"short clip name","scenes":[{"id":"s1","durationMs":3000,"background":"#111114","layout":"center","layers":[LAYER]}]}`,
    `LAYER is one of:`,
    `text: {"id":"t1","name":"Title","type":"text","role":"title|body|caption|label","text":"...","font":"Geist","sizePx":96,"weight":700,"colour":"#FFFFFF","align":"center","lineHeight":1.15,"startMs":0,"endMs":3000,"box":BOX,"opacity":1,"in":MOTION,"during":MOTION,"out":MOTION}`,
    `shape: {"id":"b1","name":"Bar","type":"shape","shape":"rect|circle|line","fill":"#BE185D","radius":8,"startMs":0,"endMs":3000,"box":BOX,"opacity":1}`,
    `chart: {"id":"c1","name":"Chart","type":"chart","chart":"bar|line|number","values":[{"label":"Q1","value":3}],"colour":"#BE185D","startMs":0,"endMs":3000,"box":BOX,"opacity":1}`,
    `image or video: {"id":"m1","name":"Photo","type":"image|video","assetId":"<listed id>","fit":"cover|contain","startMs":0,"endMs":3000,"box":BOX,"opacity":1}`,
    `BOX: {"x":0.1,"y":0.4,"w":0.8,"h":0.2} as fractions of the ${input.aspect} canvas; x and y from -1 to 2, w and h from 0 to 2; optional "rotation" in degrees.`,
    `MOTION: {"preset":"<id>","feel":"smooth|snappy|bouncy|steady","durationMs":600}. "in", "during" and "out" go on any layer.`,
    `"in" presets: ${presetLine('in')}.`,
    `"during" presets: ${presetLine('during')}.`,
    `"out" presets: ${presetLine('out')}.`,
    `Layouts: ${LAYOUTS.join(', ')}.`,
    `Media ids you may use (never invent one):\n${assets}`,
    `Rules: use only the preset ids and layouts listed. Colours are "#RRGGBB" hex or "transparent", nothing else.`,
    `Fill in every LAYER, BOX and MOTION with real values. Leave out fields at their default: "opacity":1, "lineHeight":1.15, "align":"center", "font":"Geist".`,
    `Use at most 8 scenes and 5 layers per scene. Every id is unique. Layer times are ms from the scene start and end by the scene's durationMs.`,
    `Design like a pro:`,
    `- ${lo} to ${hi} scenes, one idea per scene, each 2000 to 4000 ms; scene lengths add up to about ${secs} seconds (at most ${MAX_CLIP_MS / 1000}).`,
    `- Headlines are 3 to 7 words, written fresh; never paste the prompt or cut it into pieces.`,
    `- Clear hierarchy: one title (sizePx 88-120, weight 700-800), an optional body line (44-56) and a caption or label (36-44).`,
    `- Strong contrast between text and what is under it; vary backgrounds and layouts from scene to scene.`,
    `- Every text layer has "in" and "out" motion, and the title often a "during" one; vary presets and feels across scenes.`,
    `- Stagger starts inside a scene: accent first, title at 0-300 ms, body and caption 400-900 ms later.`,
    `- Add shapes as accents: a card behind text, a thin rule, a circle or a button behind the call to action.`,
    `- Keep text inside the middle 80% of the canvas and give each text at least 1500 ms on screen.`,
    brandLine(input),
    `Example reply for another idea (copy the craft, never its words): ${exampleFor(input.type)}`,
    `Write on-screen text in the language of the prompt.`,
  ].filter(Boolean).join('\n');
}

/** A plan from step 1, as the model wrote it but trimmed to the fields we pass on. */
export interface PlanScene { ms?: number; headline: string; support?: string; visual?: string; layout?: string; bg?: string; accent?: string; motion?: string }
export interface ClipPlan { name?: string; hook?: string; scenes: PlanScene[] }

/** The user turn of step 2: the idea, and the plan to follow when there is one. */
export function recipeRequest(prompt: string, plan?: ClipPlan): string {
  return plan ? `Idea: ${prompt}\nDesign plan, follow it scene by scene: ${JSON.stringify(plan)}` : `Idea: ${prompt}`;
}

/** A short critique for one more try when the reply is valid but flat. */
export function critiqueMessage(notes: string[]): string {
  return `That works, but it reads like the prompt cut into frames. As a motion designer, fix this and reply with the whole JSON again:\n${notes.map((n) => `- ${n}`).join('\n')}`;
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

/** Added to the request after a reply that was not valid JSON or was cut off. */
export const SHORTER = 'Your last reply was not valid JSON or was cut off. Reply again with fewer scenes and layers, as compact JSON on one line.';

/** The follow-up for one retry: the problems the validator found. */
export function retryMessage(problems: string[]): string {
  const list = problems.slice(0, 12).map((p) => `- ${p}`).join('\n');
  return `That reply did not work. Fix these problems and reply with the whole JSON again:\n${list}`;
}
