/** The brand kit, exactly as Motikord keeps it (apps/motikord/lib/types.ts). */
export interface BrandKit {
  logoAssetId?: string;
  colours: { hex: string; role: 'primary' | 'accent' | 'text' | 'background' }[];
  headingFont?: string;
  bodyFont?: string;
  useForNewClips: boolean;
}

export type BrandRole = BrandKit['colours'][number]['role'];
export const BRAND_ROLES: readonly BrandRole[] = ['primary', 'text', 'background', 'accent'];

/** What the store keeps and the apps pass each other. `logo` is the logo file as a data URL, since neither app can read the other's files. */
export interface BrandRecord {
  kit: BrandKit;
  logo?: string;
  updatedAt: number;
}

export const emptyKit = (): BrandKit => ({ colours: [], useForNewClips: false });

/** The logo's asset id carries its extension ("brand-logo-png"), as Motikord names it. */
export const logoAssetId = (mime: string): string =>
  `brand-logo-${(/^image\/(png|jpeg|webp|gif|svg)/.exec(mime)?.[1] ?? 'png').replace('jpeg', 'jpg')}`;

export const colourOf = (kit: BrandKit, role: BrandRole): string | undefined =>
  kit.colours.find((c) => c.role === role)?.hex;

/** Sets one role's colour, keeping the others in their order. */
export function withColour(kit: BrandKit, role: BrandRole, hex: string): BrandKit {
  const has = kit.colours.some((c) => c.role === role);
  return {
    ...kit,
    colours: has ? kit.colours.map((c) => (c.role === role ? { hex, role } : c)) : [...kit.colours, { hex, role }],
  };
}

const HEX = /^#[0-9a-f]{6}$/i;
const str = (x: unknown) => x === undefined || typeof x === 'string';

/** The longest logo data URL a record may carry (512 KB). */
export const MAX_LOGO_LENGTH = 512 * 1024;

/** A message or stored value is only trusted once it has the kit's shape. */
export function isBrandKit(x: unknown): x is BrandKit {
  if (!x || typeof x !== 'object') return false;
  const k = x as Record<string, unknown>;
  return (
    Array.isArray(k.colours) &&
    k.colours.length <= BRAND_ROLES.length &&
    k.colours.every(
      (c: unknown) =>
        !!c &&
        typeof c === 'object' &&
        HEX.test(String((c as { hex?: unknown }).hex)) &&
        BRAND_ROLES.includes((c as { role?: unknown }).role as BrandRole),
    ) &&
    str(k.logoAssetId) &&
    str(k.headingFont) &&
    str(k.bodyFont) &&
    typeof k.useForNewClips === 'boolean'
  );
}

export function isBrandRecord(x: unknown): x is BrandRecord {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  return (
    isBrandKit(r.kit) &&
    typeof r.updatedAt === 'number' &&
    Number.isFinite(r.updatedAt) &&
    (r.logo === undefined ||
      (typeof r.logo === 'string' && r.logo.length <= MAX_LOGO_LENGTH && r.logo.startsWith('data:image/')))
  );
}

/** A peer's clock cannot put its record in the future, where it would win every later tie. */
export const clampRecord = (r: BrandRecord, now = Date.now()): BrandRecord =>
  r.updatedAt > now ? { ...r, updatedAt: now } : r;

/** The newer of two records; the one we already have wins a tie. */
export const newer = (have: BrandRecord | null, other: BrandRecord): boolean =>
  !have || other.updatedAt > have.updatedAt;
