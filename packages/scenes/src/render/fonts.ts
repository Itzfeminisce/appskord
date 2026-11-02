import { BUNDLED_FONTS, loadBundledFonts, type BundledFace } from './fontList';

/** The pack fonts; each `file` is a root path such as /fonts/inter-latin-400-normal.woff2 the host ships itself. */
export const SCENE_FONTS: readonly BundledFace[] = BUNDLED_FONTS;

/** Loads every pack font into a font set (a page's or a worker's fonts), resolving files against baseUrl. */
export function loadSceneFonts(
  fonts: { add(face: FontFace): unknown },
  baseUrl: string,
  list: readonly BundledFace[] = SCENE_FONTS,
): Promise<void> {
  return loadBundledFonts(fonts, baseUrl, list);
}
