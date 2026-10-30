import type { Credit, LicenceId } from '../types';

/** The short tag on a result ("CC BY"). */
export const LICENCE_TAG: Record<LicenceId, string> = {
  cc0: 'CC0', pdm: 'Public Domain', 'cc-by': 'CC BY', 'cc-by-sa': 'CC BY-SA', 'cc-by-nc': 'CC BY-NC', pexels: 'Pexels', own: 'Your own',
};

/** Passes by default; the rest show only with Settings "Show all licences". */
const FREE_BY_DEFAULT: readonly LicenceId[] = ['cc0', 'pdm', 'cc-by', 'pexels'];

/** Maps an Openverse licence code ("by", "by-sa", "cc0", "pdm") to our id. No-derivatives licences return undefined: a clip edits what it uses. */
export function openverseLicence(code: string | undefined): LicenceId | undefined {
  switch ((code ?? '').toLowerCase()) {
    case 'cc0': return 'cc0';
    case 'pdm': return 'pdm';
    case 'by': return 'cc-by';
    case 'by-sa': return 'cc-by-sa';
    case 'by-nc': case 'by-nc-sa': return 'cc-by-nc';
    default: return undefined;
  }
}

export function isFreeToUse(licence: LicenceId, allLicences: boolean): boolean {
  return allLicences ? licence !== 'own' : FREE_BY_DEFAULT.includes(licence);
}

/** True when the licence asks for a credit line. */
export function needsCredit(licence: LicenceId): boolean {
  return licence === 'cc-by' || licence === 'cc-by-sa' || licence === 'cc-by-nc';
}

/** "CC BY 4.0" from the code and version; "CC BY" when the version is unknown. */
export function licenceName(licence: LicenceId, version?: string): string {
  if (licence === 'pexels') return 'Pexels licence';
  const tag = LICENCE_TAG[licence];
  return version && (needsCredit(licence) || licence === 'cc0') ? `${tag} ${version}` : tag;
}

/** "CC BY-NC-SA 4.0" from an Openverse code; keeps the exact licence that LicenceId folds into cc-by-nc. */
export function openverseLicenceName(code: string | undefined, licence: LicenceId, version?: string): string {
  const c = (code ?? '').toLowerCase();
  return /^by(-nc)?(-sa)?$/.test(c) ? `CC ${c.toUpperCase()}${version ? ` ${version}` : ''}` : licenceName(licence, version);
}

/** A credit's licence for people: the exact name and version come from the licence link when there is one. */
export function creditLicenceName(credit: Pick<Credit, 'licence' | 'licenceUrl'>): string {
  const m = /\/licenses\/([a-z-]+)\/(\d+\.\d+)/.exec(credit.licenceUrl ?? '');
  return m ? openverseLicenceName(m[1], credit.licence, m[2]) : licenceName(credit.licence);
}
