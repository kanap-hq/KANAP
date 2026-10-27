import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import type { CsvLanguage } from '../../csv-sheet/types';
import { backendPath } from '../../__tests__/backend-root';

const LANGUAGES: CsvLanguage[] = ['en', 'fr', 'de', 'es'];

/**
 * A report export's label table against the screen's words: each label must equal the value of its key
 * in `frontend/src/locales/<lang>/<namespace>.json`, in the four languages. When the screen's wording
 * changes, the spec fails until the backend table is copied again. CI runs the backend suite when these
 * locale files change (`.github/scripts/ci-changes.sh`).
 */
export function assertLocaleLabels<K extends string>(
  namespace: string,
  keys: Record<K, string>,
  /** May hold more labels than `keys` (words only the file has): those are not checked. */
  labels: Record<CsvLanguage, Record<string, string>>,
): void {
  for (const language of LANGUAGES) {
    const file = backendPath('..', 'frontend', 'src', 'locales', language, `${namespace}.json`);
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const [name, key] of Object.entries(keys) as Array<[K, string]>) {
      const value = key.split('.').reduce<any>((node, part) => (node == null ? undefined : node[part]), json);
      assert.equal(labels[language][name as string], value, `${language}/${namespace}.json ${key} (label ${name})`);
    }
  }
}
