// The v3 export's renderer: V3Renderer draws each frame in the editor page (WebGL needs it), WebCodecs encodes,
// mediabunny muxes. It plugs into runExport, so the job row, folder, badge and Cancel are the v2 export's.
import type { ClipV3, LookGuide } from '@appskord/motion/types';
import type { ExportChoiceV3 } from '../../components/export/ExportV3';
import { clearSession, getSession, runExport, type RenderHooks, type RenderRun, type RunDeps } from '../exportJob';
import type { RenderItem } from '../exportPlan';
import { captionCues, drawnClip, jobChoiceV3, planV3, srtFileName } from '../exportV3';
import { ClipDrawer, type DrawSetup } from '../v3/frames';
import type { RestyledClip } from '../restyle/restyle';
import { sceneLayerContent, type LayerContents } from '../v3/text';
import { toSrt } from '../voice/captions';
import { encodeAudio, pickAudioCodec, type IsAudioSupported, type MixedAudio } from './audio';
import { gifWriter } from './gif';
import { mp4Muxer } from './mp4';
import { pageDeps } from './page';
import { Cancelled, pickVideoConfig, runFrames, Unsupported, videoTrack, type IsSupported, type MakeEncoder, type Muxed } from './video';
import { webmMuxer } from './webm';

/** What draws the frames: the real one is ClipDrawer on a canvas; tests pass a fake. */
export interface Drawer {
  readonly canvas: CanvasImageSource & { width: number; height: number };
  draw(tMs: number): Promise<void>;
  dispose(): void;
}

export interface V3Env {
  drawer(clip: ClipV3, setup: DrawSetup): Drawer;
  isSupported: IsSupported;
  isAudioSupported?: IsAudioSupported;
  makeEncoder?: MakeEncoder;
  frame(source: CanvasImageSource, timestamp: number, duration: number): VideoFrame;
  /** RGBA of the drawn frame at the item's size, for GIFs. */
  pixels(source: CanvasImageSource, w: number, h: number): Uint8ClampedArray;
  muxer(item: RenderItem, audio?: { codec: 'aac' | 'opus'; sampleRate: number; channels: number }): Muxed;
  encodeAudio?: typeof encodeAudio;
}

const canvasOf = (w: number, h: number) => Object.assign(document.createElement('canvas'), { width: w, height: h });

export function pageEnv(contents: LayerContents): V3Env {
  let copy: HTMLCanvasElement | undefined;
  return {
    drawer: (clip, setup) => new ClipDrawer(clip, contents, setup, canvasOf(setup.width, setup.height)),
    isSupported: (c) => VideoEncoder.isConfigSupported(c),
    isAudioSupported: typeof AudioEncoder === 'undefined' ? undefined : (c) => AudioEncoder.isConfigSupported(c),
    frame: (source, timestamp, duration) => new VideoFrame(source, { timestamp, duration }),
    pixels(source, w, h) {
      if (!copy || copy.width !== w || copy.height !== h) copy = canvasOf(w, h);
      const ctx = copy.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(source, 0, 0, w, h);
      return ctx.getImageData(0, 0, w, h).data;
    },
    muxer: (item, audio) => (item.kind === 'mp4' ? mp4Muxer(item.width, item.height, item.fps, audio) : webmMuxer(item.width, item.height, item.fps, false, audio)),
  };
}

/** Renders one planned file; Cancel stops at the next frame or step and frees the renderer, encoder, muxer and GPU context. */
export function renderV3(clip: ClipV3, look: LookGuide | undefined, item: RenderItem, audio: MixedAudio | undefined, hooks: RenderHooks, env: V3Env): RenderRun {
  let cancelled = false;
  const stopIfCancelled = () => { if (cancelled) throw new Cancelled(); };
  const done = (async () => {
    const drawer = env.drawer(clip, { width: item.width, height: item.height, quality: 'full', fps: item.fps, look, finish: clip.finish, effects: clip.effects });
    const base = {
      frames: item.frames, fps: item.fps, cancelled: () => cancelled,
      draw: () => undefined,
      // ClipDrawer waits for each frame's text (renderReady) and throws TextNotReady rather than drawing blank words.
      prepare: async (_i: number, t: number) => { await drawer.draw(t); stopIfCancelled(); },
      progress: (f: number, n: number, t: number) => hooks.progress(f, n, t),
    };
    let mux: Muxed | undefined;
    try {
      if (item.kind === 'gif') {
        const out = gifWriter(item.width, item.height, item.fps);
        await runFrames({ ...base, encode: () => out.add(env.pixels(drawer.canvas, item.width, item.height)) });
        const bytes = out.finish();
        return new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: 'image/gif' });
      }
      if (item.kind !== 'mp4' && item.kind !== 'webm') throw new Unsupported(item.label);
      const picked = await pickVideoConfig({ kind: item.kind, width: item.width, height: item.height, fps: item.fps, bitrate: item.bitrate }, env.isSupported);
      stopIfCancelled();
      if (!picked) throw new Unsupported(item.label);
      hooks.encoder(picked.hardware);
      const sound = audio && env.isAudioSupported ? await pickAudioCodec(item.kind, env.isAudioSupported) : null;
      stopIfCancelled();
      if (audio && !sound) throw new Unsupported('Audio');
      mux = env.muxer(item, sound ?? undefined);
      // Sound first: it is small, so mediabunny holds it while the video chunks arrive in order.
      if (audio && sound) await (env.encodeAudio ?? encodeAudio)(audio, sound, mux);
      stopIfCancelled();
      const track = videoTrack(picked.config, mux, env.makeEncoder);
      try {
        const frameUs = 1e6 / item.fps;
        await runFrames({ ...base, encode: (i) => track.add(env.frame(drawer.canvas, Math.round(i * frameUs), Math.round(frameUs)), i) });
        await track.done();
      } catch (error) {
        track.close();
        throw error;
      }
      stopIfCancelled();
      const blob = await mux.finish();
      mux = undefined;
      return blob;
    } catch (error) {
      // An abandoned file is cancelled, so mediabunny lets go of what it holds.
      await mux?.cancel().catch(() => undefined);
      throw error;
    } finally {
      drawer.dispose();
    }
  })();
  return { done, cancel: () => { cancelled = true; } };
}

export interface StartV3 {
  clip: RestyledClip;
  look?: LookGuide;
  choice: ExportChoiceV3;
  fps: 30 | 60;
  root: FileSystemDirectoryHandle;
  /** Tests pass the job's deps and a fake env. */
  deps?: RunDeps;
  env?: V3Env;
}

/** Starts a v3 export in this page; ExportV3 follows the shared export session. */
export function startV3Export(s: StartV3) {
  const contents: LayerContents = (i, l, aspect) => sceneLayerContent(s.clip.recipe.scenes[i], l, aspect, s.clip.recipe.aspect);
  const env = s.env ?? pageEnv(contents);
  const drawn = drawnClip(s.clip.v3, s.choice);
  const cues = s.choice.captions === 'srt' ? captionCues(s.clip) : [];
  const deps: RunDeps = {
    ...(s.deps ?? pageDeps(s.root)),
    plan: (_recipe, choice) => planV3(s.clip, choice, s.fps),
    extras: cues.length ? [{ name: srtFileName(s.clip.recipe.name), text: toSrt(cues) }] : [],
    render: (_recipe, item, audio, hooks) => renderV3(drawn, s.look, item, audio, hooks, env),
  };
  // One run at a time: a second Export while one runs is turned away rather than started beside it.
  if (getSession()?.phase === 'running') return Promise.reject(new Error('An export is already running'));
  clearSession();
  return runExport(s.clip.recipe, s.clip.id, jobChoiceV3(s.clip, s.choice), deps);
}
