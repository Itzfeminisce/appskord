// Ambient types for libraries that ship none (or ship them without a "types" entry), and for Vite asset URLs.
declare module '*?url' {
  const url: string;
  export default url;
}

declare module 'troika-three-text' {
  import type { Mesh } from 'three';
  export class Text extends Mesh {
    text: string;
    font: string | null;
    fontSize: number;
    letterSpacing: number;
    anchorX: number | string;
    anchorY: number | string;
    color: number | string;
    outlineWidth: number | string;
    outlineColor: number | string;
    sync(callback?: () => void): void;
    dispose(): void;
  }
  export function configureTextBuilder(config: {
    useWorker?: boolean;
    sdfGlyphSize?: number;
    defaultFontURL?: string | null;
  }): void;
}

declare module 'opentype.js' {
  export interface Font {
    numGlyphs: number;
    unitsPerEm: number;
    charToGlyph(c: string): { index: number };
    getPath(text: string, x: number, y: number, size: number): { commands: unknown[] };
  }
  export function parse(buffer: ArrayBuffer): Font;
}

declare module 'flubber' {
  export function interpolate(
    from: string | number[][],
    to: string | number[][],
    options?: { maxSegmentLength?: number; string?: boolean },
  ): (t: number) => string;
}
