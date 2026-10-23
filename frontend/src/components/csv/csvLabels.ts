import type { TFunction } from 'i18next';
import type { CsvFieldInfo, CsvExportPreset } from './csv.types';

/** The entity key of a list endpoint, for the labels of its fields: `/applications` gives `applications`. */
export function csvEntityOf(endpoint: string): string {
  return String(endpoint ?? '').split('?')[0].split('/').filter(Boolean).join('_');
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** The text of a key, or `fallback` when the language has no entry (the key itself comes back). */
function translated(t: TFunction, key: string, fallback: string): string {
  const text = String(t(key, { defaultValue: fallback }));
  return text === key ? fallback : text;
}

/**
 * The label of an export field in the screen language: `csv.fields.<entity>.<column>` in the
 * common namespace, else the server's label without its `(… __CLEAR__ …)` hint, else the column.
 */
export function csvFieldLabel(t: TFunction, entity: string, field: Pick<CsvFieldInfo, 'csvColumn' | 'label'>): string {
  const plain = String(field.label ?? '').replace(/\s*\([^)]*__CLEAR__[^)]*\)/g, '').trim() || field.csvColumn;
  return entity ? translated(t, `csv.fields.${entity}.${field.csvColumn}`, plain) : plain;
}

/** The label of a field group (`Identity`, `Overview`...) in the screen language; the server's name when unknown. */
export function csvGroupLabel(t: TFunction, group: string): string {
  const key = slug(group);
  return key ? translated(t, `csv.groups.${key}`, group) : group;
}

/** The label of an export preset of an entity in the screen language; the given label when unknown. */
export function csvPresetLabel(t: TFunction, entity: string, preset: Pick<CsvExportPreset, 'name' | 'label'>): string {
  return entity ? translated(t, `csv.presets.${entity}.${preset.name}`, preset.label) : preset.label;
}
