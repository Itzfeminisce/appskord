import type { Credit, LicenceId } from '../types';

/** The short tag on a result ("CC BY"). */
export const LICENCE_TAG: Record<LicenceId, string> = {
  cc0: 'CC0', pdm: 'Public Domain', 'cc-by': 'CC BY', 'cc-by-sa': 'CC BY-SA', 'cc-by-nc': 'CC BY-NC', pexels: 'Pexels', pixabay: 'Pixabay', unsplash: 'Unsplash', unknown: 'Licence unknown', page: 'Web page', own: 'Your own',
};

/** Passes by default; the rest show only with Settings "Show all licences". */
// unknown passes so a custom source still shows; its detail says "Check you may use it".
const FREE_BY_DEFAULT: readonly LicenceId[] = ['cc0', 'pdm', 'cc-by', 'pexels', 'pixabay', 'unsplash', 'unknown'];

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

/** True when the licence asks for a credit line. Unsplash's API terms ask for one; an unknown licence gets one to be safe. */
export function needsCredit(licence: LicenceId): boolean {
  return licence === 'cc-by' || licence === 'cc-by-sa' || licence === 'cc-by-nc' || licence === 'unsplash' || licence === 'unknown';
}

/** Maps a licence link or short name ("CC BY-SA 4.0", "cc-by-4.0", ".../licenses/by/4.0/", "Public domain") to our id. No-derivatives and unknown names return undefined. */
export function licenceFromText(text: string | undefined): LicenceId | undefined {
  const t = (text ?? '').toLowerCase().trim();
  if (!t) return undefined;
  if (/publicdomain\/zero|\bcc0\b|cc-zero|creative commons 0/.test(t)) return 'cc0';
  if (/publicdomain\/mark|public domain|^pd\b|^pd-/.test(t)) return 'pdm';
  if (/(^|[^a-z])nd([^a-z]|$)|sampling/.test(t)) return undefined;
  const m = /(?:licenses\/|cc[ -]?)(by(?:[- ](?:nc|sa))*)/.exec(t);
  if (!m) return undefined;
  const code = m[1]!.replace(/ /g, '-');
  return code.includes('nc') ? 'cc-by-nc' : code.includes('sa') ? 'cc-by-sa' : 'cc-by';
}

/** "4.0" from a licence link or name, when it has one. */
export const licenceVersion = (text: string | undefined): string | undefined => /(\d\.\d)/.exec(text ?? '')?.[1];

/** "CC BY 4.0" from the code and version; "CC BY" when the version is unknown. */
export function licenceName(licence: LicenceId, version?: string): string {
  if (licence === 'pexels') return 'Pexels licence';
  if (licence === 'pixabay') return 'Pixabay Content License';
  if (licence === 'unsplash') return 'Unsplash License';
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
