import i18next, { type TFunction } from 'i18next';
import { catalogValueName } from './catalogValueName';

/**
 * An import report message (`csvMessageText`) whose refused retired catalog value
 * (`catalog_value_retired`) is named as the field's selector names it, in the language of `t`; the
 * values allowed stay in the sentence. Every display of an import report (the import dialog of the
 * screens, the import card of Kad) passes its messages through here.
 */
export function withCatalogValueName<T extends { code?: string; params?: Record<string, string | number> }>(item: T, t: TFunction): T {
  if (item.code !== 'catalog_value_retired' || !item.params) return item;
  const language = (t as { lng?: string }).lng || i18next.resolvedLanguage || i18next.language || 'en';
  const name = catalogValueName(item.params, language);
  return name ? { ...item, params: { ...item.params, value: name } } : item;
}
