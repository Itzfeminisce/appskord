// Writes public/music/<id>.m4a: four loopable tracks synthesised from scratch, so they are ours to release as CC0.
// Needs ffmpeg on PATH for the level and the AAC encode. Deterministic: the same script always writes the same notes.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SR = 44100;
const OUT = new URL('../public/music/', import.meta.url).pathname;

// Names, moods and lengths are the MusicPicker frame's; lib/audio/tracks.ts lists the same ids.
const TRACKS = [
  { id: 'bright-morning', seconds: 150, bpm: 100, make: brightMorning },
  { id: 'night-drive', seconds: 164, bpm: 112, make: nightDrive },
  { id: 'slow-tide', seconds: 185, bpm: 64, make: slowTide },
  { id: 'paper-planes', seconds: 118, bpm: 120, make: paperPlanes },
];

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

/** A stereo buffer whose writes wrap around the end, so note tails spill into the start and the file loops cleanly. */
function canvas(seconds) {
  const n = Math.round(seconds * SR);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  return {
    n, l, r,
    add(start, samples, gain, pan = 0) {
      const gl = gain * Math.cos(((pan + 1) * Math.PI) / 4);
      const gr = gain * Math.sin(((pan + 1) * Math.PI) / 4);
      const s0 = Math.round(start * SR);
      for (let i = 0; i < samples.length; i++) {
        const j = (s0 + i) % n;
        l[j] += samples[i] * gl;
        r[j] += samples[i] * gr;
      }
    },
  };
}

function env(i, len, attack, release) {
  const a = Math.min(1, i / Math.max(1, attack * SR));
  const r = Math.min(1, (len - i) / Math.max(1, release * SR));
  return Math.max(0, Math.min(a, r));
}

function piano(freq, seconds) {
  const len = Math.round(seconds * SR);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const decay = Math.exp(-t * 3);
    let v = 0;
    for (let h = 1; h <= 4; h++) v += (Math.sin(2 * Math.PI * freq * h * t) / h ** 1.6) * Math.exp(-t * h * 1.2);
    out[i] = v * decay * env(i, len, 0.004, 0.08);
  }
  return out;
}

/** Karplus-Strong plucked string; `bright` 0..1 sets how fast the high end dies. */
function pluck(freq, seconds, random, bright = 0.5) {
  const len = Math.round(seconds * SR);
  const period = Math.max(2, Math.round(SR / freq));
  const line = Float32Array.from({ length: period }, () => random() * 2 - 1);
  const out = new Float32Array(len);
  const damp = 0.996 - (1 - bright) * 0.008;
  let k = 0;
  for (let i = 0; i < len; i++) {
    const next = (k + 1) % period;
    const v = line[k];
    line[k] = damp * 0.5 * (line[k] + line[next]);
    out[i] = v * env(i, len, 0.001, 0.05);
    k = next;
  }
  return out;
}

/** Detuned saws through a one-pole low-pass: a soft pad or, with a short length, a synth stab. */
function saws(freq, seconds, { voices = 3, detune = 0.006, cutoff = 1200, attack = 0.5, release = 0.8, square = false } = {}) {
  const len = Math.round(seconds * SR);
  const out = new Float32Array(len);
  const phases = Array.from({ length: voices }, (_, v) => v / voices);
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / SR);
  let y = 0;
  for (let i = 0; i < len; i++) {
    let v = 0;
    for (let k = 0; k < voices; k++) {
      const f = freq * (1 + detune * (k - (voices - 1) / 2));
      phases[k] = (phases[k] + f / SR) % 1;
      v += square ? (phases[k] < 0.5 ? 1 : -1) : phases[k] * 2 - 1;
    }
    y += a * (v / voices - y);
    out[i] = y * env(i, len, attack, release);
  }
  return out;
}

function kick(seconds = 0.35) {
  const len = Math.round(seconds * SR);
  const out = new Float32Array(len);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    phase += (2 * Math.PI * (45 + 90 * Math.exp(-t * 30))) / SR;
    out[i] = Math.sin(phase) * Math.exp(-t * 9);
  }
  return out;
}

function noiseHit(seconds, random, decay, hp = 0.85) {
  const len = Math.round(seconds * SR);
  const out = new Float32Array(len);
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const n = random() * 2 - 1;
    out[i] = (n - hp * prev) * Math.exp((-i / SR) * decay);
    prev = n;
  }
  return out;
}

/** Chord tones (midi) of a progression step; roots in the octave below middle C. */
const chord = (root, minor = false, seventh = false) =>
  [root, root + (minor ? 3 : 4), root + 7, ...(seventh ? [root + (minor ? 10 : 11)] : [])];

/** Plays a progression bar by bar over the whole length; `bar` draws one bar at time t. */
function overBars(c, bpm, progression, bar) {
  // Stretch the tempo a hair so a whole number of bars fills the track exactly.
  const bars = Math.round(c.n / SR / ((60 / bpm) * 4));
  const barSec = c.n / SR / bars;
  for (let b = 0; b < bars; b++) bar(b * barSec, progression[b % progression.length], b, barSec / 4);
}

/** A 4-bar melody of chord tones, repeated and varied every 8 bars. */
function melodyFor(random, steps) {
  return Array.from({ length: steps }, () => (random() < 0.25 ? null : Math.floor(random() * 4)));
}

function brightMorning(c, bpm) {
  const random = rng(11);
  const prog = [chord(60), chord(55), chord(57, true), chord(53)];
  const tunes = [melodyFor(random, 32), melodyFor(random, 32)];
  overBars(c, bpm, prog, (t, ch, b, beat) => {
    for (const [k, n] of ch.entries()) c.add(t + k * 0.02, piano(hz(n - 12), beat * 4), 0.12, -0.3 + k * 0.2);
    const tune = tunes[Math.floor(b / 8) % 2];
    for (let s = 0; s < 8; s++) {
      const pick = tune[(b % 4) * 8 + s];
      if (pick === null) continue;
      const note = ch[pick % ch.length] + 12 + (pick === 3 ? 12 : 0);
      c.add(t + s * beat / 2, pluck(hz(note), 1.2, random, 0.7), 0.16, 0.35);
    }
  });
}

function nightDrive(c, bpm) {
  const random = rng(23);
  const prog = [chord(57, true), chord(53), chord(48), chord(55)];
  overBars(c, bpm, prog, (t, ch, b, beat) => {
    c.add(t, saws(hz(ch[0] - 12), beat * 4, { voices: 4, cutoff: 900, attack: 0.6, release: 0.6 }), 0.1, -0.4);
    c.add(t, saws(hz(ch[2] - 12), beat * 4, { voices: 4, cutoff: 900, attack: 0.6, release: 0.6 }), 0.1, 0.4);
    for (let s = 0; s < 8; s++) c.add(t + s * beat / 2, saws(hz(ch[0] - 24), beat / 2.2, { voices: 2, cutoff: 300, attack: 0.005, release: 0.05 }), 0.32);
    const arp = [0, 1, 2, 1, 2, 3 % ch.length, 2, 1];
    for (let s = 0; s < 16; s++) {
      const n = ch[arp[s % 8] % ch.length] + 12 + (s >= 8 && b % 4 === 3 ? 12 : 0);
      c.add(t + s * beat / 4, saws(hz(n), beat / 4.5, { voices: 1, cutoff: 2600, attack: 0.003, release: 0.04, square: true }), 0.05, Math.sin(s) * 0.5);
    }
    for (let s = 0; s < 4; s++) c.add(t + s * beat, kick(), 0.45);
    for (let s = 0; s < 4; s++) c.add(t + s * beat + beat / 2, noiseHit(0.08, random, 60), 0.05, 0.2);
  });
}

function slowTide(c, bpm) {
  const random = rng(37);
  const prog = [chord(50, false, true), chord(55, false, true), chord(52, true, true), chord(57, false, false)];
  overBars(c, bpm, prog, (t, ch, b, beat) => {
    for (const [k, n] of ch.entries()) {
      c.add(t, saws(hz(n), beat * 4 + 1.5, { voices: 3, detune: 0.004, cutoff: 700, attack: 1.5, release: 2 }), 0.09, (k - 1.5) * 0.4);
    }
    c.add(t, saws(hz(ch[0] - 12), beat * 4 + 1, { voices: 2, cutoff: 250, attack: 1, release: 1.5 }), 0.14);
    if (b % 2 === 1) c.add(t + beat * 2, piano(hz(ch[1 + Math.floor(random() * 3) % 3] + 12), 3), 0.08, 0.3);
    c.add(t, noiseHit(beat * 4, random, 0.6, 0.98), 0.012, -0.2);
  });
}

function paperPlanes(c, bpm) {
  const random = rng(53);
  const prog = [chord(65), chord(60), chord(62, true), chord(58)];
  const strum = [1, 0, 1, 1, 0, 1, 1, 1];
  const tune = melodyFor(random, 32);
  overBars(c, bpm, prog, (t, ch, b, beat) => {
    for (let s = 0; s < 8; s++) {
      if (!strum[s]) continue;
      const down = s % 2 === 0;
      const strings = [ch[2], ch[0] + 12, ch[1] + 12, ch[2] + 12];
      strings.forEach((n, k) => {
        const at = t + s * beat / 2 + (down ? k : 3 - k) * 0.012;
        c.add(at, pluck(hz(n), 0.7, random, 0.85), down ? 0.09 : 0.06, -0.2 + k * 0.1);
      });
      c.add(t + s * beat / 2, noiseHit(0.06, random, 70), 0.04, 0.5);
    }
    if (b % 8 >= 4) {
      for (let s = 0; s < 8; s++) {
        const pick = tune[(b % 4) * 8 + s];
        if (pick !== null) c.add(t + s * beat / 2, pluck(hz(ch[pick % ch.length] + 24), 0.9, random, 0.9), 0.08, 0.4);
      }
    }
  });
}

function wav(l, r) {
  const n = l.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 4, 40);
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
  const scale = 0.9 / (peak || 1);          // ffmpeg then sets every track to the same loudness
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l[i] * scale)) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r[i] * scale)) * 32767), 46 + i * 4);
  }
  return buf;
}

mkdirSync(OUT, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'klipkord-music-'));
try {
  for (const track of TRACKS) {
    const c = canvas(track.seconds);
    track.make(c, track.bpm);
    const src = join(tmp, `${track.id}.wav`);
    const dest = join(OUT, `${track.id}.m4a`);
    writeFileSync(src, wav(c.l, c.r));
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-af', 'highpass=f=30,loudnorm=I=-20:TP=-2', '-ar', String(SR), '-c:a', 'aac', '-b:a', '48k', '-movflags', '+faststart', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', dest]);
    console.log(`${track.id}.m4a ${(statSync(dest).size / 1024).toFixed(0)} KB`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
