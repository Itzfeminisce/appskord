/** int8 vectors: 384 numbers stored as bytes plus one scale (about 0.4 KB a window). */

export interface Quantized { v: Int8Array; scale: number }

export function quantize(x: ArrayLike<number>): Quantized {
  let max = 0;
  for (let i = 0; i < x.length; i++) max = Math.max(max, Math.abs(x[i]!));
  const scale = max / 127 || 1;
  const v = new Int8Array(x.length);
  for (let i = 0; i < x.length; i++) v[i] = Math.round(x[i]! / scale);
  return { v, scale };
}

export function dequantize({ v, scale }: Quantized): Float32Array {
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! * scale;
  return out;
}

/** Cosine similarity; the scale cancels out, so int8 rows compare without dequantizing. */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
