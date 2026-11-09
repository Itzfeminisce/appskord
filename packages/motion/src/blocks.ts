/// <reference path="./modules.d.ts" />
import * as THREE from 'three';
import { EffectComposer } from 'postprocessing';
import { Text } from './text';
import { parse as parseFont } from 'opentype.js';
import { BatchedRenderer } from 'three.quarks';
import RAPIER from '@dimforge/rapier2d-compat';
import { interpolate } from 'flubber';
import BezierEasing from 'bezier-easing';
import { DotLottie } from '@lottiefiles/dotlottie-web';
import { BufferTarget, canEncodeVideo, Mp4OutputFormat, Output } from 'mediabunny';
import { dotLottieWasmUrl, fontUrl } from './assets';

export interface BlockResult { name: string; ok: boolean; ms: number; detail: string }

// A one-layer Lottie (a square that slides), so dotLottie has something real to load and draw.
const LOTTIE = JSON.stringify({
  v: '5.7.0', fr: 30, ip: 0, op: 30, w: 64, h: 64, layers: [{
    ty: 4, ind: 1, ip: 0, op: 30, st: 0, ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, s: { a: 0, k: [100, 100] }, a: { a: 0, k: [0, 0] }, p: { a: 1, k: [{ t: 0, s: [16, 32] }, { t: 30, s: [48, 32] }] } },
    shapes: [{ ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [20, 20] }, r: { a: 0, k: 0 } }, { ty: 'fl', c: { a: 0, k: [1, 0.4, 0.2, 1] }, o: { a: 0, k: 100 } }],
  }],
});

const PROBES: [string, () => Promise<string>][] = [
  ['three', async () => {
    const renderer = new THREE.WebGLRenderer({ canvas: new OffscreenCanvas(8, 8) });
    const ok = renderer.capabilities.isWebGL2;
    renderer.dispose();
    if (!ok) throw new Error('WebGL2 is not available');
    return `r${THREE.REVISION}, WebGL2`;
  }],
  ['postprocessing', async () => {
    const renderer = new THREE.WebGLRenderer({ canvas: new OffscreenCanvas(8, 8) });
    new EffectComposer(renderer).dispose();
    renderer.dispose();
    return 'composer ok';
  }],
  ['troika-three-text', async () => {
    const text = new Text();
    text.font = fontUrl;
    text.text = 'Aa';
    await new Promise<void>((done) => text.sync(done));
    text.dispose();
    return 'typeset on main thread';
  }],
  ['opentype.js', async () => {
    const font = parseFont(await (await fetch(fontUrl)).arrayBuffer());
    return `${font.numGlyphs} glyphs`;
  }],
  ['three.quarks', async () => {
    new BatchedRenderer().update(0);
    return 'batch renderer ok';
  }],
  ['@dimforge/rapier2d-compat', async () => {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -9.81 });
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 10));
    world.createCollider(RAPIER.ColliderDesc.ball(0.5), body);
    for (let i = 0; i < 60; i++) world.step();
    const y = body.translation().y;
    world.free();
    return `wasm ${RAPIER.version()}, fell to y=${y.toFixed(2)}`;
  }],
  ['flubber', async () => {
    interpolate('M0,0L10,0L10,10Z', 'M0,0L10,0L10,10L0,10Z')(0.5);
    return 'morph ok';
  }],
  ['bezier-easing', async () => `ease(0.5)=${BezierEasing(0.42, 0, 0.58, 1)(0.5).toFixed(2)}`],
  ['@lottiefiles/dotlottie-web', async () => {
    // The default wasm URL is a CDN; point it at the bundled copy.
    DotLottie.setWasmUrl(dotLottieWasmUrl);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const player = new DotLottie({ canvas, data: LOTTIE, autoplay: false });
    await new Promise<void>((done, fail) => {
      player.addEventListener('load', () => done());
      player.addEventListener('loadError', (e) => fail(new Error(String((e as { error?: unknown }).error ?? 'load error'))));
    });
    const frames = player.totalFrames;
    player.destroy();
    return `wasm ok, ${frames} frames`;
  }],
  ['mediabunny', async () => {
    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
    void output;
    const avc = await canEncodeVideo('avc', { width: 1080, height: 1920 });
    const vp9 = await canEncodeVideo('vp9', { width: 1080, height: 1920 });
    return `avc ${avc ? 'yes' : 'no'}, vp9 ${vp9 ? 'yes' : 'no'}`;
  }],
];

export const BLOCK_NAMES = PROBES.map(([name]) => name);

const LIMIT_MS = 20_000;

function withinLimit<T>(work: Promise<T>): Promise<T> {
  let timer = 0;
  const limit = new Promise<never>((_, fail) => { timer = setTimeout(() => fail(new Error(`no answer in ${LIMIT_MS / 1000} s`)), LIMIT_MS) as unknown as number; });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

/** Loads every v3 building block the way the editor will, under the page's CSP. A block that hangs fails after 20 s. */
export async function loadBuildingBlocks(onBlock?: (name: string) => void): Promise<BlockResult[]> {
  const out: BlockResult[] = [];
  for (const [name, probe] of PROBES) {
    onBlock?.(name);
    const t = performance.now();
    try {
      const detail = await withinLimit(probe());
      out.push({ name, ok: true, ms: Math.round(performance.now() - t), detail });
    } catch (error) {
      console.error(`Motikord: could not load ${name}`, error);
      out.push({ name, ok: false, ms: Math.round(performance.now() - t), detail: error instanceof Error ? error.message : String(error) });
    }
  }
  return out;
}
