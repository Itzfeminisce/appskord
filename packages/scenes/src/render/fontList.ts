import type { ClipFrames } from '../types';

/** One bundled OFL face in public/fonts; styles/fonts.css declares the same list for pages (fontList.test.ts keeps them equal). */
export interface BundledFace {
  family: string;
  weight: number;
  file: string;
}

const faces = (family: string, slug: string, weights: number[]): BundledFace[] =>
  weights.map((weight) => ({ family, weight, file: `/fonts/${slug}-latin-${weight}-normal.woff2` }));

export const BUNDLED_FONTS: readonly BundledFace[] = [
  ...faces('Inter', 'inter', [400, 500, 600, 700]),
  ...faces('Archivo Black', 'archivo-black', [400]),
  ...faces('Archivo', 'archivo', [400, 600]),
  ...faces('Fredoka', 'fredoka', [500, 600]),
  ...faces('Nunito', 'nunito', [400, 600, 700]),
  ...faces('Source Serif 4', 'source-serif-4', [600, 700]),
  ...faces('IBM Plex Sans', 'ibm-plex-sans', [400, 500, 600]),
  ...faces('Space Grotesk', 'space-grotesk', [500, 700]),
];

/** Every bundled face of each family the recipe's text layers use. */
export function bundledFacesFor(recipe: Pick<ClipFrames, 'scenes'>): BundledFace[] {
  const used = new Set(recipe.scenes.flatMap((s) => s.layers.flatMap((l) => (l.type === 'text' ? [l.font] : []))));
  return BUNDLED_FONTS.filter((f) => used.has(f.family));
}

interface FaceSet {
  add(face: FontFace): unknown;
}

/** Loads the faces into a font set (a worker's self.fonts), resolving URLs against the extension root; a face that fails is skipped. */
export async function loadBundledFonts(fonts: FaceSet, root: string, list: readonly BundledFace[]): Promise<void> {
  await Promise.all(
    list.map(async (f) => {
      try {
        const face = new FontFace(f.family, `url(${new URL(f.file, root).href})`, {
          weight: String(f.weight),
          style: 'normal',
        });
        fonts.add(await face.load());
      } catch {
        /* the text falls back to system-ui, as on a page without the file */
      }
    }),
  );
}
