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
        reply = { id, ok: true, value: await h.still({ ...req, size }) };
      } else if (req?.type === 'frames') reply = { id, ok: true, value: await h.frames(req) };
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
