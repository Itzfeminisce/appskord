import { LAYERS, poseAt, sceneAt } from '@/lib/check/scene';

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const WORDS = ['Make it move', 'Spring sale', 'Made on your computer'];

/** Two 512 px test pictures (stand-ins for photos), drawn once and cached as bitmaps. */
export function makeImages(): ImageBitmap[] {
  return [0, 1].map((n) => {
    const c = new OffscreenCanvas(512, 512);
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(256, 200, 20, 256, 256, 360);
    grad.addColorStop(0, n ? '#ffd166' : '#8ecae6');
    grad.addColorStop(1, n ? '#ef476f' : '#023047');
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 512);
    for (let k = 0; k < 40; k++) {
      g.fillStyle = `hsla(${(k * 37 + n * 90) % 360} 70% 60% / 0.5)`;
      g.beginPath();
      g.arc((k * 97) % 512, (k * 53) % 512, 10 + (k % 7) * 6, 0, Math.PI * 2);
      g.fill();
    }
    return c.transferToImageBitmap();
  });
}

/** Draws the test clip at `seconds`. With `seeThrough` the background stays transparent. */
export function drawFrame(ctx: Ctx, seconds: number, w: number, h: number, images: ImageBitmap[], seeThrough = false) {
  const { scene } = sceneAt(seconds);
  if (seeThrough) ctx.clearRect(0, 0, w, h);
  else {
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, `hsl(${scene * 120 + 200} 45% 18%)`);
    bg.addColorStop(1, `hsl(${scene * 120 + 260} 55% 32%)`);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
  }
  const unit = h / 1080;
  for (let i = 0; i < LAYERS; i++) {
    const p = poseAt(i, seconds, w, h);
    if (p.alpha <= 0) continue;
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotate);
    ctx.scale(p.scale, p.scale);
    if (p.kind === 'image') {
      const s = 300 * unit;
      ctx.drawImage(images[i % images.length]!, -s / 2, -s / 2, s, s);
    } else if (p.kind === 'text') {
      ctx.font = `700 ${Math.round(64 * unit)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 18 * unit;
      ctx.shadowOffsetY = 6 * unit;
      ctx.fillStyle = '#fff';
      ctx.fillText(WORDS[(i + scene) % WORDS.length]!, 0, 0);
    } else {
      const s = 180 * unit;
      const g = ctx.createLinearGradient(-s, -s, s, s);
      g.addColorStop(0, `hsl(${p.hue} 85% 60%)`);
      g.addColorStop(1, `hsl(${(p.hue + 60) % 360} 85% 45%)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      if (i % 2) ctx.roundRect(-s / 2, -s / 2, s, s, 24 * unit);
      else ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
