// The side panel and its own hidden render frame talk over one MessagePort the panel hands the frame,
// so only the panel that made the frame can ask it to draw, and no other frame draws for it.
import type { LayerContent } from '@appskord/motion/draw';
import type { ClipV3, LookGuide, SceneV3 } from '@appskord/motion/types';

/** The first message the panel posts to its frame; the port rides with it. */
export const RENDER_PORT = 'motikord/render-port';

export type Size = { width: number; height: number };
export type RenderRequest =
  | { type: 'still'; scene: SceneV3; atMs: number; size: Size; look?: LookGuide; contents: Record<string, LayerContent> }
  | { type: 'frames'; clip: ClipV3; times: number[]; look?: LookGuide; contents: Record<string, LayerContent> };
type Answer<R extends RenderRequest> = R extends { type: 'still' } ? string : string[];
type Reply = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string };

export const SIZE_MIN = 64;
export const SIZE_MAX = 2160;

/** A still's size held to 64..2160 a side; undefined when either side is not a positive finite number. */
export function clampSize(size: Partial<Size> | undefined): Size | undefined {
  const side = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(Math.min(SIZE_MAX, Math.max(SIZE_MIN, n))) : undefined);
  const width = side(size?.width);
  const height = side(size?.height);
  return width && height ? { width, height } : undefined;
}

export const TEXT_MAX = 2000;
const PATH_MAX = 20_000;
const SHORT_MAX = 64;
/** The largest px a size, font or corner may take: the long side of a 4K frame. */
export const PX_MAX = 7680;
const SHAPES = new Set(['rect', 'circle', 'line']);

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const finiteIn = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const px = (v: unknown): v is number => finiteIn(v, Number.MIN_VALUE, PX_MAX);
const short = (v: unknown): v is string => typeof v === 'string' && v.length <= SHORT_MAX;

/** A layer's content as posted, keeping only fields of the right type and range; undefined when it is not an object. */
function validContent(raw: unknown): LayerContent | undefined {
  if (!isPlain(raw)) return undefined;
  const c: LayerContent = {};
  if (typeof raw.text === 'string') c.text = raw.text.slice(0, TEXT_MAX);
  if (short(raw.color)) c.color = raw.color;
  if (short(raw.stroke)) c.stroke = raw.stroke;
  if (typeof raw.shape === 'string' && SHAPES.has(raw.shape)) c.shape = raw.shape as LayerContent['shape'];
  if (raw.align === 'left' || raw.align === 'right') c.align = raw.align;
  if (raw.valign === 'top') c.valign = 'top';
  if (px(raw.fontSize)) c.fontSize = raw.fontSize;
  if (px(raw.radius)) c.radius = raw.radius;
  if (px(raw.strokeWidth)) c.strokeWidth = raw.strokeWidth;
  if (isPlain(raw.size) && px(raw.size.w) && px(raw.size.h)) c.size = { w: raw.size.w, h: raw.size.h };
  for (const k of ['path', 'morphTo'] as const) {
    const d = raw[k];
    if (typeof d === 'string' && d.length <= PATH_MAX) c[k] = d;
  }
  const b = raw.box;
  if (isPlain(b) && finiteIn(b.x, -1, 2) && finiteIn(b.y, -1, 2) && finiteIn(b.w, 0, 2) && finiteIn(b.h, 0, 2))
    c.box = { x: b.x, y: b.y, w: b.w, h: b.h };
  return c;
}

/** Posted layer contents made safe to turn into geometry: own string keys holding plain objects, each field checked. */
export function validContents(raw: unknown): Record<string, LayerContent> {
  const out = Object.create(null) as Record<string, LayerContent>;
  if (!isPlain(raw)) return out;
  for (const key of Object.keys(raw)) {
    const c = validContent(raw[key]);
    if (c) out[key] = c;
  }
  return out;
}

/** A record's own entry for `key`, never one from its prototype (`__proto__`, `constructor`). */
export const ownEntry = <T>(record: Record<string, T>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;

export interface RenderHandlers {
  still(r: Extract<RenderRequest, { type: 'still' }>): Promise<string>;
  frames(r: Extract<RenderRequest, { type: 'frames' }>): Promise<string[]>;
}

/** The render frame's side: answers each request on `port`, an error as a reply rather than silence. */
export function serveRenderPort(port: MessagePort, h: RenderHandlers): void {
  port.onmessage = async (e: MessageEvent<{ id: number; req: RenderRequest }>) => {
    const { id, req } = e.data ?? {};
    let reply: Reply;
    try {
      if (req?.type === 'still') {
        const size = clampSize(req.size);
        if (!size) throw new Error('A still needs a positive width and height');
        reply = { id, ok: true, value: await h.still({ ...req, size, contents: validContents(req.contents) }) };
      } else if (req?.type === 'frames')
        reply = { id, ok: true, value: await h.frames({ ...req, contents: validContents(req.contents) }) };
      else throw new Error('Unknown render request');
    } catch (error) {
      console.error('Motikord: the render page could not draw', error);
      reply = { id, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    port.postMessage(reply);
  };
}

export type RenderAsk = <R extends RenderRequest>(req: R) => Promise<Answer<R>>;

/** The panel's side: each request resolves with the frame's answer, or rejects with its error. */
export function renderClient(port: MessagePort): RenderAsk {
  let next = 0;
  const waiting = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  port.onmessage = (e: MessageEvent<Reply>) => {
    const w = waiting.get(e.data?.id);
    if (!w) return;
    waiting.delete(e.data.id);
    if (e.data.ok) w.resolve(e.data.value);
    else w.reject(new Error(e.data.error));
  };
  return (req) => new Promise((resolve, reject) => {
    const id = next++;
    waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
    port.postMessage({ id, req });
  });
}

/** Whether a window message is the owning panel handing this frame its port: same extension origin, from the parent. */
export function isPortHandoff(e: Pick<MessageEvent, 'origin' | 'source' | 'data' | 'ports'>, self: { origin: string; parent: unknown; window: unknown }): boolean {
  return self.parent !== self.window && e.source === self.parent && e.origin === self.origin && e.data?.type === RENDER_PORT && e.ports.length === 1;
}
