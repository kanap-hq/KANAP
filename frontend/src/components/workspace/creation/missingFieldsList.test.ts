import { describe, expect, it } from 'vitest';
import { missingFieldsList } from './missingFieldsList';

describe('missingFieldsList', () => {
  it('lowers the first letter of each label in the middle of a sentence', () => {
    expect(missingFieldsList(['Paying company', 'Account'], 'en')).toBe('paying company, account');
    expect(missingFieldsList(['Société payeuse', 'Compte'], 'fr')).toBe('société payeuse, compte');
    expect(missingFieldsList(['Empresa pagadora', 'Cuenta'], 'es')).toBe('empresa pagadora, cuenta');
  });

  it('keeps a label that starts with an acronym', () => {
    expect(missingFieldsList(['IT tower', 'Account'], 'en')).toBe('IT tower, account');
  });

  it('keeps the capitals in German', () => {
    expect(missingFieldsList(['Zahlende Gesellschaft', 'Konto'], 'de')).toBe('Zahlende Gesellschaft, Konto');
  });
});
