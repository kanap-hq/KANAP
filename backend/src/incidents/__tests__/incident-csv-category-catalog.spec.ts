import * as assert from 'node:assert/strict';
import { CsvImportService } from '../../common/csv/csv-import.service';
import { CsvJsonValidators } from '../../common/csv/csv-json-validators';
import { CsvResolverService } from '../../common/csv/csv-resolver.service';
import { incidentCsvConfig } from '../incident-csv.config';

/**
 * Lot K2c of 26.12.1, third pass: rule P7 (maintainer, 2026-11-23) on the category of the incident
 * import. A row that puts a retired category on a new incident, or on an incident that does not
 * hold it, is refused with its coded message and the categories allowed; a row that repeats the
 * retired category its incident already holds passes.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const ADMIN = '44444444-4444-4444-4444-444444444444';

const stored = (id: string, itemNumber: number, category: string) => ({
  id,
  tenant_id: TENANT,
  item_number: itemNumber,
  title: `Incident ${itemNumber}`,
  category,
  severity: 'minor',
  status: 'open',
  confidential: false,
  reporter_user_id: ADMIN,
  owner_user_id: null,
  detected_at: new Date('2026-11-01T09:00:00Z'),
});

const INCIDENTS = [
  stored('22222222-2222-4222-8222-222222222222', 12, 'legacy'),
  stored('33333333-3333-4333-8333-333333333333', 13, 'outage'),
];

function file(content: string): Express.Multer.File {
  const text = `﻿${content}`;
  return { buffer: Buffer.from(text, 'utf8'), originalname: 'incidents.csv', mimetype: 'text/csv', size: text.length } as Express.Multer.File;
}

function manager() {
  return {
    query: async (sql: string, params: unknown[] = []) => {
      if (!sql.includes('FROM incidents')) return [];
      const wanted = Array.isArray(params[1]) ? (params[1] as unknown[]).map(String) : [];
      return INCIDENTS.filter((incident) => wanted.includes(String(incident.item_number)));
    },
  };
}

async function testRetiredCategory(): Promise<void> {
  const csv = [
    'ref;title;severity;status;detected_at;category',
    ';New one;minor;;;Legacy outage',
    'INC-12;Incident 12;minor;;;Legacy outage',
    'INC-13;Incident 13;minor;;;legacy',
  ].join('\n');
  const service = new CsvImportService(new CsvResolverService(), new CsvJsonValidators());
  const result = await service.import(incidentCsvConfig, file(csv), { dryRun: true, operation: 'upsert' }, {
    manager: manager() as any,
    tenantId: TENANT,
    userId: ADMIN,
    isAdmin: true,
    itOpsSettings: {
      incidentCategories: [
        { code: 'outage', label: 'Service outage' },
        { code: 'legacy', label: 'Legacy outage', deprecated: true },
      ],
    } as any,
  });
  const category = result.errors.filter((error: any) => error.column === 'category');
  assert.deepEqual(category.map((error: any) => [error.row, error.code, error.params]), [
    // The refused value by its catalog name, also when the cell gives its code, with its code and list.
    [2, 'catalog_value_retired', { value: 'Legacy outage', allowed: 'outage (Service outage)', valueCode: 'legacy', list: 'incidentCategories' }],
    [4, 'catalog_value_retired', { value: 'Legacy outage', allowed: 'outage (Service outage)', valueCode: 'legacy', list: 'incidentCategories' }],
  ], 'the new incident and INC-13 are refused; INC-12, which holds it, passes');
  assert.deepEqual(result.errors.filter((error: any) => error.row === 3), [], 'INC-12 repeats what it holds: no error');
}

testRetiredCategory().then(
  () => console.log('incident-csv-category-catalog.spec: ok'),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
