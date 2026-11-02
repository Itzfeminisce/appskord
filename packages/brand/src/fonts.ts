/** The fonts bundled with Appskord (OFL, via @fontsource); nothing is loaded from the web. */
export const BRAND_FONTS = ['Geist', 'Inter', 'Archivo', 'Archivo Black'] as const;
export type BrandFont = (typeof BRAND_FONTS)[number];
export const DEFAULT_BRAND_FONT: BrandFont = 'Inter';

const FAMILY: Record<BrandFont, string> = {
  Geist: "'Geist Variable'",
  Inter: "'Inter Variable'",
  Archivo: "'Archivo Variable'",
  'Archivo Black': "'Archivo Black'",
};

/** A CSS font-family value that draws `name` in its own bundled font, falling back to the system face. */
export const brandFontFamily = (name: string): string =>
  `${(FAMILY as Record<string, string | undefined>)[name] ?? `'${name.replace(/'/g, '')}'`}, system-ui, sans-serif`;
