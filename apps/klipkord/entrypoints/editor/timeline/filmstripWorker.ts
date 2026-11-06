import { framesClient } from '@appskord/media';
import FramesWorker from '@appskord/media/frames.worker?worker';
import type { FrameSource } from './filmstrip';

/** Opens a file in its own frames worker, apart from the preview's, so thumbnails never wait on or delay playback. */
export async function openFrames(blob: Blob): Promise<FrameSource> {
  const client = framesClient(new FramesWorker());
  try {
    // Sparse thumbnails need few frames, and software decode leaves the hardware pool to the preview.
    await client.open(blob, { capacity: 2, software: true });
  } catch (error) {
    client.close();
    throw error;
  }
  return { frameAt: (t) => client.frameAt(t), close: () => client.close() };
}
