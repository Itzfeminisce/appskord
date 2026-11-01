import type { RenderPlan, Shape } from '@/lib/project/types';
import type { RenderRequest, RenderResponse, RenderSource } from '@/lib/render/render.worker';

/** The preview's line to the renderer; a fake one stands in for tests. */
export interface PreviewClient {
  render(plan: RenderPlan, shape: Shape): void;
  resize(width: number, height: number): void;
  addSources(sources: RenderSource[]): void;
  /** Called after each plan: drawn is false when a newer plan replaced it first. */
  onDrawn(listener: (drawn: boolean) => void): () => void;
  close(): void;
}

/** Hands the canvas to the render worker (T4) and posts it a plan per frame. */
export function workerPreview(worker: Worker, canvas: HTMLCanvasElement, sources: RenderSource[]): PreviewClient {
  const listeners = new Set<(drawn: boolean) => void>();
  let id = 0;
  const post = (message: RenderRequest, transfer: Transferable[] = []) => worker.postMessage(message, transfer);
  worker.addEventListener('message', (event: MessageEvent<RenderResponse>) => {
    const reply = event.data;
    if (reply.type === 'rendered') listeners.forEach((l) => l(reply.drawn));
    else if (reply.type === 'error') {
      console.error('Klipkord: could not draw the preview', reply.message);
      listeners.forEach((l) => l(false));
    }
  });
  const offscreen = canvas.transferControlToOffscreen();
  post({ type: 'init', canvas: offscreen, sources }, [offscreen]);
  return {
    render: (plan, shape) => post({ type: 'render', id: ++id, plan, shape }),
    resize: (width, height) => post({ type: 'resize', width, height }),
    addSources: (more) => post({ type: 'sources', sources: more }),
    onDrawn(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      post({ type: 'close' });
      worker.terminate();
      listeners.clear();
    },
  };
}
