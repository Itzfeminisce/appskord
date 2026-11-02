import { ImageSegmenter } from '@mediapipe/tasks-vision';
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';

// "Blur behind you": MediaPipe selfie segmentation. The wasm and the model ship inside the extension; nothing loads from a CDN.

export const MODEL_PATH = '/models/selfie_segmenter.tflite';

export type SegmentRequest =
  | { type: 'segment'; id: number; picture: ImageBitmap }
  | { type: 'close' };

export type SegmentResponse =
  /** mask: alpha is the person, same size as the picture; ms: time spent in the model. */
  | { type: 'mask'; id: number; mask: ImageBitmap; ms: number; delegate: Delegate }
  | { type: 'error'; id: number; message: string }
  | { type: 'closed' };

export type Delegate = 'GPU' | 'CPU';

let segmenter: Promise<{ task: ImageSegmenter; delegate: Delegate }> | null = null;

const reply = (message: SegmentResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(message, transfer);

async function open(delegate: Delegate): Promise<ImageSegmenter> {
  return ImageSegmenter.createFromOptions(
    { wasmLoaderPath, wasmBinaryPath },
    {
      baseOptions: { modelAssetPath: new URL(MODEL_PATH, self.location.origin).href, delegate },
      runningMode: 'IMAGE',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    },
  );
}

// GPU (WebGL in this worker) when it starts; the CPU path is the fallback the budget was measured for.
function load() {
  segmenter ??= open('GPU').then(
    (task) => ({ task, delegate: 'GPU' as const }),
    async (error: unknown) => {
      console.error('Klipkord: could not start segmentation on the GPU, using the CPU', error);
      return { task: await open('CPU'), delegate: 'CPU' as const };
    },
  );
  return segmenter;
}

let pixels: Uint8ClampedArray<ArrayBuffer> | null = null;

function toMask(confidence: Float32Array, width: number, height: number): Promise<ImageBitmap> {
  const size = width * height * 4;
  if (!pixels || pixels.length !== size) pixels = new Uint8ClampedArray(size);
  for (let i = 0, p = 0; i < confidence.length; i++, p += 4) {
    pixels[p] = 255;
    pixels[p + 1] = 255;
    pixels[p + 2] = 255;
    pixels[p + 3] = confidence[i]! * 255;
  }
  return createImageBitmap(new ImageData(pixels, width, height));
}

async function segment({ id, picture }: Extract<SegmentRequest, { type: 'segment' }>): Promise<void> {
  try {
    const { task, delegate } = await load();
    const started = performance.now();
    const result = task.segment(picture);
    try {
      const mask = result.confidenceMasks?.[0];
      if (!mask) throw new Error('The segmenter gave no mask');
      const confidence = mask.getAsFloat32Array();
      const ms = performance.now() - started;
      const bitmap = await toMask(confidence, mask.width, mask.height);
      reply({ type: 'mask', id, mask: bitmap, ms, delegate }, [bitmap]);
    } finally {
      result.close();
    }
  } catch (error) {
    console.error('Klipkord: could not find the person for camera blur', error);
    reply({ type: 'error', id, message: error instanceof Error ? error.message : String(error) });
  } finally {
    picture.close();
  }
}

// One picture at a time: the model is not re-entrant and the caller already waits for each answer.
let queue: Promise<void> = Promise.resolve();

self.addEventListener('message', (event: MessageEvent<SegmentRequest>) => {
  const request = event.data;
  if (request.type === 'segment') queue = queue.then(() => segment(request));
  else if (request.type === 'close') {
    queue = queue.then(async () => {
      const s = await segmenter?.catch(() => null);
      s?.task.close();
      segmenter = null;
      reply({ type: 'closed' });
    });
  }
});
