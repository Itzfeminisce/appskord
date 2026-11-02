import type { Box } from '../project/types';
import { CAMERA_BLUR, type MakeCanvas } from './canvas2d';
import { backgroundFill, GRADIENTS, rgba } from './layers/background';
import {
  BACKGROUND_BLUR, blurRadius, box, cameraRadius, cameraRing, containBox, coverCrop, gradientLine, intersect, overlayBox,
  pixelBlock, shadowOf, toCanvas, type Size,
} from './layers/geometry';
import { isPrivacy, type Layer } from './layers/order';
import { SOLID } from './layers/overlays';
import type { Ctx2D } from './layers/path';
import { drawVector, pictureSize, VECTOR_OVER, VECTOR_UNDER, type Backend, type Picture, type Scene } from './layers/scene';

const VERT = `#version 300 es
in vec2 aPos;
uniform vec4 uQuad;
uniform vec2 uView;
uniform float uFlip;
out vec2 vPx;
void main() {
  vPx = uQuad.xy + aPos * uQuad.zw;
  vec2 n = vPx / uView * 2.0 - 1.0;
  gl_Position = vec4(n.x, n.y * uFlip, 0.0, 1.0);
}`;

// Modes: 0 colour, 1 gradient, 2 picture, 3 shadow, 4 camera through the person mask.
const BOX = `#version 300 es
precision highp float;
in vec2 vPx;
out vec4 o;
uniform int uMode;
uniform vec4 uRect;
uniform float uRadius;
uniform float uAlpha;
uniform vec4 uColor;
uniform vec4 uStops[3];
uniform vec3 uAt;
uniform int uCount;
uniform vec4 uLine;
uniform sampler2D uTex;
uniform sampler2D uBackTex;
uniform sampler2D uMask;
uniform int uBackMode;
uniform vec4 uMap;
uniform vec4 uUV;
uniform float uMirror;
uniform float uBlock;
uniform float uSigma;

float sdRound(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float erfApprox(float x) {
  float s = sign(x);
  x = abs(x);
  float t = 1.0 + (0.278393 + (0.230389 + (0.000972 + 0.078108 * x) * x) * x) * x;
  t *= t;
  return s - s / (t * t);
}
vec4 premul(vec4 c) { return vec4(c.rgb * c.a, c.a); }
vec4 gradient(float t) {
  if (uCount < 3 || t <= uAt.y) return premul(mix(uStops[0], uStops[1], clamp((t - uAt.x) / max(uAt.y - uAt.x, 1e-5), 0.0, 1.0)));
  return premul(mix(uStops[1], uStops[2], clamp((t - uAt.y) / max(uAt.z - uAt.y, 1e-5), 0.0, 1.0)));
}
void main() {
  vec2 h = uRect.zw * 0.5;
  float r = min(uRadius, min(h.x, h.y));
  float d = sdRound(vPx - (uRect.xy + h), h, r);
  if (uMode == 3) {
    o = vec4(0.0, 0.0, 0.0, uColor.a * (0.5 - 0.5 * erfApprox(d / (uSigma * 1.41421356))) * uAlpha);
    return;
  }
  float k = clamp(0.5 - d, 0.0, 1.0) * uAlpha;
  vec4 c;
  if (uMode == 0) c = premul(uColor);
  else if (uMode == 1) {
    vec2 a = uLine.xy;
    vec2 b = uLine.zw - a;
    c = gradient(clamp(dot(vPx - a, b) / dot(b, b), 0.0, 1.0));
  } else {
    vec2 px = vPx;
    if (uBlock > 0.0) px = uRect.xy + (floor((vPx - uRect.xy) / uBlock) + 0.5) * uBlock;
    vec2 l = (px - uMap.xy) / uMap.zw;
    if (uMirror > 0.5) l.x = 1.0 - l.x;
    vec2 uv = uUV.xy + l * uUV.zw;
    c = texture(uTex, uv);
    if (uMode == 4) {
      vec4 back = uBackMode == 0 ? premul(uColor) : texture(uBackTex, l);
      c = mix(back, c, texture(uMask, uv).a);
    }
  }
  o = c * k;
}`;

// A 13-tap Gaussian with sigma 2 texels; blur strength comes from the size of the texture it runs on.
const BLUR = `#version 300 es
precision highp float;
in vec2 vPx;
out vec4 o;
uniform sampler2D uTex;
uniform vec2 uView;
uniform vec2 uDir;
const float W[7] = float[7](0.19947, 0.17603, 0.12099, 0.06476, 0.02700, 0.00877, 0.00222);
void main() {
  vec2 uv = vPx / uView;
  vec4 s = texture(uTex, uv) * W[0];
  for (int i = 1; i < 7; i++) {
    vec2 off = uDir * float(i);
    s += (texture(uTex, uv + off) + texture(uTex, uv - off)) * W[i];
  }
  o = s;
}`;

interface Target { tex: WebGLTexture; fb: WebGLFramebuffer; w: number; h: number }
interface Program { prog: WebGLProgram; u: Map<string, WebGLUniformLocation | null> }
type Colour = readonly [number, number, number, number];
const BLACK: Colour = [0, 0, 0, 1];
const WHITE: Colour = [1, 1, 1, 1];

/** A gradient as shader uniforms: three stops (the last repeated when there are two) and their positions. */
const gradientUniforms = new Map<string, { stops: Float32Array; at: Float32Array; count: number }>();
function gradientOf(id: string) {
  let g = gradientUniforms.get(id);
  if (!g) {
    const list = GRADIENTS[id]!.slice(0, 3);
    const stops = new Float32Array(12);
    const at = new Float32Array(3);
    for (let i = 0; i < 3; i++) {
      const [colour, t] = list[Math.min(i, list.length - 1)]!;
      stops.set(rgba(colour), i * 4);
      at[i] = t;
    }
    gradientUniforms.set(id, (g = { stops, at, count: list.length }));
  }
  return g;
}

/** WebGL2 backend. Null when the canvas has no WebGL2. Vector layers come from the same Canvas 2D code as the fallback. */
export function webgl2Backend(canvas: OffscreenCanvas | HTMLCanvasElement, makeCanvas?: MakeCanvas): Backend | null {
  const gl = (canvas as OffscreenCanvas).getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: true, desynchronized: true });
  if (!gl) return null;
  const make: MakeCanvas = makeCanvas ?? ((w, h) => new OffscreenCanvas(w, h));

  const compile = (vs: string, fs: string): Program => {
    const prog = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader failed');
      gl.attachShader(prog, sh);
    }
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link failed');
    return { prog, u: new Map() };
  };
  const loc = (p: Program, name: string) => {
    if (!p.u.has(name)) p.u.set(name, gl.getUniformLocation(p.prog, name));
    return p.u.get(name)!;
  };

  const boxProg = compile(VERT, BOX);
  const blurProg = compile(VERT, BLUR);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.useProgram(boxProg.prog);
  gl.uniform1i(loc(boxProg, 'uTex'), 0);
  gl.uniform1i(loc(boxProg, 'uBackTex'), 1);
  gl.uniform1i(loc(boxProg, 'uMask'), 2);
  gl.useProgram(blurProg.prog);
  gl.uniform1i(loc(blurProg, 'uTex'), 0);

  const newTexture = () => {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  };

  // One texture per role; a picture already uploaded (a held frame, a background image) is not sent again.
  const uploads = new Map<string, { tex: WebGLTexture; src: unknown }>();
  const upload = (role: string, pic: Picture | OffscreenCanvas, always = false): WebGLTexture => {
    let t = uploads.get(role);
    if (!t) uploads.set(role, (t = { tex: newTexture(), src: null }));
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    if (always || t.src !== pic) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pic as TexImageSource);
      t.src = always ? null : pic;
    }
    return t.tex;
  };

  const targets = new Map<string, Target>();
  const target = (name: string, w: number, h: number): Target => {
    let t = targets.get(name);
    if (!t) {
      t = { tex: newTexture(), fb: gl.createFramebuffer()!, w: 0, h: 0 };
      targets.set(name, t);
    }
    if (t.w !== w || t.h !== h) {
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
      t.w = w;
      t.h = h;
    }
    return t;
  };

  const planes = new Map<string, { canvas: ReturnType<MakeCanvas>; ctx: Ctx2D }>();
  const plane = (name: string, w: number, h: number) => {
    let p = planes.get(name);
    if (!p || p.canvas.width !== w || p.canvas.height !== h) {
      const c = make(w, h);
      p = { canvas: c, ctx: c.getContext('2d') as Ctx2D };
      planes.set(name, p);
    }
    return p;
  };

  // The parameters of one box draw, reused for every draw.
  const P = {
    mode: 0, quad: box(), rect: box(), radius: 0, alpha: 1, color: BLACK as Colour,
    map: box(), uv: box(0, 0, 1, 1), mirror: false, block: 0, sigma: 0, tex: null as WebGLTexture | null,
    back: null as WebGLTexture | null, mask: null as WebGLTexture | null, backMode: 0,
  };
  const view = { w: 1, h: 1, flip: -1 };
  const reset = (b: Box) => {
    P.mode = 0; P.radius = 0; P.alpha = 1; P.color = BLACK; P.mirror = false; P.block = 0; P.sigma = 0;
    P.tex = null; P.back = null; P.mask = null; P.backMode = 0;
    Object.assign(P.quad, b);
    Object.assign(P.rect, b);
    Object.assign(P.map, b);
    Object.assign(P.uv, { x: 0, y: 0, w: 1, h: 1 });
  };
  const setView = (fb: WebGLFramebuffer | null, w: number, h: number, blend: boolean) => {
    // A texture left on unit 1 or 2 may be this target; that feedback loop drops the draw.
    unbindUnit(1);
    unbindUnit(2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, w, h);
    view.w = w;
    view.h = h;
    view.flip = fb ? 1 : -1;
    if (blend) gl.enable(gl.BLEND);
    else gl.disable(gl.BLEND);
  };
  const drawBox = () => {
    const p = boxProg;
    gl.useProgram(p.prog);
    gl.uniform4f(loc(p, 'uQuad'), P.quad.x, P.quad.y, P.quad.w, P.quad.h);
    gl.uniform2f(loc(p, 'uView'), view.w, view.h);
    gl.uniform1f(loc(p, 'uFlip'), view.flip);
    gl.uniform1i(loc(p, 'uMode'), P.mode);
    gl.uniform4f(loc(p, 'uRect'), P.rect.x, P.rect.y, P.rect.w, P.rect.h);
    gl.uniform1f(loc(p, 'uRadius'), P.radius);
    gl.uniform1f(loc(p, 'uAlpha'), P.alpha);
    gl.uniform4f(loc(p, 'uColor'), P.color[0], P.color[1], P.color[2], P.color[3]);
    gl.uniform4f(loc(p, 'uMap'), P.map.x, P.map.y, P.map.w, P.map.h);
    gl.uniform4f(loc(p, 'uUV'), P.uv.x, P.uv.y, P.uv.w, P.uv.h);
    gl.uniform1f(loc(p, 'uMirror'), P.mirror ? 1 : 0);
    gl.uniform1f(loc(p, 'uBlock'), P.block);
    gl.uniform1f(loc(p, 'uSigma'), Math.max(P.sigma, 1e-3));
    gl.uniform1i(loc(p, 'uBackMode'), P.backMode);
    if (P.tex) bindUnit(0, P.tex);
    if (P.back) bindUnit(1, P.back);
    if (P.mask) bindUnit(2, P.mask);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  const unbindUnit = (unit: number) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
  };
  const bindUnit = (unit: number, tex: WebGLTexture) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.activeTexture(gl.TEXTURE0);
  };

  /** The part `uv` of a texture, blurred with sigma `sigma` canvas px at canvas size w x h. Returns a texture. */
  const blurred = (name: string, tex: WebGLTexture, uv: Box, w: number, h: number, sigma: number): WebGLTexture => {
    const level = Math.max(1, sigma / 2);
    const lw = Math.max(1, Math.ceil(w / level));
    const lh = Math.max(1, Math.ceil(h / level));
    const a = target(`${name}-a`, lw, lh);
    const b = target(`${name}-b`, lw, lh);
    setView(a.fb, lw, lh, false);
    reset({ x: 0, y: 0, w: lw, h: lh });
    P.mode = 2;
    P.tex = tex;
    Object.assign(P.uv, uv);
    drawBox();
    const pass = (from: Target, to: Target, dx: number, dy: number) => {
      setView(to.fb, lw, lh, false);
      gl.useProgram(blurProg.prog);
      gl.uniform4f(loc(blurProg, 'uQuad'), 0, 0, lw, lh);
      gl.uniform2f(loc(blurProg, 'uView'), lw, lh);
      gl.uniform1f(loc(blurProg, 'uFlip'), 1);
      gl.uniform2f(loc(blurProg, 'uDir'), dx / lw, dy / lh);
      gl.bindTexture(gl.TEXTURE_2D, from.tex);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    pass(a, b, 1, 0);
    pass(b, a, 0, 1);
    return a.tex;
  };

  const dest = box();
  const area = box();
  const crop = box();
  const rect = box();
  const size: Size = { w: 0, h: 0 };
  const shadow = { sigma: 0, dy: 0, alpha: 0 };
  const full = box();

  const toScreen = (scene: Scene) => setView(null, scene.width, scene.height, true);

  const shadowed = (b: Box, radius: number, blur: number, k: number, alpha: number) => {
    shadowOf(blur, shadow);
    if (shadow.alpha <= 0) return;
    const s = shadow.sigma * k;
    const dy = shadow.dy * k;
    reset({ x: b.x - 3 * s, y: b.y - 3 * s + dy, w: b.w + 6 * s, h: b.h + 6 * s });
    Object.assign(P.rect, { x: b.x, y: b.y + dy, w: b.w, h: b.h });
    P.mode = 3;
    P.radius = radius;
    P.sigma = s;
    P.color = BLACK;
    P.alpha = alpha * shadow.alpha;
    drawBox();
  };

  const background = (scene: Scene) => {
    const fill = backgroundFill(scene.plan.background, !!scene.background);
    if (fill.kind === 'picture') {
      const pic = scene.background!;
      coverCrop(pictureSize(pic, size), full, crop);
      let tex = upload('background', pic);
      if (fill.blur) {
        tex = blurred('background', tex, crop, scene.width, scene.height, BACKGROUND_BLUR * scene.scale.x);
        toScreen(scene);
      }
      reset(full);
      P.mode = 2;
      P.tex = tex;
      if (!fill.blur) Object.assign(P.uv, crop);
    } else if (fill.kind === 'gradient') {
      const line = gradientLine(full);
      const g = gradientOf(scene.plan.background.value);
      gl.useProgram(boxProg.prog);
      gl.uniform4f(loc(boxProg, 'uLine'), line.x0, line.y0, line.x1, line.y1);
      gl.uniform1i(loc(boxProg, 'uCount'), g.count);
      gl.uniform4fv(loc(boxProg, 'uStops'), g.stops);
      gl.uniform3fv(loc(boxProg, 'uAt'), g.at);
      reset(full);
      P.mode = 1;
    } else {
      reset(full);
      P.color = rgba(fill.colour);
    }
    drawBox();
  };

  const screenLayer = (scene: Scene) => {
    const s = scene.plan.screen!;
    toCanvas(s.dest, scene.scale, dest);
    const r = s.radius * scene.scale.x;
    shadowed(dest, r, s.shadow, scene.scale.x, 1);
    reset(dest);
    P.radius = r;
    if (scene.screen) {
      P.mode = 2;
      P.tex = upload('screen', scene.screen);
      Object.assign(P.uv, s.crop);
    }
    drawBox();
  };

  const mediaLayer = (scene: Scene) => {
    if (!scene.media) return;
    const s = scene.plan.screen;
    if (s) toCanvas(s.dest, scene.scale, area);
    else Object.assign(area, full);
    const r = s ? s.radius * scene.scale.x : 0;
    reset(area);
    P.radius = r;
    drawBox();
    containBox(pictureSize(scene.media, size), area, dest);
    reset(dest);
    P.radius = r;
    P.mode = 2;
    P.tex = upload('media', scene.media);
    drawBox();
  };

  const privacyLayer = (scene: Scene) => {
    const s = scene.plan.screen!;
    toCanvas(s.dest, scene.scale, area);
    const screenTex = scene.screen ? upload('screen', scene.screen) : null;
    for (const o of scene.plan.overlays) {
      if (!isPrivacy(o)) continue;
      toCanvas(overlayBox(o.box, s, rect), scene.scale, rect);
      if (!intersect(rect, area, rect)) continue;
      const mode = o.blur?.mode ?? 'blur';
      const amount = o.blur?.amount ?? 1;
      if (mode === 'solid' || !screenTex) {
        reset(rect);
        P.color = rgba(SOLID);
        drawBox();
      } else if (mode === 'blur') {
        const tex = blurred('privacy', screenTex, s.crop, area.w, area.h, blurRadius(amount) * scene.scale.x);
        toScreen(scene);
        reset(rect);
        Object.assign(P.map, area);
        P.mode = 2;
        P.tex = tex;
        drawBox();
      } else {
        reset(rect);
        Object.assign(P.map, area);
        Object.assign(P.uv, s.crop);
        P.mode = 2;
        P.tex = screenTex;
        P.block = Math.max(1, pixelBlock(amount) * scene.scale.x);
        drawBox();
      }
    }
  };

  const cameraLayer = (scene: Scene) => {
    const c = scene.plan.camera!;
    if (!scene.camera) return;
    const k = scene.scale.x;
    toCanvas(c.dest, scene.scale, dest);
    const r = c.edge ? 0 : cameraRadius(c.shape, dest, c.round);
    const ring = c.edge ? 0 : cameraRing(c.dest) * k;
    Object.assign(area, { x: dest.x - ring, y: dest.y - ring, w: dest.w + 2 * ring, h: dest.h + 2 * ring });
    if (!c.edge) shadowed(area, r + ring, Math.min(60, Math.min(c.dest.w, c.dest.h) * 0.28), k, c.alpha);
    if (ring > 0) {
      reset(area);
      P.radius = r + ring;
      P.color = WHITE;
      P.alpha = c.alpha;
      drawBox();
    }
    coverCrop(pictureSize(scene.camera, size), dest, crop);
    const tex = upload('camera', scene.camera);
    let back: WebGLTexture | null = null;
    const masked = c.blur.on && scene.mask;
    if (masked && c.blur.mode === 'blur') {
      back = blurred('camera', tex, crop, dest.w, dest.h, CAMERA_BLUR * k);
      toScreen(scene);
    }
    reset(dest);
    P.radius = r;
    P.alpha = c.alpha;
    P.mirror = c.mirror;
    P.mode = masked ? 4 : 2;
    P.tex = tex;
    Object.assign(P.uv, crop);
    if (masked) {
      P.mask = upload('mask', scene.mask!);
      P.backMode = back ? 1 : 0;
      P.back = back;
      P.color = rgba(c.blur.colour);
    }
    drawBox();
  };

  const vectors = (scene: Scene, name: 'under' | 'over', layers: readonly Layer[]) => {
    const p = plane(name, scene.width, scene.height);
    p.ctx.setTransform(1, 0, 0, 1, 0, 0);
    p.ctx.clearRect(0, 0, scene.width, scene.height);
    for (const layer of layers) if (scene.layers.includes(layer)) drawVector(p.ctx, scene, layer);
    reset(full);
    P.mode = 2;
    P.tex = upload(name, p.canvas as OffscreenCanvas, true);
    drawBox();
  };

  return {
    kind: 'webgl2',
    draw(scene) {
      Object.assign(full, { x: 0, y: 0, w: scene.width, h: scene.height });
      toScreen(scene);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      let under = false;
      let over = false;
      for (const layer of scene.layers) {
        switch (layer) {
          case 'background': background(scene); break;
          case 'screen': screenLayer(scene); break;
          case 'media': mediaLayer(scene); break;
          case 'privacy': privacyLayer(scene); break;
          case 'camera': cameraLayer(scene); break;
          case 'overlays': case 'cursor':
            if (!under) vectors(scene, 'under', VECTOR_UNDER);
            under = true;
            break;
          case 'cards': case 'captions':
            if (!over) vectors(scene, 'over', VECTOR_OVER);
            over = true;
            break;
          case 'fade':
            reset(full);
            P.alpha = scene.plan.fade;
            drawBox();
            break;
        }
      }
    },
    dispose() {
      for (const t of uploads.values()) gl.deleteTexture(t.tex);
      for (const t of targets.values()) {
        gl.deleteTexture(t.tex);
        gl.deleteFramebuffer(t.fb);
      }
      uploads.clear();
      targets.clear();
      planes.clear();
      gl.deleteBuffer(buf);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(boxProg.prog);
      gl.deleteProgram(blurProg.prog);
    },
  };
}
