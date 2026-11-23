import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { CsvCellError } from '../../common/csv/csv-field.types';
import { CsvImportService } from '../../common/csv/csv-import.service';
import { CsvJsonValidators } from '../../common/csv/csv-json-validators';
import { CsvResolverService } from '../../common/csv/csv-resolver.service';
import { backendPath } from '../../common/__tests__/backend-root';
import { incidentCsvConfig } from '../incident-csv.config';

/**
 * The six row errors of the incident import that used to carry an English message only.
 * A dry-run check of one file returns each of them with the code and the params its translation needs.
 * An out-of-range number (the shape of a reference, not a PostgreSQL integer) is pushed before the
 * cells are read and raised again while reading the ref cell: both carry the same code.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const READER = '44444444-4444-4444-4444-444444444444';
const OWNER = '55555555-5555-5555-5555-555555555555';

const hidden = {
  id: '22222222-2222-2222-2222-222222222222',
  tenant_id: TENANT,
  item_number: 12,
  title: 'Secret',
  confidential: true,
  reporter_user_id: OWNER,
  owner_user_id: OWNER,
  status: 'open',
};

const REFERENCE = 'Invalid reference "VALUE". Use the incident reference (INC-12), or leave the column empty to create a new incident.';
const referenceMessage = (value: string) => REFERENCE.replace('VALUE', value);

function file(content: string): Express.Multer.File {
  const text = `\uFEFF${content}`;
  return {
    buffer: Buffer.from(text, 'utf8'),
    originalname: 'incidents.csv',
    mimetype: 'text/csv',
    size: text.length,
  } as Express.Multer.File;
}

function manager() {
  return {
    query: async (sql: string, params: unknown[] = []) => {
      if (!sql.includes('FROM incidents')) return [];
      const wanted = params[1];
      const asksForHidden = Array.isArray(wanted) && wanted.some((value) => String(value) === '12');
      return asksForHidden ? [hidden] : [];
    },
  };
}

/** The sentence of `code` exists in the four languages and names the same placeholders. */
function assertPlaceholders(code: string, placeholders: string[]): void {
  const found = new Map<string, string[]>();
  for (const language of ['en', 'fr', 'de', 'es']) {
    const phrases = JSON.parse(fs.readFileSync(
      backendPath('..', 'frontend', 'src', 'locales', language, 'errors.json'),
      'utf8',
    )) as Record<string, unknown>;
    const text = phrases[code];
    assert.equal(typeof text, 'string', `${language} has ${code}`);
    const names = [...String(text).matchAll(/\{\{[a-zA-Z0-9_]+\}\}/g)].map((match) => match[0]).sort();
    found.set(language, names);
    assert.deepEqual(names, [...placeholders].sort(), `${language} ${code}`);
  }
  assert.deepEqual(found.get('fr'), found.get('en'));
  assert.deepEqual(found.get('de'), found.get('en'));
  assert.deepEqual(found.get('es'), found.get('en'));
}

async function testDryRunCodesTheSixRowErrors(): Promise<void> {
  const csv = [
    'ref;title;severity;status;detected_at;category',
    'INC-abc;Bad reference;low;;;',
    'INC-2147483648;Bad number;low;;;',
    'INC-12;Hidden;low;;;',
    ';Bad date;low;;31/31/2026;',
    ';Bad severity;huge;;;',
    ';Bad category;low;;;nope',
  ].join('\n');
  const service = new CsvImportService(new CsvResolverService(), new CsvJsonValidators());
  const result = await service.import(incidentCsvConfig, file(csv), { dryRun: true, operation: 'upsert' }, {
    manager: manager() as any,
    tenantId: TENANT,
    userId: READER,
    isAdmin: false,
    itOpsSettings: { incidentCategories: [{ code: 'outage', label: 'Service outage' }] } as any,
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.ok, false);
  const brief = (error: { row: number; column?: string; code?: string; params?: Record<string, string | number>; message: string }) => ({
    row: error.row,
    column: error.column,
    code: error.code,
    params: error.params,
    message: error.message,
  });
  assert.deepEqual(result.errors.map(brief), [
    {
      row: 2,
      column: 'ref',
      code: 'CSV_INCIDENT_REFERENCE_INVALID',
      params: { value: 'INC-abc' },
      message: referenceMessage('INC-abc'),
    },
    {
      row: 3,
      column: 'ref',
      code: 'CSV_INCIDENT_REFERENCE_INVALID',
      params: { value: 'INC-2147483648' },
      message: referenceMessage('INC-2147483648'),
    },
    {
      row: 3,
      column: 'ref',
      code: 'CSV_INCIDENT_REFERENCE_INVALID',
      params: { value: 'INC-2147483648' },
      message: referenceMessage('INC-2147483648'),
    },
    {
      row: 4,
      column: 'ref',
      code: 'CSV_REFERENCE_NOT_FOUND',
      params: { value: 'INC-12' },
      message: 'Unknown incident reference(s): INC-12. Leave the ref column empty to create new incidents.',
    },
    {
      row: 5,
      column: 'detected_at',
      code: 'CSV_DATE_INVALID',
      params: { value: '31/31/2026' },
      message: 'Invalid date in detected_at: "31/31/2026". Use 2026-09-02, 2026-09-02T14:32:00Z or 02/09/2026 14:32.',
    },
    {
      row: 6,
      column: 'severity',
      code: 'CSV_ENUM_INVALID',
      params: { value: 'huge', allowed: 'critical, major, minor, low' },
      message: 'Invalid severity: "huge". Valid values: critical, major, minor, low',
    },
    {
      row: 7,
      column: 'category',
      code: 'CSV_ENUM_INVALID',
      params: { value: 'nope', allowed: 'Service outage' },
      message: '"Bad category": unknown category "nope". Use one of Service outage, or add it under IT settings first.',
    },
  ]);
}

/** Status goes through the same reader as severity. */
function testInvalidStatusCarriesTheEnumCode(): void {
  const status = incidentCsvConfig.fields.find((field) => field.csvColumn === 'status');
  assert.ok(status?.importTransformFn);
  assert.throws(
    () => status!.importTransformFn!('retired', {}, {} as any),
    (error: unknown) => {
      assert.ok(error instanceof CsvCellError);
      assert.equal(error.code, 'CSV_ENUM_INVALID');
      assert.deepEqual(error.params, {
        value: 'retired',
        allowed: 'open, in_progress, resolved, closed, cancelled',
      });
      assert.equal(error.message, 'Invalid status: "retired". Valid values: open, in_progress, resolved, closed, cancelled');
      return true;
    },
  );
}

function testCodesExistInEveryLanguage(): void {
  assertPlaceholders('CSV_INCIDENT_REFERENCE_INVALID', ['{{value}}']);
  assertPlaceholders('CSV_DATE_INVALID', ['{{value}}']);
  assertPlaceholders('CSV_ENUM_INVALID', ['{{value}}', '{{allowed}}']);
  assertPlaceholders('CSV_REFERENCE_NOT_FOUND', ['{{value}}']);
}

async function run(): Promise<void> {
  await testDryRunCodesTheSixRowErrors();
  testInvalidStatusCarriesTheEnumCode();
  testCodesExistInEveryLanguage();
  console.log('incident-csv-row-errors.spec.ts: ok');
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
