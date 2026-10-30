// Synthesises Motikord's bundled music into public/music/*.wav. The tracks are made here from sine waves and noise, so we release them as CC0.
// Run: node scripts/make-music.mjs. Mono, 22.05 kHz, 16-bit; every track is whole bars so it loops cleanly.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 22050;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'music');

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const TAU = Math.PI * 2;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

/** Adds `fn(t)` shaped by a fast attack and an exponential decay into the buffer. */
function note(buf, startS, lenS, gain, voice, { attack = 0.01, release = 0.06 } = {}) {
  const from = Math.floor(startS * RATE);
  const n = Math.floor(lenS * RATE);
  for (let i = 0; i < n && from + i < buf.length; i++) {
    const t = i / RATE;
    const env = Math.min(1, t / attack) * Math.min(1, (lenS - t) / release);
    buf[from + i] += gain * env * voice(t);
  }
}

const sine = (f) => (t) => Math.sin(TAU * f * t);
const soft = (f) => (t) => Math.sin(TAU * f * t) + 0.35 * Math.sin(TAU * f * 2 * t) + 0.12 * Math.sin(TAU * f * 3 * t);
const tri = (f) => (t) => (2 / Math.PI) * Math.asin(Math.sin(TAU * f * t));
const pluck = (f, decay) => (t) => Math.exp(-decay * t) * (Math.sin(TAU * f * t) + 0.4 * Math.sin(TAU * f * 2 * t));

function kick(buf, at, gain) {
  const from = Math.floor(at * RATE);
  for (let i = 0; i < 0.25 * RATE && from + i < buf.length; i++) {
    const t = i / RATE;
    buf[from + i] += gain * Math.exp(-14 * t) * Math.sin(TAU * (45 * t + (90 * (1 - Math.exp(-30 * t))) / 30));
  }
}
function noise(buf, at, len, gain, rand, hp) {
  const from = Math.floor(at * RATE);
  let last = 0;
  for (let i = 0; i < len * RATE && from + i < buf.length; i++) {
    const t = i / RATE;
    const x = rand() * 2 - 1;
    const y = hp ? x - last : x; // differencing is a cheap high-pass
    last = x;
    buf[from + i] += gain * Math.exp(-t * (hp ? 60 : 22)) * y;
  }
}

// Each chord is [bass, ...triad] in MIDI numbers.
const C = [36, 60, 64, 67], G = [43, 59, 62, 67], Am = [45, 60, 64, 69], F = [41, 60, 65, 69];
const Amin = [45, 57, 60, 64], Fmaj = [41, 57, 60, 65], Cmaj = [36, 55, 60, 64], Gmaj = [43, 55, 59, 62];
const Dm = [38, 57, 62, 65];

const TRACKS = [
  {
    id: 'upbeat', bpm: 120, bars: 16, seed: 1, chords: [C, G, Am, F],
    render(buf, bar, chord, beat, rand) {
      const [bass, ...tri3] = chord;
      for (let b = 0; b < 4; b++) {
        const at = bar * 4 * beat + b * beat;
        kick(buf, at, b % 2 === 0 ? 0.55 : 0.0);
        if (b % 2 === 1) noise(buf, at, 0.12, 0.28, rand, false);
        noise(buf, at + beat / 2, 0.05, 0.12, rand, true);
        note(buf, at, beat * 0.9, 0.2, tri(hz(bass)), { release: 0.05 });
      }
      for (let s = 0; s < 8; s++) note(buf, bar * 4 * beat + s * beat / 2, beat * 0.45, 0.13, pluck(hz(tri3[s % 3] + 12), 7));
    },
  },
  {
    id: 'calm', bpm: 72, bars: 10, seed: 2, chords: [Cmaj, Amin, Fmaj, Gmaj],
    render(buf, bar, chord, beat) {
      const [bass, ...tri3] = chord;
      const start = bar * 4 * beat;
      note(buf, start, beat * 4, 0.22, sine(hz(bass)), { attack: 0.3, release: 0.8 });
      for (const m of tri3) note(buf, start, beat * 4, 0.1, soft(hz(m)), { attack: 0.5, release: 0.9 });
      for (let s = 0; s < 8; s++) note(buf, start + s * beat / 2, beat * 0.9, 0.07, pluck(hz(tri3[s % 3] + 12), 3.5), { attack: 0.02, release: 0.2 });
    },
  },
  {
    id: 'bold', bpm: 100, bars: 14, seed: 3, chords: [Amin, Fmaj, Cmaj, Gmaj],
    render(buf, bar, chord, beat, rand) {
      const [bass, ...tri3] = chord;
      const start = bar * 4 * beat;
      for (let b = 0; b < 4; b++) {
        const at = start + b * beat;
        if (b === 0 || b === 2) kick(buf, at, 0.7);
        if (b === 1 || b === 3) noise(buf, at, 0.2, 0.34, rand, false);
        noise(buf, at, 0.04, 0.1, rand, true);
        noise(buf, at + beat / 2, 0.04, 0.08, rand, true);
      }
      for (let s = 0; s < 8; s++) note(buf, start + s * beat / 2, beat * 0.45, 0.2, soft(hz(bass)), { release: 0.04 });
      for (const m of tri3) note(buf, start, beat * 2, 0.09, soft(hz(m)), { attack: 0.03, release: 0.3 });
      for (const m of tri3) note(buf, start + beat * 2, beat * 2, 0.09, soft(hz(m)), { attack: 0.03, release: 0.3 });
    },
  },
  {
    id: 'playful', bpm: 132, bars: 18, seed: 4, chords: [C, Am, Dm, G],
    render(buf, bar, chord, beat) {
      const [bass, ...tri3] = chord;
      const start = bar * 4 * beat;
      const pattern = [0, 1, 2, 1, 2, 1, 0, 2];
      for (let s = 0; s < 8; s++) {
        note(buf, start + s * beat / 2, beat * 0.3, 0.16, pluck(hz(tri3[pattern[s]] + 12 + (bar % 2 ? 12 : 0)), 12), { release: 0.03 });
      }
      for (let b = 0; b < 4; b += 2) note(buf, start + b * beat, beat * 0.4, 0.22, tri(hz(bass)), { release: 0.04 });
      for (let b = 1; b < 4; b += 2) note(buf, start + b * beat, beat * 0.2, 0.1, sine(hz(tri3[0] + 12)), { release: 0.03 });
    },
  },
];

function wav(samples) {
  const data = Buffer.alloc(44 + samples.length * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + samples.length * 2, 4); data.write('WAVE', 8);
  data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(RATE, 24); data.writeUInt32LE(RATE * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) => data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767))), 44 + i * 2));
  return data;
}

mkdirSync(OUT, { recursive: true });
for (const t of TRACKS) {
  const beat = 60 / t.bpm;
  const seconds = t.bars * 4 * beat;
  const raw = new Float32Array(Math.round(seconds * RATE));
  const rand = rng(t.seed);
  for (let bar = 0; bar < t.bars; bar++) t.render(raw, bar, t.chords[bar % t.chords.length], beat, rand);
  // Every note fades out inside its bar, so the last sample meets the first without a click.
  let peak = 0;
  for (const v of raw) peak = Math.max(peak, Math.abs(v));
  const out = raw.map((v) => (v / peak) * 0.8);
  writeFileSync(join(OUT, `${t.id}.wav`), wav(out));
  console.log(`${t.id}.wav  ${seconds.toFixed(1)} s  ${Math.round(out.length * 2 / 1024)} KB`);
}
