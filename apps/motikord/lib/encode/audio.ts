import { CODECS } from '../check/plan';
import type { Recipe } from '../types';
import type { Muxed, MuxAudio } from './video';

export const SAMPLE_RATE = 48000;
export const CHANNELS = 2;

/** One sound placed on the clip's timeline. */
export interface AudioPart {
  assetId: string; atSec: number; durSec: number; gain: number;
  fadeInSec: number; fadeOutSec: number; loop: boolean;
  /** Music only: drops to `gain` times its level while the voice speaks. */
  duck?: { atSec: number; endSec: number; gain: number };
}

/** Music under the voice plays at this share of its level ("quieter under the voice"). */
export const DUCK_GAIN = 0.3;
const DUCK_RAMP_SEC = 0.25;

/** Music from the start to the end (looped if short, with its fades, quieter under the voice), the voice from the start, and each unmuted video layer while it is on screen. */
export function audioParts(r: Recipe, totalMs: number): AudioPart[] {
  const total = totalMs / 1000;
  const parts: AudioPart[] = [];
  const voice = r.voice ? r.assets[r.voice.assetId] : undefined;
  const voiceSec = voice ? Math.min(total, voice.durationMs ? voice.durationMs / 1000 : total) : 0;
  if (r.music && r.assets[r.music.assetId]) {
    const m = r.music;
    parts.push({
      assetId: m.assetId, atSec: 0, durSec: total, gain: m.volume, fadeInSec: Math.min(m.fadeInMs / 1000, total / 2), fadeOutSec: Math.min(m.fadeOutMs / 1000, total / 2), loop: true,
      ...(voiceSec > 0 ? { duck: { atSec: 0, endSec: voiceSec, gain: DUCK_GAIN } } : {}),
    });
  }
  if (r.voice && voiceSec > 0) parts.push({ assetId: r.voice.assetId, atSec: 0, durSec: voiceSec, gain: r.voice.volume, fadeInSec: 0, fadeOutSec: 0, loop: false });
  let sceneStart = 0;
  for (const s of r.scenes) {
    for (const l of s.layers) {
      if (l.type !== 'video' || l.muted || !r.assets[l.assetId]) continue;
      const at = (sceneStart + l.startMs) / 1000;
      const end = Math.min(sceneStart + Math.min(l.endMs, s.durationMs), totalMs) / 1000;
      if (end > at) parts.push({ assetId: l.assetId, atSec: at, durSec: end - at, gain: l.opacity > 0 ? 1 : 0, fadeInSec: 0, fadeOutSec: 0, loop: false });
    }
    sceneStart += s.durationMs;
  }
  return parts;
}

export interface MixedAudio { sampleRate: number; channels: Float32Array[] }

/**
 * Mixes the parts in an OfflineAudioContext at 48 kHz. Pages only: workers have no OfflineAudioContext,
 * so the editor mixes and hands the samples to the render worker. Undefined when nothing could be decoded.
 */
export async function mixAudio(parts: AudioPart[], totalSec: number, read: (assetId: string) => Promise<Blob | undefined>): Promise<MixedAudio | undefined> {
  if (!parts.length || totalSec <= 0) return undefined;
  const ctx = new OfflineAudioContext(CHANNELS, Math.ceil(totalSec * SAMPLE_RATE), SAMPLE_RATE);
  const decoded = new Map<string, AudioBuffer | null>();
  let any = false;
  for (const p of parts) {
    if (!decoded.has(p.assetId)) {
      const blob = await read(p.assetId);
      // A video with no sound track fails to decode; it just adds nothing.
      decoded.set(p.assetId, blob ? await ctx.decodeAudioData(await blob.arrayBuffer()).catch(() => null) : null);
    }
    const buffer = decoded.get(p.assetId);
    if (!buffer) continue;
    any = true;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = p.loop;
    const gain = ctx.createGain();
    const end = p.atSec + p.durSec;
    gain.gain.setValueAtTime(p.fadeInSec > 0 ? 0 : p.gain, p.atSec);
    if (p.fadeInSec > 0) gain.gain.linearRampToValueAtTime(p.gain, p.atSec + p.fadeInSec);
    if (p.fadeOutSec > 0) {
      gain.gain.setValueAtTime(p.gain, end - p.fadeOutSec);
      gain.gain.linearRampToValueAtTime(0, end);
    }
    let out: AudioNode = src.connect(gain);
    if (p.duck) {
      // A second gain, so ducking never fights the fades on the first.
      const duck = ctx.createGain();
      const { atSec, endSec, gain: low } = p.duck;
      duck.gain.setValueAtTime(atSec > 0 ? 1 : low, 0);
      if (atSec > 0) { duck.gain.setValueAtTime(1, Math.max(0, atSec - DUCK_RAMP_SEC)); duck.gain.linearRampToValueAtTime(low, atSec); }
      duck.gain.setValueAtTime(low, endSec);
      duck.gain.linearRampToValueAtTime(1, endSec + DUCK_RAMP_SEC);
      out = out.connect(duck);
    }
    out.connect(ctx.destination);
    src.start(p.atSec, 0, p.loop ? undefined : p.durSec);
    if (p.loop) src.stop(end);
  }
  if (!any) return undefined;
  const out = await ctx.startRendering();
  return { sampleRate: out.sampleRate, channels: Array.from({ length: out.numberOfChannels }, (_, c) => out.getChannelData(c).slice()) };
}

export type IsAudioSupported = (c: AudioEncoderConfig) => Promise<{ supported?: boolean }>;
const audioConfig = (codec: string): AudioEncoderConfig => ({ codec, sampleRate: SAMPLE_RATE, numberOfChannels: CHANNELS, bitrate: 128_000 });

/** MP4 takes AAC, else Opus in MP4 (Chrome plays both); WebM takes Opus. Null when neither encoder exists. */
export async function pickAudioCodec(container: 'mp4' | 'webm', isSupported: IsAudioSupported): Promise<MuxAudio | null> {
  const order: MuxAudio['codec'][] = container === 'mp4' ? ['aac', 'opus'] : ['opus'];
  for (const codec of order) {
    try {
      if ((await isSupported(audioConfig(codec === 'aac' ? CODECS.aac : CODECS.opus))).supported) return { codec, sampleRate: SAMPLE_RATE, channels: CHANNELS };
    } catch { /* try the next one */ }
  }
  return null;
}

/** Encodes the mixed samples into the muxer, 100 ms at a time. */
export async function encodeAudio(mix: MixedAudio, audio: MuxAudio, mux: Muxed): Promise<void> {
  let failure: unknown = null;
  const enc = new AudioEncoder({
    output: (chunk, meta) => { try { mux.addAudio(chunk, meta); } catch (e) { failure ??= e; } },
    error: (e) => { failure ??= e; },
  });
  enc.configure(audioConfig(audio.codec === 'aac' ? CODECS.aac : CODECS.opus));
  const n = mix.channels[0]?.length ?? 0;
  const step = mix.sampleRate / 10;
  for (let at = 0; at < n; at += step) {
    if (failure) break;
    const frames = Math.min(step, n - at);
    const data = new Float32Array(frames * mix.channels.length);
    mix.channels.forEach((ch, c) => data.set(ch.subarray(at, at + frames), c * frames));
    const chunk = new AudioData({ format: 'f32-planar', sampleRate: mix.sampleRate, numberOfFrames: frames, numberOfChannels: mix.channels.length, timestamp: Math.round((at / mix.sampleRate) * 1e6), data });
    enc.encode(chunk);
    chunk.close();
  }
  await enc.flush();
  enc.close();
  if (failure) throw failure;
}
