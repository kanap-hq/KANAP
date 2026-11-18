/**
 * Lists written in numbered columns (`business_owner_email_1`, `_2`, ...: lot I6 of 26.11.9, pass E). A
 * filled list replaces the stored one (D21), so a file must hold the whole list: the export writes as
 * many columns as the longest list of its rows, the declared ones at least (a template keeps the
 * declared ones), and the import reads every numbered column a file holds, by its technical name or by
 * its title in any language (the title of the list's first column, its number changed).
 *
 * The lists: a config's own (`numberedLists`, columns declared with an `exportFn`) and its fields in
 * numbered columns (`ArrayStrategy.NUMBERED_COLUMNS`, `maxItems` declared).
 */
import { looseKey } from '../csv-sheet/text';
import type { CsvLanguage } from '../csv-sheet/types';
import { ArrayStrategy, CsvEntityConfig, CsvFieldType } from './csv-field.types';

/** The number of a list's first column in its title: the standalone 1 of `Business owner 1 email`. */
const FIRST_NUMBER = /(?<!\d)1(?!\d)/;

const headerKey = (value: string) => looseKey(value).normalize('NFC');
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The bases of a config's numbered lists (`business_owner_email`). */
export function numberedListBases(config: CsvEntityConfig): string[] {
  const bases = new Set((config.numberedLists ?? []).map((list) => list.base));
  for (const field of config.fields) {
    if (field.type === CsvFieldType.ARRAY && field.arrayStrategy === ArrayStrategy.NUMBERED_COLUMNS) {
      bases.add(field.csvColumn.replace(/_\d+$/, ''));
    }
  }
  return [...bases];
}

/** Whether `column` is a numbered column of the list `base` (`<base>_<n>`). */
export function isNumberedColumn(column: string, base: string): boolean {
  return new RegExp(`^${escape(base)}_[1-9]\\d*$`).test(column);
}

/** The numbered columns of the list `base` a row holds, in the order of their numbers. */
export function numberedColumns(raw: Record<string, string>, base: string): string[] {
  const number = (column: string) => Number(column.slice(base.length + 1));
  return Object.keys(raw).filter((column) => isNumberedColumn(column, base)).sort((a, b) => number(a) - number(b));
}

/** The header of column `n` of a list in `language`: its first column's title, number changed; else `<base>_<n>`. */
export function numberedListHeader(config: CsvEntityConfig, base: string, n: number, language: CsvLanguage): string {
  const title = config.headerLabels?.[`${base}_1`]?.[language];
  return title && FIRST_NUMBER.test(title) ? title.replace(FIRST_NUMBER, String(n)) : `${base}_${n}`;
}

/** The numbered column a header names (`<base>_<n>`), by its technical name or a title; undefined for none. */
export function numberedListColumnOf(config: CsvEntityConfig, header: string): string | undefined {
  const key = headerKey(header);
  for (const base of numberedListBases(config)) {
    const forms = [`${base}_1`, ...Object.values(config.headerLabels?.[`${base}_1`] ?? {})];
    for (const form of forms) {
      const at = form ? form.search(FIRST_NUMBER) : -1;
      if (at < 0) continue;
      const pattern = new RegExp(`^${escape(headerKey(form.slice(0, at)))}(\\d+)${escape(headerKey(form.slice(at + 1)))}$`);
      const n = Number(key.match(pattern)?.[1] ?? 0);
      if (n >= 1) return `${base}_${n}`;
    }
  }
  return undefined;
}
