// @database-spec
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { CsvImportService } from '../../common/csv/csv-import.service';
import { CsvResolverService } from '../../common/csv/csv-resolver.service';
import { CsvJsonValidators } from '../../common/csv/csv-json-validators';
import type { CsvEntityConfig, CsvImportParams, CsvImportResult } from '../../common/csv';
import { portfolioProjectCsvConfig } from '../portfolio-project-csv.config';
import { portfolioRequestCsvConfig } from '../portfolio-request-csv.config';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';

// Lot I6 of 26.11.9, pass A (D21, T-I6c): the projects and requests imports under the one clearing
// rule. `-` on a project's origin is refused (it cannot be empty), a blank cell keeps it. The purpose
// and the risks live in bound documents, which the screen may empty: `-` empties them, and the check
// counts the document's text, not the column the documents replaced. `-` on the scoring gives `{}`.

const importer = new CsvImportService(new CsvResolverService(), new CsvJsonValidators());

async function run(runner: QueryRunner, tenantId: string, config: CsvEntityConfig, csv: string, params: Partial<CsvImportParams> = {}): Promise<CsvImportResult> {
  const content = '﻿' + csv;
  return importer.import(
    config,
    { buffer: Buffer.from(content, 'utf8'), originalname: 'portfolio.csv', mimetype: 'text/csv', size: content.length } as Express.Multer.File,
    { dryRun: false, operation: 'upsert', ...params },
    { manager: runner.manager, tenantId, userId: null, isAdmin: true },
  );
}

/** A document bound to a record's slot, with its text. */
async function bindDocument(runner: QueryRunner, tenantId: string, type: 'projects' | 'requests', id: string, slot: string, text: string) {
  const [library] = await runner.query(
    `INSERT INTO document_libraries (tenant_id, name, slug) VALUES ($1, $2, $2) RETURNING id`, [tenantId, `lib-${randomUUID().slice(0, 8)}`],
  );
  const [document] = await runner.query(
    `INSERT INTO documents (tenant_id, item_number, title, content_markdown, library_id)
     VALUES ($1, (SELECT coalesce(max(item_number), 0) + 1 FROM documents WHERE tenant_id = $1), $2, $3, $4) RETURNING id`,
    [tenantId, `${slot} of ${id}`, text, library.id],
  );
  await runner.query(
    `INSERT INTO integrated_document_bindings (tenant_id, source_entity_type, source_entity_id, slot_key, document_id) VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, type, id, slot, document.id],
  );
}

const codes = (result: CsvImportResult) => result.errors.map((error) => [error.row, error.column, error.code]);

/** A project's origin: `-` is refused, a blank cell keeps it; on a new project `-` reads as blank. */
async function testProjectOrigin() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'i6a-origin');
    const id = randomUUID();
    await runner.query(
      `INSERT INTO portfolio_projects (id, tenant_id, item_number, name, status, origin, execution_progress) VALUES ($1, $2, 100, 'Cloud move', 'in_progress', 'fast_track', 0)`,
      [id, tenantId],
    );
    const check = await run(runner, tenantId, portfolioProjectCsvConfig, 'name;origin\nCloud move;-', { dryRun: true });
    assert.deepEqual(codes(check), [[2, 'origin', 'CSV_VALUE_CANNOT_BE_CLEARED']], 'the check refuses `-` on the origin');
    const load = await run(runner, tenantId, portfolioProjectCsvConfig, 'name;origin\nCloud move;-');
    assert.deepEqual(codes(load), [[2, 'origin', 'CSV_VALUE_CANNOT_BE_CLEARED']]);
    const kept = await run(runner, tenantId, portfolioProjectCsvConfig, 'name;origin;status\nCloud move;;done');
    assert.equal(kept.ok, true, JSON.stringify(kept.errors));
    const [stored] = await runner.query(`SELECT origin, status FROM portfolio_projects WHERE id = $1`, [id]);
    assert.deepEqual(stored, { origin: 'fast_track', status: 'done' }, 'a blank cell keeps the origin');
    const created = await run(runner, tenantId, portfolioProjectCsvConfig, 'name;origin;status\nShop tills;-;planned');
    assert.equal(created.ok, true, JSON.stringify(created.errors));
    const [fresh] = await runner.query(`SELECT origin FROM portfolio_projects WHERE tenant_id = $1 AND name = 'Shop tills'`, [tenantId]);
    assert.equal(fresh.origin, 'legacy', 'a new project: `-` reads as blank, the origin is legacy');
  });
}

/** The purpose and the risks: `-` empties them, counted by the text of their documents. */
async function testDocumentSlots() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'i6a-slots');
    const requestId = randomUUID();
    const projectId = randomUUID();
    const oldId = randomUUID();
    // The columns the documents replaced: empty, or holding an old text.
    await runner.query(
      `INSERT INTO portfolio_requests (id, tenant_id, item_number, name, status, purpose, risks)
       VALUES ($1, $2, 1, 'New CRM', 'pending_review', NULL, NULL), ($3, $2, 2, 'Old CRM', 'pending_review', 'old text', 'old text')`,
      [requestId, tenantId, oldId],
    );
    await runner.query(
      `INSERT INTO portfolio_projects (id, tenant_id, item_number, name, status, origin, execution_progress, purpose) VALUES ($1, $2, 100, 'Cloud move', 'in_progress', 'legacy', 0, NULL)`,
      [projectId, tenantId],
    );
    await bindDocument(runner, tenantId, 'requests', requestId, 'purpose', 'Replace the spreadsheets');
    await bindDocument(runner, tenantId, 'requests', requestId, 'risks_mitigations', 'Vendor lock-in');
    await bindDocument(runner, tenantId, 'requests', oldId, 'purpose', 'Keep the old CRM');
    await bindDocument(runner, tenantId, 'requests', oldId, 'risks_mitigations', '');
    await bindDocument(runner, tenantId, 'projects', projectId, 'purpose', 'Leave the data centre');

    let check = await run(runner, tenantId, portfolioRequestCsvConfig, 'name;purpose;risks\nNew CRM;-;-', { dryRun: true });
    assert.equal(check.ok, true, JSON.stringify(check.errors));
    assert.deepEqual([check.updated, check.cleared], [1, 2], 'both documents held a text');

    check = await run(runner, tenantId, portfolioRequestCsvConfig, 'name;purpose;risks\nNew CRM;;\nOld CRM;;', { dryRun: true });
    assert.deepEqual([check.unchanged, check.cleared], [2, 0], 'blank cells keep the documents, whatever the old columns hold');
    check = await run(runner, tenantId, portfolioRequestCsvConfig, 'name;current_situation\nNew CRM;', { dryRun: true });
    assert.deepEqual([check.unchanged, check.cleared], [1, 0], 'a file without the columns keeps the documents');
    check = await run(runner, tenantId, portfolioRequestCsvConfig, 'name;purpose;risks\nOld CRM;Keep the old CRM;-', { dryRun: true });
    assert.deepEqual([check.unchanged, check.cleared], [1, 0], 'an empty risks document has nothing to clear');

    check = await run(runner, tenantId, portfolioProjectCsvConfig, 'name;purpose\nCloud move;-', { dryRun: true });
    assert.equal(check.ok, true, JSON.stringify(check.errors));
    assert.deepEqual([check.updated, check.cleared], [1, 1], 'the project purpose');
    const load = await run(runner, tenantId, portfolioProjectCsvConfig, 'name;purpose\nCloud move;-');
    assert.deepEqual([load.ok, load.cleared], [true, 1]);
  });
}

/** `-` on the scoring of a request gives `{}`, counted once. */
async function testCriteriaValues() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'i6a-criteria');
    const requestId = randomUUID();
    await runner.query(
      `INSERT INTO portfolio_requests (id, tenant_id, item_number, name, status, criteria_values) VALUES ($1, $2, 1, 'New CRM', 'pending_review', '{"a": "b"}'::jsonb)`,
      [requestId, tenantId],
    );
    const check = await run(runner, tenantId, portfolioRequestCsvConfig, 'name;criteria_values\nNew CRM;-', { dryRun: true });
    assert.deepEqual([check.ok, check.cleared], [true, 1]);
    const load = await run(runner, tenantId, portfolioRequestCsvConfig, 'name;criteria_values\nNew CRM;-');
    assert.equal(load.ok, true, JSON.stringify(load.errors));
    const [stored] = await runner.query(`SELECT criteria_values FROM portfolio_requests WHERE id = $1`, [requestId]);
    assert.deepEqual(stored.criteria_values, {});
  });
}

/**
 * The scoring of a project as on a request (lot I6 of 26.11.9, pass F): `-` on its criteria gives `{}`,
 * counted once; `-` on its priority override is refused, as the screen cannot empty it. On a new
 * project `-` reads as a blank cell.
 */
async function testProjectScoring() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'i6f-scoring');
    const id = randomUUID();
    await runner.query(
      `INSERT INTO portfolio_projects (id, tenant_id, item_number, name, status, origin, execution_progress, priority_override, criteria_values)
       VALUES ($1, $2, 100, 'Cloud move', 'in_progress', 'fast_track', 0, true, '{"a": "b"}'::jsonb)`,
      [id, tenantId],
    );
    const check = await run(runner, tenantId, portfolioProjectCsvConfig, 'name;criteria_values\nCloud move;-', { dryRun: true });
    assert.deepEqual([check.ok, check.updated, check.cleared], [true, 1, 1], JSON.stringify(check.errors));
    const load = await run(runner, tenantId, portfolioProjectCsvConfig, 'name;criteria_values\nCloud move;-');
    assert.deepEqual([load.ok, load.cleared], [true, 1], JSON.stringify(load.errors));
    const [stored] = await runner.query(`SELECT criteria_values, priority_override FROM portfolio_projects WHERE id = $1`, [id]);
    assert.deepEqual([stored.criteria_values, stored.priority_override], [{}, true]);
    const again = await run(runner, tenantId, portfolioProjectCsvConfig, 'name;criteria_values\nCloud move;-', { dryRun: true });
    assert.deepEqual([again.ok, again.cleared], [true, 0], 'empty criteria have nothing to clear');
    for (const dryRun of [true, false]) {
      const refused = await run(runner, tenantId, portfolioProjectCsvConfig, 'name;priority_override\nCloud move;-', { dryRun });
      assert.deepEqual(codes(refused), [[2, 'priority_override', 'CSV_VALUE_CANNOT_BE_CLEARED']], 'the override cannot be cleared');
    }
    const created = await run(runner, tenantId, portfolioProjectCsvConfig, 'name;priority_override;criteria_values\nNew site;-;-');
    assert.deepEqual([created.ok, created.inserted], [true, 1], JSON.stringify(created.errors));
  });
}

runSpecs('portfolio-csv-clearing-rule.integration.spec', [
  ['project origin', testProjectOrigin],
  ['document slots', testDocumentSlots],
  ['criteria values', testCriteriaValues],
  ['project scoring', testProjectScoring],
]).catch((error) => {
  console.error(error);
  process.exit(1);
});
