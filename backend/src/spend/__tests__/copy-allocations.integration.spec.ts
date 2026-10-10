import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AllocationCalculatorService } from '../allocation-calculator.service';
import { SpendBudgetOperationsService } from '../spend-budget-operations.service';
import { CapexItemsService } from '../spend-items.service';
import {
  AUDIT_LABELS,
  assert,
  captureAudit,
  findVersion,
  inRolledBackTransaction,
  Kind,
  runSpecs,
  seedItem,
  seedTenant,
  seedVersion,
  setItemDates,
  underSavepoint,
} from './round-inputs.fixtures';

// Copy allocations from one year to the next, the same function for OPEX and
// CAPEX: manual methods copy their rows, automatic methods only take the
// method, the dry run writes nothing and lists what would happen, a line whose
// rules refuse it is an error in the dry run and fails the real copy, and the
// copy is all or nothing. Only the lines valid in the destination year are
// copied.

const YEAR = 2031;
const KINDS: Kind[] = ['opex', 'capex'];
// The lines of both natures are in the spend_* tables since lot Z1.
const T = {
  opex: { versions: 'spend_versions', allocations: 'spend_allocations' },
  capex: { versions: 'spend_versions', allocations: 'spend_allocations' },
} as const;

type Op = { sourceYear: number; destinationYear: number; overwrite?: boolean; dryRun?: boolean };

/** The real operation of each scope, through the service the route calls. */
function copyAllocations(kind: Kind, runner: QueryRunner, op: Op, audit = captureAudit()) {
  const operation = { overwrite: false, dryRun: false, ...op };
  if (kind === 'opex') {
    const calculator = new AllocationCalculatorService(undefined as any, undefined as any, undefined as any, undefined as any);
    return new SpendBudgetOperationsService(undefined as any, undefined as any, undefined as any, undefined as any, audit as any, undefined as any, calculator)
      .copyAllocations(operation, null, { manager: runner.manager });
  }
  // The CAPEX routes' service (the twin's constructor): it runs the same operations on the CAPEX lines.
  const calculator = new AllocationCalculatorService(undefined as any, undefined as any, undefined as any, undefined as any);
  const args: any[] = Array.from({ length: 11 }, () => undefined);
  args[3] = audit;
  args[4] = calculator;
  args[5] = new SpendBudgetOperationsService(undefined as any, undefined as any, undefined as any, undefined as any, audit as any, undefined as any, calculator);
  return (new (CapexItemsService as any)(...args) as CapexItemsService).copyAllocations(operation, null, { manager: runner.manager });
}

async function seedCompany(runner: QueryRunner, tenantId: string, name: string, headcountByYear: Record<number, number> = {}) {
  const [{ id }] = await runner.query(
    `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, $2, 'FR', 'Lyon') RETURNING id`,
    [tenantId, name],
  );
  for (const [year, headcount] of Object.entries(headcountByYear)) {
    await runner.query(
      `INSERT INTO company_metrics (tenant_id, company_id, fiscal_year, headcount) VALUES ($1, $2, $3, $4)`,
      [tenantId, id, Number(year), headcount],
    );
  }
  return id as string;
}

async function seedAllocatedVersion(
  runner: QueryRunner, kind: Kind, tenantId: string, itemId: string, year: number, method: string, rows: Array<[string, number]>,
) {
  const versionId = await seedVersion(runner, kind, tenantId, itemId, year, 'quarterly');
  await runner.query(`UPDATE ${T[kind].versions} SET allocation_method = $2, notes = 'Source notes' WHERE id = $1`, [versionId, method]);
  for (const [companyId, pct] of rows) {
    await runner.query(
      `INSERT INTO ${T[kind].allocations} (tenant_id, version_id, company_id, allocation_pct, is_system_generated) VALUES ($1, $2, $3, $4, false)`,
      [tenantId, versionId, companyId, pct],
    );
  }
  return versionId;
}

async function readVersion(runner: QueryRunner, kind: Kind, itemId: string, year: number) {
  const found = await findVersion(runner, kind, itemId, year);
  if (!found) return undefined;
  const [row] = await runner.query(
    `SELECT v.version_name, v.input_grain::text AS input_grain, v.allocation_method, v.notes,
            COALESCE((SELECT json_agg(json_build_array(a.company_id, a.allocation_pct::float8) ORDER BY a.allocation_pct DESC)
                      FROM ${T[kind].allocations} a WHERE a.version_id = v.id), '[]'::json) AS rows
     FROM ${T[kind].versions} v WHERE v.id = $1`,
    [found.id],
  );
  return row as { version_name: string; input_grain: string; allocation_method: string; notes: string | null; rows: Array<[string, number]> };
}

/** Manual rows are copied; missing source, empty manual source and a filled destination are skipped. */
async function testManualCopy(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-alloc-manual`);
    const north = await seedCompany(runner, tenantId, 'North');
    const south = await seedCompany(runner, tenantId, 'South');
    const manual = await seedItem(runner, kind, tenantId, 1, 'Manual');
    await seedAllocatedVersion(runner, kind, tenantId, manual, YEAR, 'manual_pct', [[north, 60], [south, 40]]);
    const noSource = await seedItem(runner, kind, tenantId, 2, 'No source');
    await seedVersion(runner, kind, tenantId, noSource, YEAR + 1);
    const emptyManual = await seedItem(runner, kind, tenantId, 3, 'Empty manual');
    await seedAllocatedVersion(runner, kind, tenantId, emptyManual, YEAR, 'manual_pct', []);
    const filled = await seedItem(runner, kind, tenantId, 4, 'Filled destination');
    await seedAllocatedVersion(runner, kind, tenantId, filled, YEAR, 'manual_pct', [[north, 100]]);
    await seedAllocatedVersion(runner, kind, tenantId, filled, YEAR + 1, 'manual_pct', [[south, 100]]);

    const preview = await copyAllocations(kind, runner, { sourceYear: YEAR, destinationYear: YEAR + 1, dryRun: true });
    const actions = Object.fromEntries(preview.results.map((r: any) => [r.itemName, [r.action, r.sourceAllocationsCount, r.destinationAllocationsCount]]));
    assert.deepEqual(actions, {
      Manual: ['copy', 2, 0],
      'No source': ['skip_missing_source_version', 0, 0],
      'Empty manual': ['skip_no_source_allocations', 0, 0],
      'Filled destination': ['skip_destination_has_data', 1, 1],
    }, `${kind}: dry run actions`);
    assert.deepEqual(preview.summary, { totalItems: 4, processed: 1, skipped: 3, errors: 0 }, `${kind}: dry run summary`);
    assert.equal(preview.success, true);
    assert.equal(await findVersion(runner, kind, manual, YEAR + 1), undefined, `${kind}: the dry run writes nothing`);

    const audit = captureAudit();
    const done = await copyAllocations(kind, runner, { sourceYear: YEAR, destinationYear: YEAR + 1 }, audit);
    assert.deepEqual([done.success, done.summary.processed, done.summary.skipped, done.results], [true, 1, 3, []], `${kind}: copy summary`);
    assert.deepEqual(await readVersion(runner, kind, manual, YEAR + 1), {
      version_name: `Y${YEAR + 1}`,
      input_grain: 'quarterly',
      allocation_method: 'manual_pct',
      notes: 'Source notes',
      rows: [[north, 60], [south, 40]],
    }, `${kind}: destination version created from the source, rows copied`);
    assert.deepEqual((await readVersion(runner, kind, filled, YEAR + 1))!.rows, [[south, 100]], `${kind}: a filled destination is kept`);
    assert.deepEqual(
      audit.entries.map((e) => `${e.table}:${e.action}`).sort(),
      [`${AUDIT_LABELS[kind].allocations}:update`, `${AUDIT_LABELS[kind].versions}:create`],
      `${kind}: the version and its allocations are audited`,
    );
    // The created version is audited in its nature's shape: a CAPEX version names its line capex_item_id.
    const created = audit.entries.find((e) => e.table === AUDIT_LABELS[kind].versions && e.action === 'create')!.after;
    const lineKey = kind === 'capex' ? 'capex_item_id' : 'spend_item_id';
    assert.deepEqual([created[lineKey], kind === 'capex' ? 'spend_item_id' in created : 'capex_item_id' in created], [manual, false], `${kind}: the version's line as ${lineKey}`);

    await copyAllocations(kind, runner, { sourceYear: YEAR, destinationYear: YEAR + 1, overwrite: true });
    assert.deepEqual((await readVersion(runner, kind, filled, YEAR + 1))!.rows, [[north, 100]], `${kind}: overwrite replaces the destination rows`);
  });
}

/**
 * A destination still holding rows an older automatic method stored
 * (is_system_generated) takes a manual split: every row of the version is
 * replaced, so a system row for a company of the split does not hit the
 * unique key (version, company, department) of migration 1853730000000.
 */
async function testManualCopyOverSystemRows(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-alloc-system`);
    const north = await seedCompany(runner, tenantId, 'North');
    const south = await seedCompany(runner, tenantId, 'South');
    const itemId = await seedItem(runner, kind, tenantId, 1, 'Legacy rows');
    await seedAllocatedVersion(runner, kind, tenantId, itemId, YEAR, 'manual_pct', [[north, 60], [south, 40]]);
    const destination = await seedAllocatedVersion(runner, kind, tenantId, itemId, YEAR + 1, 'headcount', []);
    for (const [companyId, pct] of [[north, 70], [south, 30]] as Array<[string, number]>) {
      await runner.query(
        `INSERT INTO ${T[kind].allocations} (tenant_id, version_id, company_id, allocation_pct, is_system_generated) VALUES ($1, $2, $3, $4, true)`,
        [tenantId, destination, companyId, pct],
      );
    }

    const done = await copyAllocations(kind, runner, { sourceYear: YEAR, destinationYear: YEAR + 1 });
    assert.deepEqual(done.summary, { totalItems: 1, processed: 1, skipped: 0, errors: 0 }, `${kind}: copied (system rows are no manual split)`);
    const next = await readVersion(runner, kind, itemId, YEAR + 1);
    assert.deepEqual([next!.allocation_method, next!.rows], ['manual_pct', [[north, 60], [south, 40]]], `${kind}: the manual split replaces the system rows`);
    const [{ n }] = await runner.query(
      `SELECT count(*)::int AS n FROM ${T[kind].allocations} WHERE version_id = $1 AND is_system_generated`,
      [destination],
    );
    assert.equal(n, 0, `${kind}: no system row left`);
  });
}

/** An automatic method is taken by the destination; its shares come from the metrics, no row is stored. */
async function testAutomaticMethod(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-alloc-auto`);
    const north = await seedCompany(runner, tenantId, 'North', { [YEAR]: 10, [YEAR + 1]: 12 });
    const created = await seedItem(runner, kind, tenantId, 1, 'Headcount');
    await seedAllocatedVersion(runner, kind, tenantId, created, YEAR, 'headcount', []);
    const existing = await seedItem(runner, kind, tenantId, 2, 'Existing destination');
    await seedAllocatedVersion(runner, kind, tenantId, existing, YEAR, 'headcount', []);
    await seedAllocatedVersion(runner, kind, tenantId, existing, YEAR + 1, 'manual_pct', [[north, 100]]);

    const preview = await copyAllocations(kind, runner, { sourceYear: YEAR, destinationYear: YEAR + 1, overwrite: true, dryRun: true });
    const byName = Object.fromEntries(preview.results.map((r: any) => [r.itemName, r]));
    assert.deepEqual(
      [byName.Headcount.action, byName.Headcount.sourceAllocationsCount, byName.Headcount.resultMethod],
      ['copy', 1, 'headcount'],
      `${kind}: an automatic source counts its computed shares`,
    );
    assert.deepEqual(
      [byName['Existing destination'].destinationMethod, byName['Existing destination'].resultMethod],
      ['manual_pct', 'headcount'],
      `${kind}: the destination method changes`,
    );

    await copyAllocations(kind, runner, { sourceYear: YEAR, destinationYear: YEAR + 1, overwrite: true });
    const createdNext = await readVersion(runner, kind, created, YEAR + 1);
    assert.deepEqual([createdNext!.allocation_method, createdNext!.rows], ['headcount', []], `${kind}: new destination takes the method`);
    const existingNext = await readVersion(runner, kind, existing, YEAR + 1);
    assert.deepEqual([existingNext!.allocation_method, existingNext!.rows], ['headcount', []], `${kind}: manual rows removed, method updated`);
  });
}

/** A line whose rules refuse it is listed as an error in the dry run, and fails the real copy with nothing kept. */
async function testRefusedLine(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-alloc-refused`);
    const north = await seedCompany(runner, tenantId, 'North');
    // Two companies without a headcount: a manual company split between them cannot be weighted.
    const east = await seedCompany(runner, tenantId, 'East');
    const west = await seedCompany(runner, tenantId, 'West');
    const good = await seedItem(runner, kind, tenantId, 1, 'Good');
    await seedAllocatedVersion(runner, kind, tenantId, good, YEAR, 'manual_pct', [[north, 100]]);
    const refused = await seedItem(runner, kind, tenantId, 2, 'Refused');
    await seedAllocatedVersion(runner, kind, tenantId, refused, YEAR, 'manual_company', [[east, 50], [west, 50]]);

    const preview = await copyAllocations(kind, runner, { sourceYear: YEAR, destinationYear: YEAR + 1, dryRun: true });
    const byName = Object.fromEntries(preview.results.map((r: any) => [r.itemName, r]));
    assert.equal(byName.Good.action, 'copy', `${kind}: the other line is still previewed`);
    assert.equal(byName.Refused.action, 'error', `${kind}: the refused line is an error`);
    assert.match(byName.Refused.message, /Provide headcount values/);
    assert.deepEqual([preview.success, preview.summary.errors], [false, 1]);

    await assert.rejects(
      () => underSavepoint(runner, () => copyAllocations(kind, runner, { sourceYear: YEAR, destinationYear: YEAR + 1 })),
      /Provide headcount values/,
      `${kind}: the real copy fails`,
    );
    assert.equal(await findVersion(runner, kind, good, YEAR + 1), undefined, `${kind}: nothing is kept`);
  });
}

/** A line not valid in the destination year is left out; a line valid for part of it is copied. */
async function testDestinationYearValidity(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-alloc-validity`);
    const north = await seedCompany(runner, tenantId, 'North');
    const ended = await seedItem(runner, kind, tenantId, 1, 'Ended');
    await setItemDates(runner, kind, ended, { disabledAt: `${YEAR}-12-31T12:00:00Z` });
    await seedAllocatedVersion(runner, kind, tenantId, ended, YEAR, 'manual_pct', [[north, 100]]);
    const partial = await seedItem(runner, kind, tenantId, 2, 'Partial');
    await setItemDates(runner, kind, partial, { disabledAt: `${YEAR + 1}-06-30T12:00:00Z` });
    await seedAllocatedVersion(runner, kind, tenantId, partial, YEAR, 'manual_pct', [[north, 100]]);

    const preview = await copyAllocations(kind, runner, { sourceYear: YEAR, destinationYear: YEAR + 1, dryRun: true });
    assert.deepEqual(preview.results.map((r: any) => [r.itemName, r.action]), [['Partial', 'copy']], `${kind}: the ended line is not listed`);
    assert.deepEqual(preview.summary, { totalItems: 1, processed: 1, skipped: 0, errors: 0 });

    const done = await copyAllocations(kind, runner, { sourceYear: YEAR, destinationYear: YEAR + 1 });
    assert.deepEqual(done.summary, { totalItems: 1, processed: 1, skipped: 0, errors: 0 });
    assert.equal(await findVersion(runner, kind, ended, YEAR + 1), undefined, `${kind}: no version for the ended line`);
    assert.deepEqual((await readVersion(runner, kind, partial, YEAR + 1))!.rows, [[north, 100]], `${kind}: the partial line is copied`);

    // Validity follows the destination year, not today: back into the source year, the ended line is copied.
    const back = await copyAllocations(kind, runner, { sourceYear: YEAR + 1, destinationYear: YEAR, overwrite: true, dryRun: true });
    assert.deepEqual(back.results.map((r: any) => r.itemName).sort(), ['Ended', 'Partial']);
  });
}

/** A failure after a first line was written fails the request and keeps nothing. */
async function testAllOrNothing(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-alloc-atomic`);
    const north = await seedCompany(runner, tenantId, 'North');
    const items = [];
    for (const itemNumber of [1, 2]) {
      const itemId = await seedItem(runner, kind, tenantId, itemNumber, `Line ${itemNumber}`);
      await seedAllocatedVersion(runner, kind, tenantId, itemId, YEAR, 'manual_pct', [[north, 100]]);
      items.push(itemId);
    }
    let seen = 0;
    const failOnSecond = captureAudit((entry) => entry.table === AUDIT_LABELS[kind].allocations && ++seen === 2);
    await assert.rejects(
      () => underSavepoint(runner, () => copyAllocations(kind, runner, { sourceYear: YEAR, destinationYear: YEAR + 1 }, failOnSecond)),
      /forced failure/,
    );
    assert.equal(seen, 2, `${kind}: the failure came after a first line was written`);
    for (const itemId of items) {
      assert.equal(await findVersion(runner, kind, itemId, YEAR + 1), undefined, `${kind}: no line keeps a copied year`);
    }
  });
}

void runSpecs('copy-allocations.integration.spec', KINDS.flatMap((kind) => [
  [`testManualCopy(${kind})`, () => testManualCopy(kind)],
  [`testManualCopyOverSystemRows(${kind})`, () => testManualCopyOverSystemRows(kind)],
  [`testAutomaticMethod(${kind})`, () => testAutomaticMethod(kind)],
  [`testRefusedLine(${kind})`, () => testRefusedLine(kind)],
  [`testAllOrNothing(${kind})`, () => testAllOrNothing(kind)],
  [`testDestinationYearValidity(${kind})`, () => testDestinationYearValidity(kind)],
] as Array<[string, () => Promise<void>]>));

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
