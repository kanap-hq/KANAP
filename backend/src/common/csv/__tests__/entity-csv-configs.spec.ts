/**
 * Cross-cutting invariants over the REAL entity CSV configs (not synthetic ones).
 *
 * These lock the contract between export, template and import for every entity
 * on the config-driven CSV system, so config edits can't silently break the
 * round-trip (template -> import, export -> import).
 */
import * as assert from 'node:assert/strict';
import { CsvEntityConfig, CsvFieldType } from '../csv-field.types';
import { CsvResolverService } from '../csv-resolver.service';
import { assetCsvConfig } from '../../../assets/asset-csv.config';
import { applicationCsvConfig } from '../../../applications/application-csv.config';
import { taskCsvConfig } from '../../../tasks/task-csv.config';
import { portfolioProjectCsvConfig } from '../../../portfolio/portfolio-project-csv.config';
import { portfolioRequestCsvConfig } from '../../../portfolio/portfolio-request-csv.config';
import {
  hasPendingIncidentReview,
  incidentCsvConfig,
  takePendingIncidentReview,
} from '../../../incidents/incident-csv.config';

const configs: CsvEntityConfig[] = [
  assetCsvConfig,
  applicationCsvConfig,
  taskCsvConfig,
  portfolioProjectCsvConfig,
  portfolioRequestCsvConfig,
  incidentCsvConfig,
];

function field(config: CsvEntityConfig, csvColumn: string) {
  const found = config.fields.find((f) => f.csvColumn === csvColumn);
  assert.ok(found, `${config.entityName}: no field '${csvColumn}'`);
  return found!;
}

function transform(config: CsvEntityConfig, csvColumn: string, value: string): any {
  const f = field(config, csvColumn);
  assert.ok(f.importTransformFn, `${config.entityName}: field '${csvColumn}' has no importTransformFn`);
  return f.importTransformFn!(value, {}, {} as any);
}

function testUniqueCsvColumns() {
  for (const config of configs) {
    const seen = new Set<string>();
    for (const f of config.fields) {
      assert.ok(!seen.has(f.csvColumn), `${config.entityName}: duplicate csvColumn '${f.csvColumn}'`);
      seen.add(f.csvColumn);
    }
  }
}

function testRequiredFieldsAreImportable() {
  // Every required column must be importable, otherwise the template misses it
  // and imports can never satisfy the requirement.
  for (const config of configs) {
    for (const f of config.fields) {
      if (f.required) {
        assert.notEqual(f.importable, false,
          `${config.entityName}: required field '${f.csvColumn}' must be importable`);
      }
    }
  }
}

function testImportableComputedFieldsUseTempProperties() {
  // Importable COMPUTED fields parse to a raw string assigned to entityProperty.
  // If entityProperty is a real DB column, the raw string is written verbatim
  // (this corrupted tasks.viewer_ids/owner_ids). Such fields must target a
  // '_'-prefixed temp property handled + cleaned up in beforeCommit.
  for (const config of configs) {
    for (const f of config.fields) {
      if (f.type === CsvFieldType.COMPUTED && f.importable !== false) {
        assert.ok(f.entityProperty.startsWith('_'),
          `${config.entityName}: importable COMPUTED field '${f.csvColumn}' must map to a temp ` +
          `('_'-prefixed) entityProperty, not the real column '${f.entityProperty}'`);
      }
    }
  }
}

function testAssetStatusIsNotHardcodedEnum() {
  // asset.status is settings-backed (lifecycle_states, tenant-configurable):
  // a hard-coded ENUM gate rejects valid lifecycle codes (e.g. 'retired')
  // before beforeCommit can resolve them, breaking export -> import.
  const status = assetCsvConfig.fields.find((f) => f.csvColumn === 'status');
  assert.ok(status, 'asset config has a status field');
  assert.equal(status!.type, CsvFieldType.STRING,
    'asset.status must be STRING (settings-backed), not a hard-coded ENUM');
}

function testEnumFieldsHaveValues() {
  for (const config of configs) {
    for (const f of config.fields) {
      if (f.type === CsvFieldType.ENUM) {
        assert.ok(Array.isArray(f.enumValues) && f.enumValues.length > 0,
          `${config.entityName}: ENUM field '${f.csvColumn}' must declare enumValues`);
      }
    }
  }
}

function testFkEntitiesHaveResolvers() {
  const resolver = new CsvResolverService();
  const registry = (resolver as any).entityConfigs as Record<string, unknown>;
  for (const config of configs) {
    for (const f of config.fields) {
      if (f.fkEntity) {
        assert.ok(registry[f.fkEntity],
          `${config.entityName}: field '${f.csvColumn}' references unknown fkEntity '${f.fkEntity}'`);
      }
    }
  }
}

async function testTemplateHeadersRoundTripThroughImportValidation() {
  // The template exposes exactly the importable columns; import header
  // validation must accept every one of them and find all required columns.
  const { CsvExportService } = await import('../csv-export.service');
  const service = new CsvExportService(new CsvResolverService());
  for (const config of configs) {
    const result = await service.export(config, [], {
      manager: { query: async () => [] } as any,
      tenantId: 't1',
      scope: 'template',
    });
    const headerLine = result.content.replace(/^﻿/, '').split('\n')[0].trim();
    const headers = headerLine.split(';');
    const importable = new Set(
      config.fields.filter((f) => f.importable !== false).map((f) => f.csvColumn),
    );
    for (const h of headers) {
      assert.ok(importable.has(h),
        `${config.entityName}: template header '${h}' is not an importable column`);
    }
    for (const f of config.fields) {
      if (f.required) {
        assert.ok(headers.includes(f.csvColumn),
          `${config.entityName}: required column '${f.csvColumn}' missing from template`);
      }
    }
  }
}

async function testIncidentRefAndValueParsing() {
  // The ref column is the register's identity: identity resolution matches the
  // RAW cell against item_number, so beforeValidate has to strip the prefix.
  const rows = [
    { rowNumber: 2, raw: { ref: 'INC-12' }, parsed: {}, isInsert: true, errors: [], warnings: [] },
    { rowNumber: 3, raw: { ref: ' inc 7 ' }, parsed: {}, isInsert: true, errors: [], warnings: [] },
    { rowNumber: 4, raw: { ref: '' }, parsed: {}, isInsert: true, errors: [], warnings: [] },
  ];
  await incidentCsvConfig.beforeValidate!(rows as any, {
    tenantId: 'tenant-1',
    manager: { query: async () => [] },
    params: { dryRun: true, mode: 'replace', operation: 'upsert' },
    resolverCache: new Map(),
    userId: null,
    isAdmin: false,
    viewer: { userId: null, isAdmin: false },
  } as any);
  assert.equal(rows[0].raw.ref, '12', 'INC-12 must be stripped to the item number');
  assert.equal(rows[1].raw.ref, '7');
  assert.equal(rows[2].raw.ref, '', 'a blank ref stays blank (row is an insert)');

  assert.equal(transform(incidentCsvConfig, 'ref', 'INC-12'), 12);
  assert.equal(transform(incidentCsvConfig, 'ref', '12'), 12);
  assert.equal(transform(incidentCsvConfig, 'ref', '  '), null);
  assert.throws(() => transform(incidentCsvConfig, 'ref', 'INC-abc'), /Invalid reference/);

  // Severity/status accept the stored code and the label shown in the UI.
  assert.equal(transform(incidentCsvConfig, 'severity', 'Critical'), 'critical');
  assert.equal(transform(incidentCsvConfig, 'status', 'In progress'), 'in_progress');
  assert.equal(transform(incidentCsvConfig, 'status', 'in_progress'), 'in_progress');
  assert.throws(() => transform(incidentCsvConfig, 'severity', 'blocker'), /Invalid severity/);

  // Timestamps keep their time: ISO (what the export writes) and the European
  // format Excel produces must both round-trip.
  const iso = transform(incidentCsvConfig, 'detected_at', '2026-09-02T14:32:00Z') as Date;
  assert.equal(iso.toISOString(), '2026-09-02T14:32:00.000Z');
  const euro = transform(incidentCsvConfig, 'detected_at', '02/09/2026 14:32') as Date;
  assert.equal(euro.getFullYear(), 2026);
  assert.equal(euro.getMonth(), 8);
  assert.equal(euro.getDate(), 2);
  assert.equal(euro.getHours(), 14);
  assert.equal(euro.getMinutes(), 32);
  assert.throws(() => transform(incidentCsvConfig, 'detected_at', 'last tuesday'), /Invalid date/);
}

/**
 * The register's Record group: a short description plus the single `review`
 * column that replaced the four narrative columns
 * (planning/incident-review-document.md §3.8).
 */
async function testIncidentRecordColumns() {
  const recordColumns = incidentCsvConfig.fields
    .filter((f) => f.group === 'Record')
    .map((f) => f.csvColumn);
  assert.deepEqual(recordColumns, ['description', 'review']);

  for (const gone of ['impact', 'root_cause', 'corrective_actions', 'lessons_learned']) {
    assert.equal(
      incidentCsvConfig.fields.some((f) => f.csvColumn === gone || f.entityProperty === gone),
      false,
      `${gone} must no longer be a CSV column`,
    );
  }

  const review = field(incidentCsvConfig, 'review');
  assert.equal(review.label, 'Incident review');
  assert.equal(review.defaultExport, true);
  assert.notEqual(review.importable, false);
  assert.notEqual(review.exportable, false);

  // Markdown is validated at parse time, so a dry run reports a bad cell
  // without provisioning or writing anything.
  // The review is processed in the Markdown workers: the transform is asynchronous.
  assert.equal(await transform(incidentCsvConfig, 'review', '## Impact\n\nMail down'), '## Impact\n\nMail down');
  assert.equal(await transform(incidentCsvConfig, 'review', '   '), '');
  await assert.rejects(
    async () => transform(incidentCsvConfig, 'review', '<script>alert(1)</script>'),
    /must be Markdown/,
  );
}

async function testIncidentReviewIsVirtual() {
  const manager = {
    query: async (sql: string) => {
      if (/FROM tenants/.test(sql)) return [{ metadata: {} }];
      if (/item_sequences/.test(sql)) return [{ item_number: 9, first_number: 9 }];
      return [];
    },
  };
  const context = {
    tenantId: 't1',
    manager,
    params: { dryRun: false, mode: 'replace', operation: 'upsert' },
    resolverCache: new Map(),
    userId: 'u1',
    itOpsSettings: { incidentCategories: [] },
  } as any;

  const entity: any = {
    id: 'i9', item_number: 9, title: 'Outage', severity: 'major',
    status: 'open', detected_at: new Date(), review: '## Impact\n\nMail down',
  };
  await incidentCsvConfig.beforeCommit!([entity], context);
  assert.equal('review' in entity, false, 'the virtual column must never reach repo.save');
  assert.equal(hasPendingIncidentReview(entity), true);
  assert.equal(takePendingIncidentReview(entity), '## Impact\n\nMail down');
  assert.equal(hasPendingIncidentReview(entity), false, 'the pending body is consumed once');
}

async function testIncidentImportHooks() {
  const calls: Array<{ sql: string; params: any[] }> = [];
  const manager = {
    query: async (sql: string, params: any[]) => {
      calls.push({ sql, params });
      if (/FROM tenants/.test(sql)) {
        return [{ metadata: { it_ops: { incident_categories: [{ code: 'security', label: 'Security' }] } } }];
      }
      if (/item_sequences/.test(sql)) return [{ item_number: 7, first_number: 7 }];
      return [];
    },
  };
  // The effective catalog is preloaded by the CSV service; hooks never read tenant metadata themselves.
  const context = {
    tenantId: 't1',
    manager,
    params: { dryRun: false, mode: 'replace', operation: 'upsert' },
    resolverCache: new Map(),
    userId: 'u1',
    itOpsSettings: { incidentCategories: [{ code: 'security', label: 'Security' }] },
  } as any;

  const inserted: any = { title: 'Storage outage', category: 'Security', severity: 'critical' };
  const updated: any = { id: 'i1', item_number: 3, title: 'Known', severity: 'major', status: 'closed', detected_at: new Date() };
  await incidentCsvConfig.beforeCommit!([inserted, updated], context);

  assert.equal(inserted.category, 'security', 'category label must resolve to its code');
  assert.equal(inserted.item_number, 7, 'a blank ref gets its INC-N allocated');
  assert.equal(inserted.status, 'open');
  assert.ok(inserted.detected_at instanceof Date, 'detected_at defaults to now on insert');
  assert.equal(inserted.personal_data_affected, false);
  assert.equal(inserted.created_by, 'u1');
  assert.equal(updated.item_number, 3, 'an existing incident keeps its reference');
  assert.equal(updated.updated_by, 'u1');

  // Journal: one 'system' entry per imported incident, none for updates.
  inserted.id = 'new-1';
  await incidentCsvConfig.afterCommit!([inserted, updated], context);
  const journal = calls.filter((c) => /INSERT INTO incident_entries/.test(c.sql));
  assert.equal(journal.length, 1, 'exactly one journal insert');
  assert.deepEqual(journal[0].params[1], ['new-1'], 'only inserted rows get an entry');
  assert.equal(journal[0].params[0], 't1', 'journal entries carry the tenant');

  // Re-running afterCommit must not journal the same row twice.
  await incidentCsvConfig.afterCommit!([inserted, updated], context);
  assert.equal(calls.filter((c) => /INSERT INTO incident_entries/.test(c.sql)).length, 1);

  // A ref nobody matched is a typo, not a new incident.
  await assert.rejects(
    () => incidentCsvConfig.beforeCommit!([{ title: 'x', severity: 'low', item_number: 42 }], context),
    /INC-42/,
  );

  // Replace mode must not silently rewrite a NOT NULL column on an update.
  await assert.rejects(
    () => incidentCsvConfig.beforeCommit!([{ id: 'i2', item_number: 5, title: 'y', severity: 'low', status: null, detected_at: new Date() }], context),
    /cannot be cleared/,
  );
}

(async () => {
  testUniqueCsvColumns();
  testRequiredFieldsAreImportable();
  testImportableComputedFieldsUseTempProperties();
  testAssetStatusIsNotHardcodedEnum();
  testEnumFieldsHaveValues();
  testFkEntitiesHaveResolvers();
  await testTemplateHeadersRoundTripThroughImportValidation();
  await testIncidentRefAndValueParsing();
  await testIncidentRecordColumns();
  await testIncidentReviewIsVirtual();
  await testIncidentImportHooks();

  console.log('Entity CSV config invariant tests passed.');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
