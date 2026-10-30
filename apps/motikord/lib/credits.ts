import type { Edit } from './editor/store';
import { creditLicenceName, needsCredit } from './media/licence';
import type { Asset, Credit, Recipe } from './types';

export type CreditNeed = 'needed' | 'optional';
export interface CreditRow { asset: Asset; credit: Credit; need: CreditNeed; source: string; licence: string }
export interface CreditsList { credited: CreditRow[]; own: Asset[] }

const KIND_WORD: Record<Asset['kind'], string> = { image: 'Photo', video: 'Video', audio: 'Music', logo: 'Logo', font: 'Font' };

/** Ids of assets the clip really uses: layer media and the music. */
function usedIds(r: Recipe): string[] {
  const ids: string[] = [];
  for (const s of r.scenes) for (const l of s.layers) if ((l.type === 'image' || l.type === 'video') && !ids.includes(l.assetId)) ids.push(l.assetId);
  if (r.music && !ids.includes(r.music.assetId)) ids.push(r.music.assetId);
  return ids;
}

function sourceName(c: Credit): string {
  if (c.source === 'openverse') return 'Openverse';
  if (c.source === 'pexels') return 'Pexels';
  if (c.source === 'bundled') return 'Motikord';
  try { return new URL(c.url).hostname.replace(/^www\./, ''); } catch { return 'A web page'; }
}

/** Everything someone else made, in the order the clip uses it, and your own media (not listed). */
export function creditsList(r: Recipe): CreditsList {
  const credited: CreditRow[] = [];
  const own: Asset[] = [];
  for (const id of usedIds(r)) {
    const asset = r.assets[id];
    if (!asset || asset.kind === 'font') continue;
    if (!asset.credit || asset.credit.licence === 'own') { own.push(asset); continue; }
    credited.push({ asset, credit: asset.credit, need: needsCredit(asset.credit.licence) ? 'needed' : 'optional', source: sourceName(asset.credit), licence: creditLicenceName(asset.credit) });
  }
  return { credited, own };
}

/** CC BY media never exports without credits.txt. */
export const needsCreditsFile = (r: Recipe): boolean => creditsList(r).credited.some((row) => row.need === 'needed');

/** The author, or undefined when the library gave none (the frame has no wording for that, so the "by" is left out). */
const knownAuthor = (c: Credit): string | undefined => (c.author.trim() && c.author.trim().toLowerCase() !== 'unknown' ? c.author.trim() : undefined);
const CC_LICENCES: readonly Credit['licence'][] = ['cc0', 'cc-by', 'cc-by-sa', 'cc-by-nc'];

/** The text of credits.txt. */
export function creditsText(r: Recipe): string {
  const blocks = creditsList(r).credited.map(({ credit, source, licence }) =>
    credit.source === 'bundled'
      ? `“${credit.title}” · ${source} · ${licence}`
      : credit.licence === 'page'
        ? `“${credit.title}” · From ${credit.author}\n${credit.url}`
        : [`“${credit.title}”${knownAuthor(credit) ? ` by ${knownAuthor(credit)}` : ''}`, `${source} · ${licence}`, credit.url, CC_LICENCES.includes(credit.licence) ? credit.licenceUrl : undefined].filter(Boolean).join('\n'));
  return [`${r.name} · made with Motikord`, ...blocks].join('\n\n');
}

/** The lines on the end card. */
export function endCardLines(r: Recipe): string[] {
  return creditsList(r).credited.map(({ asset, credit, source, licence }) => {
    const word = KIND_WORD[asset.kind];
    if (credit.source === 'bundled') return `${word}: ${credit.title}, ${licence}`;
    const by = knownAuthor(credit);
    if (credit.source === 'pexels') return `${word}: ${by ? `${by}, ` : ''}${source}`;
    return `${word}: “${credit.title}”${by ? ` by ${by}` : ''}, ${licence}`;
  });
}

/** Sets creditsEndCard; the renderer shows the card for 2 seconds at the end. */
export function endCardEdit(r: Recipe, on: boolean): Edit | undefined {
  if (!!r.creditsEndCard === on && (on || r.creditsEndCard === undefined)) return undefined;
  return { ops: [{ op: r.creditsEndCard === undefined ? 'add' : 'replace', path: '/creditsEndCard', value: on }], summary: on ? 'Credits end card on' : 'Credits end card off' };
}
