// The brand kit wins over the look guide and the pack on colours, fonts and logo; motion, camera, transitions and
// finishing stay the pack's.
import type { LookGuide } from '@appskord/motion/types';
import type { BrandKit } from '../types';

/** The PacksV3 note shown while a brand kit is on. */
export const BRAND_WINS = '“Your brand kit is on: its colours, fonts and logo replace the pack’s.”';
export const BRAND_KEEPS = 'Motion, camera, transitions and finishing stay the pack’s.';
/** The LookBible line under the guide. */
export const BRAND_WINS_LOOK = 'Your brand kit still wins: colours, fonts and logo.';

/** Palette slots in LookBible order: Ground, Ink, Glow, Panel, Muted. */
const ROLE_SLOT = { background: 0, text: 1, primary: 2, accent: 3 } as const;

export interface BrandedLook {
  guide: LookGuide;
  /** The kit's logo, which replaces any logo the template shows. */
  logoAssetId?: string;
}

/** The guide with the kit's colours by role, its heading and body fonts, and its logo. Pure. */
export function brandLook(guide: LookGuide, kit: BrandKit | undefined): BrandedLook {
  if (!kit) return { guide };
  const palette = [...guide.palette];
  for (const c of kit.colours) {
    const at = ROLE_SLOT[c.role];
    if (at < palette.length) palette[at] = c.hex;
    else palette.push(c.hex);
  }
  const type = { display: kit.headingFont || guide.type.display, text: kit.bodyFont || guide.type.text };
  const branded = { ...guide, palette, type };
  return kit.logoAssetId ? { guide: branded, logoAssetId: kit.logoAssetId } : { guide: branded };
}
