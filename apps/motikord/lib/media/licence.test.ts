import { describe, expect, it } from 'vitest';
import { creditLicenceName, isFreeToUse, licenceName, needsCredit, openverseLicence } from './licence';

describe('licence', () => {
  it('maps Openverse codes and drops no-derivatives', () => {
    expect(['cc0', 'pdm', 'by', 'by-sa', 'by-nc', 'by-nc-sa', 'by-nd', 'by-nc-nd'].map(openverseLicence))
      .toEqual(['cc0', 'pdm', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'cc-by-nc', undefined, undefined]);
  });
  it('passes only cc0, pdm, cc-by and pexels by default', () => {
    expect((['cc0', 'pdm', 'cc-by', 'pexels', 'cc-by-sa', 'cc-by-nc'] as const).map((l) => isFreeToUse(l, false))).toEqual([true, true, true, true, false, false]);
    expect((['cc-by-sa', 'cc-by-nc'] as const).map((l) => isFreeToUse(l, true))).toEqual([true, true]);
  });
  it('asks for a credit on CC BY and its kin', () => {
    expect((['cc-by', 'cc-by-sa', 'cc-by-nc', 'cc0', 'pdm', 'pexels'] as const).map(needsCredit)).toEqual([true, true, true, false, false, false]);
  });
  it('names licences with their version', () => {
    expect(licenceName('cc-by', '4.0')).toBe('CC BY 4.0');
    expect(licenceName('pexels')).toBe('Pexels licence');
    expect(creditLicenceName({ licence: 'cc-by', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/' })).toBe('CC BY 4.0');
    expect(creditLicenceName({ licence: 'cc0' })).toBe('CC0');
    expect(creditLicenceName({ licence: 'cc-by-nc', licenceUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/' })).toBe('CC BY-NC-SA 4.0');
  });
});
