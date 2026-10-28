import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { backendPath } from '../../common/__tests__/backend-root';
import { HISTORY_FIELDS } from '../record-history.service';

// The localization of the history's allow-list: every field the service may present has a label in
// the four languages (`auditLogs.fields.*`). A new shown field fails here until it is translated;
// the frontend `recordHistoryLocales` and `auditLogValues` tests cover the enumeration values.
// This spec reads files outside `backend/` (the frontend locale files), so `ci-changes.sh` runs the
// backend suite when `frontend/src/locales/*/admin.json` changes.

const LANGUAGES = ['en', 'fr', 'de', 'es'] as const;
const LOCALES = path.join(backendPath(), '..', 'frontend', 'src', 'locales');

type Catalog = Record<string, unknown>;

function admin(language: string): Catalog {
  return JSON.parse(fs.readFileSync(path.join(LOCALES, language, 'admin.json'), 'utf8')) as Catalog;
}

function auditFieldsOf(tree: Catalog): Record<string, string> {
  const auditLogs = tree.auditLogs as Catalog | undefined;
  const fields = auditLogs?.fields as Record<string, string> | undefined;
  assert.ok(fields, 'auditLogs.fields exists');
  return fields;
}

function shownFields(): string[] {
  const fields = new Set<string>();
  for (const catalog of Object.values(HISTORY_FIELDS)) {
    for (const [field, rule] of Object.entries(catalog)) {
      if (!rule.hidden) fields.add(field);
    }
  }
  return Array.from(fields).sort();
}

function run() {
  const missing: string[] = [];
  for (const language of LANGUAGES) {
    const labels = auditFieldsOf(admin(language));
    for (const field of shownFields()) {
      const label = labels[field];
      if (typeof label !== 'string' || label.trim() === '') missing.push(`${language}: ${field}`);
    }
  }
  assert.deepEqual(missing, [], `shown history fields without a label in the four languages: ${missing.join(', ')}`);
  console.log(`  ${shownFields().length} shown fields labelled in ${LANGUAGES.length} languages: OK`);
  console.log('record-history-localization.spec: ok');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
