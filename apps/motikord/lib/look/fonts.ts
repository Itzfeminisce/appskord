// The 13 bundled OFL fonts of the v3 packs (PacksV3 "Bundled fonts"). Files live in public/fonts; nothing is fetched.

export interface FontAxisRange {
  tag: 'wght' | 'wdth' | 'opsz' | 'SOFT' | 'WONK';
  min: number;
  max: number;
}
export interface V3Font {
  family: string;
  /** Root path the host ships, such as /fonts/inter-latin-wght-normal.woff2. */
  file: string;
  /** The weight range for a variable file, or the one weight of a static one. */
  weight: [number, number];
  /** Axes the frames animate; empty for a static file. */
  axes: FontAxisRange[];
  licence: 'OFL-1.1';
  licenceFile: string;
}

const font = (family: string, slug: string, file: string, weight: [number, number], axes: FontAxisRange[] = []) => ({
  family,
  file: `/fonts/${file}`,
  weight,
  axes: [{ tag: 'wght' as const, min: weight[0], max: weight[1] }, ...axes].filter((a) => a.min !== a.max),
  licence: 'OFL-1.1' as const,
  licenceFile: `/fonts/licences/${slug}-OFL.txt`,
});

/** In the frame's order: Inter · Archivo Black · Archivo · Fredoka · Nunito · Source Serif 4 · IBM Plex Sans · Geist · Geist Mono · Bricolage Grotesque · Outfit · Fraunces · Space Grotesk. */
export const V3_FONTS: readonly V3Font[] = [
  font('Inter', 'inter', 'inter-latin-wght-normal.woff2', [100, 900]),
  font('Archivo Black', 'archivo-black', 'archivo-black-latin-400-normal.woff2', [400, 400]),
  font('Archivo', 'archivo', 'archivo-latin-wdth-normal.woff2', [100, 900], [{ tag: 'wdth', min: 62, max: 125 }]),
  font('Fredoka', 'fredoka', 'fredoka-latin-wght-normal.woff2', [300, 700]),
  font('Nunito', 'nunito', 'nunito-latin-wght-normal.woff2', [200, 1000]),
  font('Source Serif 4', 'source-serif-4', 'source-serif-4-latin-wght-normal.woff2', [200, 900]),
  font('IBM Plex Sans', 'ibm-plex-sans', 'ibm-plex-sans-latin-wght-normal.woff2', [100, 700]),
  font('Geist', 'geist', 'geist-latin-wght-normal.woff2', [100, 900]),
  font('Geist Mono', 'geist-mono', 'geist-mono-latin-wght-normal.woff2', [100, 900]),
  font(
    'Bricolage Grotesque',
    'bricolage-grotesque',
    'bricolage-grotesque-latin-wdth-normal.woff2',
    [200, 800],
    [{ tag: 'wdth', min: 75, max: 100 }],
  ),
  font('Outfit', 'outfit', 'outfit-latin-wght-normal.woff2', [100, 900]),
  font(
    'Fraunces',
    'fraunces',
    'fraunces-latin-full-normal.woff2',
    [100, 900],
    [
      { tag: 'opsz', min: 9, max: 144 },
      { tag: 'SOFT', min: 0, max: 100 },
      { tag: 'WONK', min: 0, max: 1 },
    ],
  ),
  font('Space Grotesk', 'space-grotesk', 'space-grotesk-latin-wght-normal.woff2', [300, 700]),
];

export const isBundledFont = (family: string) => V3_FONTS.some((f) => f.family === family);
export const v3Font = (family: string): V3Font | undefined => V3_FONTS.find((f) => f.family === family);

/** FontFace descriptors for a bundled font, with its whole weight (and width) range for variable files. */
export function fontFaceDescriptors(f: V3Font): FontFaceDescriptors {
  const wdth = f.axes.find((a) => a.tag === 'wdth');
  return {
    weight: f.weight[0] === f.weight[1] ? String(f.weight[0]) : `${f.weight[0]} ${f.weight[1]}`,
    style: 'normal',
    ...(wdth ? { stretch: `${wdth.min}% ${wdth.max}%` } : {}),
  };
}

/** Loads the given families into a font set (a page's or a worker's), resolving files against the extension root. */
export async function loadV3Fonts(
  fonts: { add(face: FontFace): unknown },
  root: string,
  families: readonly string[] = V3_FONTS.map((f) => f.family),
): Promise<void> {
  await Promise.all(
    V3_FONTS.filter((f) => families.includes(f.family)).map(async (f) => {
      try {
        const face = new FontFace(f.family, `url(${new URL(f.file, root).href})`, fontFaceDescriptors(f));
        fonts.add(await face.load());
      } catch (error) {
        console.error(`Motikord: could not load font ${f.family}`, error);
      }
    }),
  );
}
