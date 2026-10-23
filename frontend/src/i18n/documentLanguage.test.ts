import { afterAll, describe, expect, it } from 'vitest';
import i18n, { changeAppLanguage, i18nReady } from './index';

// `<html lang>` names the interface language: at start, then at every change.
describe('document language', () => {
  afterAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('follows the interface language', async () => {
    await i18nReady;
    expect(document.documentElement.lang).toBe(i18n.language.split('-')[0]);

    await changeAppLanguage('fr');
    expect(document.documentElement.lang).toBe('fr');

    await i18n.changeLanguage('de-DE');
    expect(document.documentElement.lang).toBe('de');

    await changeAppLanguage('en');
    expect(document.documentElement.lang).toBe('en');
  });
});
