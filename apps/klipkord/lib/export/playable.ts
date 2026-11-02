// The side panel's v2 screens (Review player, Trim, Export, GIF, Drive link) play one file with picture and sound.
// A v3 recording keeps them apart, so they get its screen with the voice (or tab sound) copied in beside it: no
// re-encode, only the packets moved, each at its own offset on the take's clock. The copy streams to a file in the
// extension's storage, so a 30-minute take never sits in memory.
import {
  ALL_FORMATS, BlobSource, EncodedAudioPacketSource, EncodedPacketSink, EncodedVideoPacketSource, Input, Mp4OutputFormat, Output,
  StreamTarget, WebMOutputFormat, type InputAudioTrack, type InputVideoTrack,
} from 'mediabunny';
import { getProject } from '../project/store';
import type { Source } from '../project/types';
import type { Recording } from '../types';
import { videoStore, type Track, type VideoStore } from '../videoStore';
import { browserStore, drop, folder, hold, stamped, sweep, type Store } from './opfs';

export interface Part { blob: Blob; offset: number }

const WEBM_VIDEO = new Set(['vp8', 'vp9', 'av1']);

const DIR = 'playable';

/** Copies the screen's picture and one sound track into one file; offsets are ms on the take's clock. */
export async function remux(screen: Part, sound: Part | null, out: (ext: 'webm' | 'mp4') => Promise<FileSystemFileHandle>): Promise<Blob> {
  const vIn = new Input({ source: new BlobSource(screen.blob), formats: ALL_FORMATS });
  const aIn = sound ? new Input({ source: new BlobSource(sound.blob), formats: ALL_FORMATS }) : null;
  try {
    const video: InputVideoTrack | null = await vIn.getPrimaryVideoTrack();
    if (!video) return screen.blob;
    const audio: InputAudioTrack | null = (await aIn?.getPrimaryAudioTrack()) ?? null;
    const vCodec = await video.getCodec();
    const aCodec = audio ? await audio.getCodec() : null;
    if (!vCodec) return screen.blob;
    const webm = WEBM_VIDEO.has(vCodec) && (!aCodec || aCodec === 'opus' || aCodec === 'vorbis');
    const handle = await out(webm ? 'webm' : 'mp4');
    const stream = await handle.createWritable();
    const output = new Output({ format: webm ? new WebMOutputFormat() : new Mp4OutputFormat(), target: new StreamTarget(stream) });
    const vOut = new EncodedVideoPacketSource(vCodec);
    output.addVideoTrack(vOut);
    const aOut = audio && aCodec ? new EncodedAudioPacketSource(aCodec) : null;
    if (aOut) output.addAudioTrack(aOut);
    await output.start();

    const start = Math.min(screen.offset, sound?.offset ?? screen.offset);
    const copy = async (track: InputVideoTrack | InputAudioTrack, add: (p: Parameters<EncodedVideoPacketSource['add']>[0], meta?: object) => Promise<void>, offset: number) => {
      const config = await track.getDecoderConfig();
      const shift = (offset - start) / 1000;
      let first = true;
      for await (const packet of new EncodedPacketSink(track).packets()) {
        await add(packet.clone({ timestamp: packet.timestamp + shift }), first && config ? { decoderConfig: config } : undefined);
        first = false;
      }
    };
    try {
      await copy(video, (p, m) => vOut.add(p, m as EncodedVideoChunkMetadata), screen.offset);
      if (audio && aOut) await copy(audio, (p, m) => aOut.add(p, m as EncodedAudioChunkMetadata), sound!.offset);
      await output.finalize();
    } catch (error) {
      await output.cancel().catch(() => undefined);
      await stream.abort().catch(() => undefined);
      throw error;
    }
    const file = await handle.getFile();
    return new Blob([file], { type: webm ? 'video/webm' : 'video/mp4' });
  } finally {
    vIn.dispose();
    aIn?.dispose();
  }
}

const read = (store: VideoStore, id: string, s: Source) => store.read(id, s.file as Track, s.mime);

// One recording at a time: the side panel moves between its screens without copying again. Moving to another
// recording removes the last one's copy.
let cached: { id: string; blob: Promise<Blob>; free(): Promise<void> } | null = null;
let seq = 0;
let hooked = false;

/** The recording as one playable file: v1/v2's own 'video'; a v3 recording's screen with its voice. */
export function readPlayable(rec: Pick<Recording, 'id' | 'mime' | 'v3'>, store: VideoStore = videoStore, files: Store = browserStore): Promise<Blob> {
  if (!rec.v3) return store.read(rec.id, 'video', rec.mime);
  if (cached?.id === rec.id) return cached.blob;
  void cached?.free();
  let made: { name: string; release(): void } | null = null;
  let freed = false;
  const free = async () => {
    freed = true;
    if (made) await drop(files, DIR, made.name, made.release);
  };
  const out = async (ext: string) => {
    if (freed) throw new Error('Klipkord: the recording moved on');
    await sweep(files, DIR);
    if (freed) throw new Error('Klipkord: the recording moved on');
    const name = stamped(files, ++seq, `${rec.id}.${ext}`);
    made = { name, release: await hold(files, DIR, name) };
    if (freed) {
      await drop(files, DIR, made.name, made.release);
      throw new Error('Klipkord: the recording moved on');
    }
    return (await folder(files, DIR)).getFileHandle(name, { create: true });
  };
  const blob = (async () => {
    const project = await getProject(rec.id);
    const screen = project?.sources.find((s) => s.kind === 'screen');
    if (!project || !screen) return store.read(rec.id, 'video', rec.mime);
    // Mixing mic and tab sound would mean re-encoding; the voice is what these screens need, so the mic wins.
    const sound = project.sources.find((s) => s.kind === 'mic' && s.audio) ?? project.sources.find((s) => s.kind === 'tab' && s.audio);
    const screenBlob = await read(store, rec.id, screen);
    const soundBlob = sound ? await read(store, rec.id, sound) : null;
    try {
      const joined = await remux({ blob: screenBlob, offset: screen.offset }, soundBlob?.size ? { blob: soundBlob, offset: sound!.offset } : null, out);
      if (freed) await free();
      return joined;
    } catch (error) {
      console.error('Klipkord: could not join the screen and voice', error);
      await free();
      return screenBlob;
    }
  })();
  if (!hooked && typeof addEventListener === 'function') {
    hooked = true;
    addEventListener('pagehide', () => { void cached?.free(); });
  }
  cached = { id: rec.id, blob, free };
  blob.catch(() => { if (cached?.blob === blob) cached = null; });
  return blob;
}
