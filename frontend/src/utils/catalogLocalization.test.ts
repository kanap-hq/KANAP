import { describe, expect, it } from 'vitest';
import { localizeCatalogItem, localizeCatalogList, previewCatalogField, toCatalogLocale, type CatalogDefaults } from './catalogLocalization';

const defaults: CatalogDefaults = {
  source: { high: { label: 'High', description: 'Up to one day.' } },
  translated: (locale, code) => (locale === 'fr' && code === 'high' ? { label: 'Élevée', description: "Jusqu'à un jour." } : undefined),
};

describe('catalog localization', () => {
  it('falls back field by field: tenant translation, shipped translation for an untouched field, base text', () => {
    const untouched = { code: 'high', label: 'High', description: 'Up to one day.' };
    expect(localizeCatalogItem(untouched, 'fr', defaults)).toEqual({ code: 'high', label: 'Élevée', description: "Jusqu'à un jour." });
    const renamed = { code: 'high', label: 'Tier 1', description: 'Up to one day.' };
    expect(localizeCatalogItem(renamed, 'fr', defaults)).toEqual({ code: 'high', label: 'Tier 1', description: "Jusqu'à un jour." });
    const translated = { ...renamed, translations: { fr: { label: 'Niveau 1' } } };
    expect(localizeCatalogItem(translated, 'fr', defaults)).toMatchObject({ label: 'Niveau 1', description: "Jusqu'à un jour." });
    expect(localizeCatalogItem(translated, 'de', defaults)).toMatchObject({ label: 'Tier 1', description: 'Up to one day.' });
    const descriptionOnly = { ...untouched, translations: { fr: { description: 'Description maison' } } };
    expect(localizeCatalogItem(descriptionOnly, 'fr', defaults)).toMatchObject({ label: 'Élevée', description: 'Description maison' });
  });

  it('never mutates the raw item and keeps identity when nothing changes', () => {
    const raw = { code: 'x', label: 'Custom', translations: { fr: { label: 'Perso' } } };
    const frozen = JSON.stringify(raw);
    expect(localizeCatalogItem(raw, 'fr').label).toBe('Perso');
    expect(localizeCatalogItem(raw, 'en')).toBe(raw);
    expect(JSON.stringify(raw)).toBe(frozen);
    const list = [raw];
    expect(localizeCatalogList(list, 'en')).toBe(list);
    expect(localizeCatalogList(list, 'fr')).not.toBe(list);
  });

  it('shows a former shipped label in the locale, and keeps the current translation for the current source', () => {
    const withFormer: CatalogDefaults = {
      ...defaults,
      former: { high: [{ source: 'Critical', en: 'Critical', fr: 'Critique', de: 'Kritisch', es: 'Crítico' }] },
    };
    expect(localizeCatalogItem({ code: 'high', label: 'Critical' }, 'fr', withFormer).label).toBe('Critique');
    expect(localizeCatalogItem({ code: 'high', label: 'Critical' }, 'de', withFormer).label).toBe('Kritisch');
    expect(localizeCatalogItem({ code: 'high', label: 'High' }, 'fr', withFormer).label).toBe('Élevée');
    expect(localizeCatalogItem({ code: 'high', label: 'Tier 1' }, 'fr', withFormer).label).toBe('Tier 1');
    const translated = { code: 'high', label: 'Critical', translations: { fr: { label: 'Maison' } } };
    expect(localizeCatalogItem(translated, 'fr', withFormer).label).toBe('Maison');
  });

  it('previews what a field will display with a candidate translation set', () => {
    const item = { code: 'high', label: 'High', description: 'Up to one day.' };
    expect(previewCatalogField(item, 'fr', 'label', undefined, defaults)).toBe('Élevée');
    expect(previewCatalogField(item, 'fr', 'label', { fr: { label: 'Haute' } }, defaults)).toBe('Haute');
    expect(previewCatalogField(item, 'es', 'description', undefined, defaults)).toBe('Up to one day.');
    expect(toCatalogLocale('fr-FR')).toBe('fr');
    expect(toCatalogLocale('pt')).toBe('en');
  });
});
