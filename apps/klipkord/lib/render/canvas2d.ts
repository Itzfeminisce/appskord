import type { Box, Camera } from '../project/types';
import { backgroundFill, GRADIENTS } from './layers/background';
import {
  BACKGROUND_BLUR, blurRadius, box, cameraRadius, cameraRing, containBox, coverCrop, cropPx, gradientLine, intersect,
  overlayBox, pixelBlock, shadowOf, toCanvas, type Size,
} from './layers/geometry';
import { isPrivacy } from './layers/order';
import { SOLID } from './layers/overlays';
import { roundRect, type Ctx2D } from './layers/path';
import { drawVector, pictureSize, type Backend, type Picture, type Scene } from './layers/scene';

/** Blur behind the person when "Blur behind you" is on, frame px. */
export const CAMERA_BLUR = 24;

/** A small canvas for pixelate and the camera mask; `OffscreenCanvas` in a worker. */
export type MakeCanvas = (w: number, h: number) => { width: number; height: number; getContext(type: '2d'): unknown };

const offscreen: MakeCanvas = (w, h) => new OffscreenCanvas(w, h);

/** Canvas 2D: the fallback when WebGL2 is missing, and the reference picture. */
export function canvas2dBackend(ctx: Ctx2D, makeCanvas: MakeCanvas = offscreen): Backend {
  // Reused every frame so drawing allocates nothing in steady state.
  const dest = box();
  const area = box();
  const src = box();
  const crop = box();
  const rect = box();
  const inner = box();
  const size: Size = { w: 0, h: 0 };
  const shadow = { sigma: 0, dy: 0, alpha: 0 };
  const gradients = new Map<string, CanvasGradient>();
  const scratch = new Map<string, { canvas: ReturnType<MakeCanvas>; ctx: Ctx2D }>();

  const canvasOf = (key: string, w: number, h: number) => {
    let s = scratch.get(key);
    if (!s || s.canvas.width !== w || s.canvas.height !== h) {
      const canvas = makeCanvas(w, h);
      s = { canvas, ctx: canvas.getContext('2d') as Ctx2D };
      scratch.set(key, s);
    }
    return s;
  };

  /** Draws the part `crop` (0..1) of a picture into a canvas box. */
  const drawPart = (pic: Picture, c: Box, to: Box, target: Ctx2D = ctx) => {
    cropPx(c, pictureSize(pic, size), src);
    if (src.w <= 0 || src.h <= 0 || to.w <= 0 || to.h <= 0) return;
    target.drawImage(pic as CanvasImageSource, src.x, src.y, src.w, src.h, to.x, to.y, to.w, to.h);
  };

  const background = (scene: Scene) => {
    const fill = backgroundFill(scene.plan.background, !!scene.background);
    const { width: W, height: H } = scene;
    if (fill.kind === 'colour') {
      ctx.fillStyle = fill.colour;
      ctx.fillRect(0, 0, W, H);
    } else if (fill.kind === 'gradient') {
      const key = `${scene.plan.background.value}:${W}x${H}`;
      let g = gradients.get(key);
      if (!g) {
        const line = gradientLine({ x: 0, y: 0, w: W, h: H });
        g = ctx.createLinearGradient(line.x0, line.y0, line.x1, line.y1);
        for (const [colour, at] of GRADIENTS[scene.plan.background.value]!) g.addColorStop(at, colour);
        gradients.clear();
        gradients.set(key, g);
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    } else {
      const pic = scene.background!;
      coverCrop(pictureSize(pic, size), { w: W, h: H }, crop);
      ctx.save();
      if (fill.blur) {
        const r = BACKGROUND_BLUR * scene.scale.x;
        ctx.filter = `blur(${r}px)`;
        // Drawn past the edges so the blur does not fade to transparent there.
        Object.assign(area, { x: -2 * r, y: -2 * r, w: W + 4 * r, h: H + 4 * r });
      } else Object.assign(area, { x: 0, y: 0, w: W, h: H });
      drawPart(pic, crop, area);
      ctx.restore();
    }
  };

  const shadowed = (b: Box, radius: number, blur: number, scale: number) => {
    shadowOf(blur, shadow);
    if (shadow.alpha <= 0) return;
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${shadow.alpha})`;
    ctx.shadowBlur = shadow.sigma * 2 * scale;
    ctx.shadowOffsetY = shadow.dy * scale;
    ctx.fillStyle = '#000000';
    roundRect(ctx, b.x, b.y, b.w, b.h, radius);
    ctx.fill();
    ctx.restore();
  };

  const screenLayer = (scene: Scene) => {
    const s = scene.plan.screen!;
    toCanvas(s.dest, scene.scale, dest);
    const r = s.radius * scene.scale.x;
    shadowed(dest, r, s.shadow, scene.scale.x);
    ctx.save();
    roundRect(ctx, dest.x, dest.y, dest.w, dest.h, r);
    ctx.clip();
    if (scene.screen) drawPart(scene.screen, s.crop, dest);
    else {
      ctx.fillStyle = '#000000';
      ctx.fill();
    }
    ctx.restore();
  };

  const mediaLayer = (scene: Scene) => {
    if (!scene.media) return;
    const s = scene.plan.screen;
    if (s) toCanvas(s.dest, scene.scale, area);
    else Object.assign(area, { x: 0, y: 0, w: scene.width, h: scene.height });
    const r = s ? s.radius * scene.scale.x : 0;
    ctx.save();
    roundRect(ctx, area.x, area.y, area.w, area.h, r);
    ctx.clip();
    ctx.fillStyle = '#000000';
    ctx.fill();
    containBox(pictureSize(scene.media, size), area, dest);
    Object.assign(crop, { x: 0, y: 0, w: 1, h: 1 });
    drawPart(scene.media, crop, dest);
    ctx.restore();
  };

  const privacyLayer = (scene: Scene) => {
    const s = scene.plan.screen!;
    toCanvas(s.dest, scene.scale, area);
    for (const o of scene.plan.overlays) {
      if (!isPrivacy(o)) continue;
      toCanvas(overlayBox(o.box, s, rect), scene.scale, rect);
      if (!intersect(rect, area, rect)) continue;
      const mode = o.blur?.mode ?? 'blur';
      const amount = o.blur?.amount ?? 1;
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.clip();
      if (mode === 'solid' || !scene.screen) {
        ctx.fillStyle = SOLID;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      } else if (mode === 'blur') {
        const r = blurRadius(amount) * scene.scale.x;
        inflateWithin(rect, 2 * r, area, inner);
        sourceOf(s.crop, area, inner, crop);
        ctx.filter = `blur(${r}px)`;
        drawPart(scene.screen, crop, inner);
      } else {
        const block = Math.max(1, pixelBlock(amount) * scene.scale.x);
        const w = Math.max(1, Math.ceil(rect.w / block));
        const h = Math.max(1, Math.ceil(rect.h / block));
        const small = canvasOf('pixelate', w, h);
        sourceOf(s.crop, area, { x: rect.x, y: rect.y, w: w * block, h: h * block }, crop);
        small.ctx.clearRect(0, 0, w, h);
        drawPart(scene.screen, crop, { x: 0, y: 0, w, h }, small.ctx);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(small.canvas as CanvasImageSource, 0, 0, w, h, rect.x, rect.y, w * block, h * block);
      }
      ctx.restore();
    }
  };

  const cameraLayer = (scene: Scene) => {
    const c = scene.plan.camera!;
    const cam = scene.camera;
    if (!cam) return;
    toCanvas(c.dest, scene.scale, dest);
    const k = scene.scale.x;
    const r = cameraRadius(c.shape, dest);
    const ring = cameraRing(c.dest) * k;
    ctx.save();
    ctx.globalAlpha = c.alpha;
    Object.assign(area, { x: dest.x - ring, y: dest.y - ring, w: dest.w + 2 * ring, h: dest.h + 2 * ring });
    shadowed(area, r + ring, Math.min(60, Math.min(c.dest.w, c.dest.h) * 0.28), k);
    if (ring > 0) {
      ctx.fillStyle = '#FFFFFF';
      roundRect(ctx, area.x, area.y, area.w, area.h, r + ring);
      ctx.fill();
    }
    roundRect(ctx, dest.x, dest.y, dest.w, dest.h, r);
    ctx.clip();
    if (c.mirror) {
      ctx.translate(dest.x * 2 + dest.w, 0);
      ctx.scale(-1, 1);
    }
    coverCrop(pictureSize(cam, size), dest, crop);
    if (c.blur.on && scene.mask) drawMasked(cam, scene.mask, c.blur, k);
    else drawPart(cam, crop, dest);
    ctx.restore();
  };

  // "Blur behind you": the blurred camera or a colour, with the person on top through the mask.
  const drawMasked = (cam: Picture, mask: Picture, blur: Camera['blur'], k: number) => {
    const w = Math.max(1, Math.round(dest.w));
    const h = Math.max(1, Math.round(dest.h));
    const full = { x: 0, y: 0, w, h };
    const back = canvasOf('camera-back', w, h);
    const person = canvasOf('camera-person', w, h);
    back.ctx.clearRect(0, 0, w, h);
    if (blur.mode === 'colour') {
      back.ctx.fillStyle = blur.colour;
      back.ctx.fillRect(0, 0, w, h);
    } else {
      const br = CAMERA_BLUR * k;
      back.ctx.filter = `blur(${br}px)`;
      drawPart(cam, crop, { x: -2 * br, y: -2 * br, w: w + 4 * br, h: h + 4 * br }, back.ctx);
      back.ctx.filter = 'none';
    }
    person.ctx.globalCompositeOperation = 'source-over';
    person.ctx.clearRect(0, 0, w, h);
    drawPart(cam, crop, full, person.ctx);
    person.ctx.globalCompositeOperation = 'destination-in';
    drawPart(mask, crop, full, person.ctx);
    person.ctx.globalCompositeOperation = 'source-over';
    back.ctx.drawImage(person.canvas as CanvasImageSource, 0, 0);
    ctx.drawImage(back.canvas as CanvasImageSource, 0, 0, w, h, dest.x, dest.y, dest.w, dest.h);
  };

  return {
    kind: 'canvas2d',
    draw(scene) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.filter = 'none';
      ctx.imageSmoothingEnabled = true;
      for (const layer of scene.layers) {
        switch (layer) {
          case 'background': background(scene); break;
          case 'screen': screenLayer(scene); break;
          case 'media': mediaLayer(scene); break;
          case 'privacy': privacyLayer(scene); break;
          case 'camera': cameraLayer(scene); break;
          case 'overlays': case 'cursor': case 'cards': case 'captions': drawVector(ctx, scene, layer); break;
          case 'fade':
            ctx.fillStyle = `rgba(0,0,0,${scene.plan.fade})`;
            ctx.fillRect(0, 0, scene.width, scene.height);
            break;
        }
      }
    },
    dispose() {
      scratch.clear();
      gradients.clear();
    },
  };
}

/** `b` grown by `by` on each side, kept inside `within`. */
function inflateWithin(b: Box, by: number, within: Box, out: Box): Box {
  const x = Math.max(within.x, b.x - by);
  const y = Math.max(within.y, b.y - by);
  out.w = Math.min(within.x + within.w, b.x + b.w + by) - x;
  out.h = Math.min(within.y + within.h, b.y + b.h + by) - y;
  out.x = x;
  out.y = y;
  return out;
}

/** The 0..1 part of the screen picture that lands in canvas box `part` of the screen's canvas box `dest`. */
export function sourceOf(crop: Box, dest: Box, part: Box, out: Box): Box {
  out.x = crop.x + ((part.x - dest.x) / dest.w) * crop.w;
  out.y = crop.y + ((part.y - dest.y) / dest.h) * crop.h;
  out.w = (part.w / dest.w) * crop.w;
  out.h = (part.h / dest.h) * crop.h;
  return out;
}
