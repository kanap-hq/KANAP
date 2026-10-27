import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { backendPath } from '../../__tests__/backend-root';
import { CsvExportService } from '../csv-export.service';
import { CsvResolverService } from '../csv-resolver.service';
import { ArrayStrategy, CsvEntityConfig, CsvFieldDefinition, CsvFieldType } from '../csv-field.types';
import type { CsvLanguage } from '../../csv-sheet/types';
import { applicationCsvConfig } from '../../../applications/application-csv.config';
import { assetCsvConfig } from '../../../assets/asset-csv.config';
import { incidentCsvConfig } from '../../../incidents/incident-csv.config';
import { portfolioProjectCsvConfig } from '../../../portfolio/portfolio-project-csv.config';
import { portfolioRequestCsvConfig } from '../../../portfolio/portfolio-request-csv.config';
import { taskCsvConfig } from '../../../tasks/task-csv.config';
import { VULNERABILITY_CSV_PROPERTY } from '../../../vulnerabilities/vulnerability-list-column';

// The CSV of the six lists exported through the field engine (applications, assets, incidents,
// projects, requests, tasks), byte for byte, from a fixed seed: every exportable column of each
// config, in English and in French. The files in `golden/` were written by the engine before the
// Excel export (lot 3), then rewritten once on purpose when the lists gained their business reference
// after `id` and the workspace's column order (lot 3, fixes); they must not change otherwise. `UPDATE_CSV_GOLDEN=1` rewrites them (never to make a
// failing run pass: a difference is a change of the CSV people already use).

const GOLDEN_DIR = backendPath('src', 'common', 'csv', '__tests__', 'golden');
const FK_ID = 'fk-1';

/** Every FK table answers one row, `fk-1`, whose lookup column reads `<table>.<column>`. */
function mockManager() {
  return {
    query: async (sql: string) => {
      const table = /FROM (\w+)/i.exec(sql)?.[1] ?? 'unknown';
      const row = new Proxy({} as Record<string, unknown>, {
        get: (_target, prop) => (prop === 'id' ? FK_ID : `${table}.${String(prop)}`),
      });
      return [row];
    },
  } as any;
}

const TEXTS = ['Plain name', '=HYPERLINK("http://x")', 'Line; "quoted"\nsecond line', '-12'];
const NUMBERS: unknown[] = ['12.50', 3, null, '-7.25'];
// A Date as node-postgres reads a `date` column: local midnight, its day in the server's zone.
const DATES: unknown[] = ['2026-03-01', new Date(2026, 9, 27), null, '2026-02-30'];
const BOOLEANS: unknown[] = [true, false, null, true];
const ARRAYS: unknown[] = [['alpha', 'beta'], [], null, ['+cmd']];

function seedValue(field: CsvFieldDefinition, index: number): unknown {
  switch (field.type) {
    case CsvFieldType.NUMBER:
      return NUMBERS[index];
    case CsvFieldType.DATE:
      return DATES[index];
    case CsvFieldType.BOOLEAN:
      return BOOLEANS[index];
    case CsvFieldType.ARRAY:
      if (field.arrayStrategy === ArrayStrategy.NUMBERED_COLUMNS) return field.fkEntity ? [FK_ID, 'missing'] : ['one', '@two'];
      return ARRAYS[index];
    case CsvFieldType.FK_BY_EMAIL:
    case CsvFieldType.FK_BY_NAME:
    case CsvFieldType.FK_BY_CODE:
      return index === 2 ? null : FK_ID;
    case CsvFieldType.JSON:
      return index === 2 ? null : { score: index, note: 'a;b' };
    case CsvFieldType.ENUM:
      return field.enumValues?.length ? field.enumValues[index % field.enumValues.length] : TEXTS[index];
    default:
      return field.enumValues?.length ? field.enumValues[index % field.enumValues.length] : TEXTS[index];
  }
}

/** Rows filling every exportable column, then what the module services attach before the export. */
function seedRows(config: CsvEntityConfig, extra: (index: number) => Record<string, unknown>): Record<string, unknown>[] {
  return [0, 1, 2, 3].map((index) => {
    const row: Record<string, unknown> = { id: `row-${index + 1}` };
    for (const field of config.fields) {
      if (field.exportable === false || field.arrayIndex) continue;
      if (Object.prototype.hasOwnProperty.call(row, field.entityProperty)) continue;
      if (field.nestedPath) continue;
      row[field.entityProperty] = seedValue(field, index);
    }
    return { ...row, ...extra(index) };
  });
}

const vulnerabilityCounts = (index: number) => ({
  [VULNERABILITY_CSV_PROPERTY]: index === 2
    ? { vulnerabilities_to_review: null, vulnerabilities_severe: null }
    : { vulnerabilities_to_review: index * 3, vulnerabilities_severe: index },
});


export interface GoldenCase {
  name: string;
  config: CsvEntityConfig;
  rows: Record<string, unknown>[];
  timeZone?: string;
}

export function goldenCases(): GoldenCase[] {
  const applications = applicationCsvConfig;
  const assets = assetCsvConfig;
  return [
    {
      name: 'applications',
      config: applications,
      rows: seedRows(applications, (index) => ({
        _owners: index === 2 ? [] : [
          { owner_type: 'business', user: { email: 'ada@example.test' } },
          { owner_type: 'it', user: { email: '=it@example.test' } },
        ],
        _dataResidency: index === 2 ? [] : [{ country_iso: 'FR' }, { country_iso: 'DE' }],
        sequential_id: index === 2 ? null : `APP-${index + 1}`,
        status: ['enabled', 'disabled', 'enabled', 'enabled'][index],
        ...vulnerabilityCounts(index),
      })),
    },
    {
      name: 'assets',
      config: assets,
      rows: seedRows(assets, (index) => ({
        asset_reference: index === 2 ? null : `AST-${index + 1}`,
        ip_addresses: index === 2 ? [] : [
          { type: 'Management', ip: '10.0.0.1', subnet_cidr: '10.0.0.0/24' },
          { type: 'Production', ip: '10.0.1.1', subnet_cidr: null },
        ],
        ...vulnerabilityCounts(index),
      })),
    },
    {
      name: 'incidents',
      config: incidentCsvConfig,
      timeZone: 'Europe/Paris',
      rows: seedRows(incidentCsvConfig, (index) => ({
        item_number: `INC-${index + 1}`,
        started_at: index === 2 ? null : '2026-10-16T08:38:00Z',
        detected_at: '2026-03-29T00:30:15Z',
        resolved_at: null,
        closed_at: index === 1 ? '2026-12-31T23:59:00Z' : null,
        authority_notified_at: null,
        severity: ['low', 'medium', 'high', 'critical'][index],
        status: ['open', 'investigating', 'resolved', 'closed'][index],
        review: index === 0 ? '# Review\n- 300 mailboxes' : '',
      })),
    },
    {
      name: 'projects',
      config: portfolioProjectCsvConfig,
      rows: seedRows(portfolioProjectCsvConfig, (index) => ({
        item_number: index === 2 ? null : index + 1,
        actual_effort_it: index === 2 ? null : 10.6,
        actual_effort_business: index === 2 ? null : '4.4',
        purpose: index === 0 ? 'Purpose **bold**' : '',
      })),
    },
    {
      name: 'requests',
      config: portfolioRequestCsvConfig,
      rows: seedRows(portfolioRequestCsvConfig, (index) => ({
        item_number: index === 2 ? null : index + 1,
        purpose: index === 0 ? 'Purpose' : '',
        risks: index === 1 ? '=risk' : '',
      })),
    },
    {
      name: 'tasks',
      config: taskCsvConfig,
      rows: seedRows(taskCsvConfig, (index) => ({
        item_number: index === 2 ? null : index + 1,
        _relatedObjectName: index === 2 ? '' : 'Related project',
      })),
    },
  ];
}

export async function goldenFile(service: CsvExportService, golden: GoldenCase, language: CsvLanguage): Promise<string> {
  const result = await service.export(golden.config, golden.rows, {
    manager: mockManager(),
    tenantId: 'tenant-1',
    language,
    timeZone: golden.timeZone,
  });
  assert.equal(typeof result.content, 'string');
  return result.content as string;
}

export { mockManager as goldenManager };

async function run() {
  const service = new CsvExportService(new CsvResolverService());
  const update = process.env.UPDATE_CSV_GOLDEN === '1';
  if (update) fs.mkdirSync(GOLDEN_DIR, { recursive: true });
  for (const golden of goldenCases()) {
    for (const language of ['en', 'fr'] as const) {
      const file = await goldenFile(service, golden, language);
      const path = `${GOLDEN_DIR}/${golden.name}.${language}.csv`;
      if (update) {
        fs.writeFileSync(path, file, 'utf8');
        continue;
      }
      const expected = fs.readFileSync(path, 'utf8');
      assert.equal(file, expected, `${golden.name} (${language}): the CSV differs from golden/${golden.name}.${language}.csv`);
    }
  }
  console.log(`csv-export-golden.spec: ${update ? 'golden files written' : 'the six lists write the same CSV, byte for byte'}`);
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
