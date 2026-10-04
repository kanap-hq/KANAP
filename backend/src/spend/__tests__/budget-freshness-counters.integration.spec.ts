import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import { AiFinancialPlanMutationSupportService } from '../../ai/mutation/ai-financial-plan-mutation-support.service';
import { CapexVersionsService } from '../../capex/capex-versions.service';
import { syncTableLifecycleStatus } from '../../cleanup/lifecycle-status-sync.service';
import { FreezeService } from '../../freeze/freeze.service';
import { copyAllocations, sameAllocationRows, storedAllocationPct } from '../budget-allocation-operations';
import { clearBudgetColumn, copyBudgetColumn } from '../budget-column-operations';
import { SpendAllocation } from '../spend-allocation.entity';
import { SpendAllocationsService } from '../spend-allocations.service';
import { SpendVersionsService } from '../spend-versions.service';
import { exportBudgetFile, fileRows, loadBudgetFile, withCell } from './budget-file.fixtures';
import { itemService, lineBody, seedCompany } from './cost-center.fixtures';
import {
  amountsService,
  assert,
  captureAudit,
  inRolledBackTransaction,
  Kind,
  noFreeze,
  repeat,
  runSpecs,
  seedLine,
  seedTenant,
  TABLES,
} from './round-inputs.fixtures';

// The freshness counters of the budget (plan planning/perf-scale, lot 3B;
// migration 1853740000000), against the database: every writer path bumps a
// line's `row_version` or a version's `budget_rev` when it changes something
// the CSV token covers, and never on a write that changes nothing, on the
// status the hourly sync rewrites or on `updated_at`. Of a version's own
// columns only the allocation method and driver count: never the view choice
// (`input_grain`), the notes, the name, the dates or the FX pin a freeze
// rewrites on every version of a year. Each test runs in a transaction rolled
// back at the end.
// @database-spec: run-ci-tests.js runs this file in its serial database lane.

const KINDS: Kind[] = ['opex', 'capex'];
const YEAR = 2031;
const currencySettings = { getSettings: async () => ({ reportingCurrency: 'EUR', allowedCurrencies: null }) };

function versionsService(kind: Kind): any {
  return kind === 'opex'
    ? new SpendVersionsService(undefined as any, undefined as any, captureAudit() as any, currencySettings as any)
    : new CapexVersionsService(undefined as any, undefined as any, captureAudit() as any, currencySettings as any);
}

async function rowVersion(runner: QueryRunner, kind: Kind, itemId: string): Promise<number> {
  const [row] = await runner.query(`SELECT row_version FROM ${TABLES[kind].items} WHERE id = $1`, [itemId]);
  return Number(row.row_version);
}

async function budgetRev(runner: QueryRunner, kind: Kind, versionId: string): Promise<number> {
  const [row] = await runner.query(`SELECT budget_rev FROM ${TABLES[kind].versions} WHERE id = $1`, [versionId]);
  return Number(row.budget_rev);
}

/** Runs the write and returns how much the counter moved. */
async function bumpOf(read: () => Promise<number>, write: () => Promise<unknown>): Promise<number> {
  const before = await read();
  await write();
  return (await read()) - before;
}

/** A line created through the service, with its company (the update path needs one). */
async function seedServiceLine(runner: QueryRunner, kind: Kind, tenantId: string, extra: Record<string, unknown> = {}) {
  const { companyId } = await seedCompany(runner, tenantId, `Counters ${kind} company`);
  const line = await itemService(kind).create(lineBody(kind, `Counters ${kind} line`, { paying_company_id: companyId, notes: 'Start', ...extra }), undefined, { manager: runner.manager });
  return line.id as string;
}

async function seedAxis(runner: QueryRunner, tenantId: string): Promise<{ axisId: string; first: string; second: string }> {
  const [axis] = await runner.query(
    `INSERT INTO analytics_axes (tenant_id, code, name, sort_order) VALUES ($1, 'counters', 'Counters', 9) RETURNING id`,
    [tenantId],
  );
  const value = async (name: string) => (await runner.query(
    `INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, axis.id, name],
  ))[0].id as string;
  return { axisId: axis.id, first: await value('First'), second: await value('Second') };
}

/* ---- row_version ---- */

async function lineColumns(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `rv-${kind}`);
    const itemId = await seedServiceLine(runner, kind, tenantId);
    const svc = itemService(kind);
    const rv = () => rowVersion(runner, kind, itemId);
    const update = (body: Record<string, unknown>) => svc.update(itemId, body, undefined, { manager: runner.manager });
    assert.equal(await rv(), 1, `${kind}: a new line starts at 1`);

    assert.equal(await bumpOf(rv, () => update({ notes: 'Changed' })), 1, `${kind}: a changed column bumps once`);
    assert.equal(await bumpOf(rv, () => update({ notes: 'Changed' })), 0, `${kind}: the same value written back bumps nothing (updated_at only)`);
    assert.equal(await bumpOf(rv, () => update({})), 0, `${kind}: an empty update bumps nothing`);
    const detail = await svc.get(itemId, { manager: runner.manager });
    assert.equal(detail.row_version, await rv(), `${kind}: the detail carries row_version`);

    // The end of validity passed without an edit: the stored status lags behind it.
    await runner.query(`UPDATE ${TABLES[kind].items} SET disabled_at = now() - interval '1 day' WHERE id = $1`, [itemId]);
    assert.equal(await bumpOf(rv, () => runner.query(`UPDATE ${TABLES[kind].items} SET status = 'enabled', updated_at = now() WHERE id = $1`, [itemId])), 0,
      `${kind}: status and updated_at alone bump nothing`);
    assert.equal(await bumpOf(rv, () => syncTableLifecycleStatus(runner.manager, tenantId, TABLES[kind].items as any)), 0,
      `${kind}: the hourly lifecycle sync bumps nothing`);
    const [{ status }] = await runner.query(`SELECT status::text AS status FROM ${TABLES[kind].items} WHERE id = $1`, [itemId]);
    assert.equal(status, 'disabled', `${kind}: the sync did set the status`);
    await runner.query(`UPDATE ${TABLES[kind].items} SET status = 'enabled' WHERE id = $1`, [itemId]);
    assert.equal(await bumpOf(rv, () => update({})), 0, `${kind}: an edit that only refreshes the derived status bumps nothing`);
    assert.equal(await bumpOf(rv, () => update({ disabled_at: null })), 1, `${kind}: clearing the end of validity bumps`);
  });
}

async function lineAnalytics(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `rv-axes-${kind}`);
    const itemId = await seedServiceLine(runner, kind, tenantId);
    const { axisId, first, second } = await seedAxis(runner, tenantId);
    const rv = () => rowVersion(runner, kind, itemId);
    const update = (body: Record<string, unknown>) => itemService(kind).update(itemId, body, undefined, { manager: runner.manager });
    assert.equal(await bumpOf(rv, () => update({ analytics_values: { [axisId]: first } })), 1, `${kind}: an analytics value set bumps the line`);
    assert.equal(await bumpOf(rv, () => update({ analytics_values: { [axisId]: first } })), 0, `${kind}: the same value bumps nothing`);
    assert.equal(await bumpOf(rv, () => update({ analytics_values: { [axisId]: second } })), 1, `${kind}: another value bumps`);
    assert.equal(await bumpOf(rv, () => update({ analytics_values: { [axisId]: null } })), 1, `${kind}: a cleared value bumps`);
    assert.equal(await bumpOf(rv, () => update({ analytics_values: { [axisId]: null } })), 0, `${kind}: clearing an empty value bumps nothing`);

    // The search index holds no analytics value: the line's update that only bumps its counter
    // (a value written alone, here in SQL: the service also sets the line's updated_at) refreshes nothing.
    const indexed = async () => (await runner.query(`SELECT count(*)::int AS n FROM search_index WHERE entity_type = $1 AND entity_id = $2`, [TABLES[kind].items, itemId]))[0].n;
    await runner.query(`DELETE FROM search_index WHERE entity_type = $1 AND entity_id = $2`, [TABLES[kind].items, itemId]);
    const values = kind === 'opex' ? 'spend_item_analytics_values' : 'capex_item_analytics_values';
    assert.equal(await bumpOf(rv, () => runner.query(`INSERT INTO ${values} (tenant_id, item_id, axis_id, category_id) VALUES ($1, $2, $3, $4)`, [tenantId, itemId, axisId, second])), 1,
      `${kind}: a value written alone bumps its line`);
    assert.equal(await indexed(), 0, `${kind}: a counter-only update of the line does not refresh its search entry`);
    await update({ notes: 'Indexed again' });
    assert.equal(await indexed(), 1, `${kind}: any other update of the line refreshes it`);

    // A line created with analytics values starts at 2: their insert bumps it, like any later change.
    const created = await itemService(kind).create(
      lineBody(kind, `Counters ${kind} line with values`, { paying_company_id: (await runner.query(`SELECT paying_company_id FROM ${TABLES[kind].items} WHERE id = $1`, [itemId]))[0].paying_company_id, analytics_values: { [axisId]: first } }),
      undefined, { manager: runner.manager },
    );
    assert.equal(await rowVersion(runner, kind, created.id), 2, `${kind}: a line created with analytics values starts at 2`);
  });
}

/* ---- budget_rev ---- */

async function versionAmounts(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `br-amounts-${kind}`);
    const { versionId } = await seedLine(runner, kind, tenantId, YEAR, { planned: repeat('100', 12) });
    const br = () => budgetRev(runner, kind, versionId);
    const save = (payload: Record<string, unknown>) => amountsService(kind).bulkUpsert(versionId, { year: YEAR, ...payload }, null, { manager: runner.manager });
    const march = (values: Record<string, number>) => ({ kind: 'monthly', months: [{ period: `${YEAR}-03-01`, ...values }] });

    assert.ok(await bumpOf(br, () => save(march({ planned: 150 }))) > 0, `${kind}: a changed month bumps`);
    assert.equal(await bumpOf(br, () => save(march({ planned: 150 }))), 0, `${kind}: the same value saved again bumps nothing`);
    assert.equal(await bumpOf(br, () => save(march({ forecast: 0 }))), 0, `${kind}: 0 written over an empty cell bumps nothing`);
    // Zeros over empty months change no amount, but the column gets its spread record (period, method): a change.
    assert.ok(await bumpOf(br, () => save({ kind: 'annual', totals: { committed: 0 } })) > 0, `${kind}: a first spread records its column`);
    assert.equal(await bumpOf(br, () => save({ kind: 'annual', totals: { committed: 0 } })), 0, `${kind}: the same zeros spread again bump nothing`);
    await save({ kind: 'annual', totals: { forecast: 1200 } });
    assert.equal(await bumpOf(br, () => save({ kind: 'annual', totals: { forecast: 1200 } })), 0, `${kind}: the same spread again bumps nothing`);

    const lines = {
      kind: 'lines', measure: 'actual',
      lines: [{ label: 'Support', quantity_unit: 'people', quantity: '2', unit_price: '1000', price_basis: 'per_month', period_start: `${YEAR}-01-01`, period_end: `${YEAR}-06-30` }],
    };
    assert.ok(await bumpOf(br, () => save(lines)) > 0, `${kind}: costed lines bump`);
    assert.equal(await bumpOf(br, () => save(lines)), 0, `${kind}: the same costed lines bump nothing`);
    assert.ok(await bumpOf(br, () => save({ kind: 'lines', measure: 'actual', lines: [] })) > 0, `${kind}: removing the lines bumps`);
  });
}

async function versionColumns(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `br-version-${kind}`);
    const { itemId, versionId } = await seedLine(runner, kind, tenantId, YEAR, { planned: repeat('100', 12) });
    const br = () => budgetRev(runner, kind, versionId);
    const versions = versionsService(kind);
    const patch = (body: Record<string, unknown>) => versions.updateForItem(itemId, { id: versionId, ...body }, null, { manager: runner.manager });
    assert.equal(await bumpOf(br, () => patch({ input_grain: 'annual' })), 0, `${kind}: the view choice (input_grain) bumps nothing`);
    assert.equal(await bumpOf(br, () => patch({ allocation_method: 'manual_pct' })), 1, `${kind}: the allocation method bumps once`);
    assert.equal(await bumpOf(br, () => patch({ allocation_method: 'manual_pct' })), 0, `${kind}: the same method bumps nothing`);
    assert.equal(await bumpOf(br, () => patch({ allocation_driver: 'turnover' })), 1, `${kind}: the allocation driver bumps once`);
    assert.equal(await bumpOf(br, () => patch({ allocation_driver: 'turnover' })), 0, `${kind}: the same driver bumps nothing`);
    assert.equal(await bumpOf(br, () => patch({ notes: 'Budget note' })), 0, `${kind}: the notes bump nothing`);
    assert.equal(await bumpOf(br, () => patch({ version_name: 'Renamed' })), 0, `${kind}: the name bumps nothing`);
    assert.equal(await bumpOf(br, () => patch({ as_of_date: `${YEAR}-02-01` })), 0, `${kind}: the as-of date bumps nothing`);
    assert.equal(await bumpOf(br, () => patch({ reporting_currency: 'USD' })), 0, `${kind}: the reporting currency bumps nothing`);
    assert.equal(await bumpOf(br, () => runner.query(`UPDATE ${TABLES[kind].versions} SET is_approved = NOT is_approved WHERE id = $1`, [versionId])), 0,
      `${kind}: the approval bumps nothing`);
    const [listed] = (await versions.listForItem(itemId, { manager: runner.manager })).filter((v: any) => v.id === versionId);
    assert.equal(listed.budget_rev, await br(), `${kind}: the version list carries budget_rev`);
    assert.equal(await bumpOf(br, () => runner.query(`UPDATE ${TABLES[kind].versions} SET updated_at = now() + interval '1 hour' WHERE id = $1`, [versionId])), 0,
      `${kind}: updated_at alone bumps nothing`);
  });
}

/** A freeze pins the year's FX rate set on every version, an unfreeze unpins it: neither bumps a counter. */
async function freezeFxPin(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `br-freeze-${kind}`);
    const { itemId, versionId } = await seedLine(runner, kind, tenantId, YEAR, { planned: repeat('100', 12) });
    const [{ id: rateSetId }] = await runner.query(
      `INSERT INTO currency_rate_sets (tenant_id, fiscal_year, base_currency, rates) VALUES ($1, $2, 'EUR', '{}'::jsonb) RETURNING id`,
      [tenantId, YEAR],
    );
    const freeze = new FreezeService(
      undefined as any,
      { refreshTenant: async () => undefined } as any,
      { getLatestRateSet: async () => ({ id: rateSetId }) } as any,
      { getSettings: async () => ({ reportingCurrency: 'USD' }) } as any,
    );
    const counters = async () => ({ rv: await rowVersion(runner, kind, itemId), br: await budgetRev(runner, kind, versionId) });
    const pinned = async () => (await runner.query(`SELECT fx_rate_set_id FROM ${TABLES[kind].versions} WHERE id = $1`, [versionId]))[0].fx_rate_set_id;
    const before = await counters();
    await freeze.freeze(YEAR, [{ scope: kind }], null, { manager: runner.manager });
    assert.equal(await pinned(), rateSetId, `${kind}: the freeze pinned the rate set`);
    assert.deepEqual(await counters(), before, `${kind}: a freeze (FX pin and reporting currency) bumps no counter`);
    await freeze.unfreeze(YEAR, [{ scope: kind }], null, { manager: runner.manager });
    assert.equal(await pinned(), null, `${kind}: the unfreeze unpinned it`);
    assert.deepEqual(await counters(), before, `${kind}: an unfreeze bumps no counter`);
  });
}

async function allocations() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'br-allocations');
    const { companyId: c1 } = await seedCompany(runner, tenantId, 'Allocation company 1', 6001);
    const { companyId: c2 } = await seedCompany(runner, tenantId, 'Allocation company 2', 6002);
    const source = await seedLine(runner, 'opex', tenantId, YEAR, { planned: repeat('100', 12) });
    const [{ id: destination }] = await runner.query(
      `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, budget_year, as_of_date, allocation_method)
       VALUES ($1, $2, 'Next', $3, $4, 'default') RETURNING id`,
      [tenantId, source.itemId, YEAR + 1, `${YEAR + 1}-01-01`],
    );
    await runner.query(`UPDATE spend_versions SET allocation_method = 'manual_pct' WHERE id = $1`, [source.versionId]);
    const br = () => budgetRev(runner, 'opex', source.versionId);
    const svc = new SpendAllocationsService(undefined as any, undefined as any, undefined as any, captureAudit() as any);
    const split = [{ company_id: c1, department_id: null, allocation_pct: 60 }, { company_id: c2, department_id: null, allocation_pct: 40 }];
    const save = (rows: unknown[]) => svc.bulkUpsert(source.versionId, rows as any, undefined, { manager: runner.manager, tenantId });
    assert.ok(await bumpOf(br, () => save(split)) > 0, 'a new split bumps');
    assert.equal(await bumpOf(br, () => save([...split].reverse())), 0, 'the same split saved again (any order) bumps nothing');
    assert.ok(await bumpOf(br, () => save([{ company_id: c1, department_id: null, allocation_pct: 100 }])) > 0, 'another split bumps');

    // The allocation copy: a first copy writes the destination, the same copy again writes nothing.
    const calculator = { computeForVersions: async (versions: Array<{ id: string }>) => new Map(versions.map((v) => [v.id, { shares: [{}] }])) };
    const copy = () => copyAllocations({ manager: runner.manager, audit: captureAudit() as any, calculator }, 'opex', { sourceYear: YEAR, destinationYear: YEAR + 1, overwrite: true }, null);
    const destinationRev = () => budgetRev(runner, 'opex', destination);
    assert.ok(await bumpOf(destinationRev, copy) > 0, 'an allocation copy bumps the destination');
    assert.equal(await bumpOf(destinationRev, copy), 0, 'the same allocation copy again bumps nothing');
  });
}

/**
 * A share is compared as PostgreSQL stores it (numeric(7,4), half away from
 * zero on the decimal text the driver sends), never with `toFixed(4)`, which
 * rounds the binary double: a halfway share stored, then computed again, is
 * the same split (no rewrite, no bump).
 */
async function allocationShareRounding() {
  await inRolledBackTransaction(async (runner) => {
    const values = [0.30665, 12.34565, 1.00005, 2.00005, 10.00005, 99.99995, 0.00005, 0.00004, 100 / 3, 200 / 3, 100 / 7, 1e-7, 0, 100, 61.33 / 2, 12.3456];
    for (let i = 1; i <= 200; i++) values.push((i * 100) / 997, i / 20000 + 0.00005);
    const stored: Array<{ v: string }> = await runner.query(`SELECT unnest($1::numeric(7,4)[])::text AS v`, [values]);
    values.forEach((value, i) => assert.equal(storedAllocationPct(value), stored[i].v, `${value} as stored`));

    const tenantId = await seedTenant(runner, 'br-allocation-rounding');
    const { companyId: c1 } = await seedCompany(runner, tenantId, 'Rounding company 1', 6001);
    const { companyId: c2 } = await seedCompany(runner, tenantId, 'Rounding company 2', 6002);
    const { versionId } = await seedLine(runner, 'opex', tenantId, YEAR);
    const split = [
      { company_id: c1, department_id: null, allocation_pct: 0.30665, is_system_generated: false, rule_id: null, materialized_from: null },
      { company_id: c2, department_id: null, allocation_pct: 99.69335, is_system_generated: false, rule_id: null, materialized_from: null },
    ];
    for (const row of split) {
      await runner.manager.getRepository(SpendAllocation).save({ ...row, tenant_id: tenantId, version_id: versionId });
    }
    const rows = await runner.query(
      `SELECT company_id, department_id, allocation_pct, is_system_generated, rule_id, materialized_from FROM spend_allocations WHERE version_id = $1`,
      [versionId],
    );
    assert.ok(sameAllocationRows(rows, split), `the split as stored (${rows.map((r: any) => r.allocation_pct).join(', ')}) is the split computed`);
  });
}

async function columnOperations(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `br-columns-${kind}`);
    const { versionId } = await seedLine(runner, kind, tenantId, YEAR, { planned: repeat('100', 12) });
    const br = () => budgetRev(runner, kind, versionId);
    const deps = { manager: runner.manager, audit: captureAudit() as any, freeze: noFreeze };
    const copy = () => copyBudgetColumn(deps, kind, {
      sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR, destinationColumn: 'forecast', percentageIncrease: 0, overwrite: true, dryRun: false,
    }, null);
    assert.ok(await bumpOf(br, copy) > 0, `${kind}: a column copy bumps`);
    assert.equal(await bumpOf(br, copy), 0, `${kind}: the same copy again bumps nothing`);
    const clear = () => clearBudgetColumn(deps, kind, { year: YEAR, column: 'forecast' }, null);
    assert.ok(await bumpOf(br, clear) > 0, `${kind}: a column clear bumps`);
    assert.equal(await bumpOf(br, clear), 0, `${kind}: clearing an empty column bumps nothing`);
  });
}

/** A budget file of month cells: an unchanged month bumps nothing, a changed one bumps. */
async function budgetFileMonths() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'br-file-months');
    const { versionId } = await seedLine(runner, 'opex', tenantId, YEAR, { planned: repeat('100', 12) }, 3);
    const br = () => budgetRev(runner, 'opex', versionId);
    const header = Array.from({ length: 12 }, (_, i) => `budget_${YEAR}_${String(i + 1).padStart(2, '0')}`).join(',');
    const file = (value: string) => `item_number,${header}\nOPX-3,${repeat(value, 12).join(',')}\n`;
    const run = async (value: string) => {
      const result = await loadBudgetFile(runner.manager, 'opex', tenantId, file(value));
      assert.equal(result.ok, true, `the load result: ${JSON.stringify((result as any).errors)}`);
    };
    assert.equal(await bumpOf(br, () => run('100')), 0, 'an unchanged month bumps nothing');
    assert.ok(await bumpOf(br, () => run('110')) > 0, 'a changed month bumps');
  });
}

async function budgetFileReimport() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'rv-file');
    const { companyId, accountId } = await seedCompany(runner, tenantId, 'Counters file company');
    const created = await itemService('opex').create(
      lineBody('opex', 'Counters file line', { paying_company_id: companyId, account_id: accountId, notes: 'Start' }), undefined, { manager: runner.manager },
    );
    const itemId = created.id as string;
    const year = new Date().getFullYear();
    const column = `budget_${year}`;
    const exported = () => exportBudgetFile(runner.manager, 'opex', tenantId, [itemId], { amountYears: String(year), columns: 'budget', detail: 'yearly' });
    const importFile = async (content: string) => {
      const result = await loadBudgetFile(runner.manager, 'opex', tenantId, content);
      assert.equal(result.ok, true, `the load result: ${JSON.stringify((result as any).errors)}`);
    };
    await importFile(withCell(await exported(), column, '1200'));
    const [{ id: versionId }] = await runner.query(`SELECT id FROM spend_versions WHERE spend_item_id = $1 AND budget_year = $2`, [itemId, year]);
    const rv = () => rowVersion(runner, 'opex', itemId);
    const br = () => budgetRev(runner, 'opex', versionId);
    const again = await exported();
    assert.equal(fileRows(again)[0][column], '1200.00', 'the export carries the imported budget');
    const before = { rv: await rv(), br: await br() };
    await importFile(again);
    assert.deepEqual({ rv: await rv(), br: await br() }, before, 'an export imported back unchanged bumps neither counter');
    await importFile(withCell(again, column, '1300'));
    assert.ok((await br()) > before.br, 'a changed budget in the file bumps the version');
    assert.equal(await rv(), before.rv, 'an amount alone does not bump the line');
  });
}

async function aiFinancialPlan(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `br-ai-${kind}`);
    const { itemId, versionId } = await seedLine(runner, kind, tenantId, YEAR, { planned: repeat('100', 12) });
    const ai = new AiFinancialPlanMutationSupportService(
      captureAudit() as any,
      undefined as any, amountsService('capex') as any, versionsService('capex'),
      undefined as any, amountsService('opex') as any, versionsService('opex'),
    );
    const context: any = { tenantId, userId: null, manager: runner.manager };
    const entityType = kind === 'opex' ? 'spend_items' : 'capex_items';
    const run = async (input: Record<string, unknown>) => {
      const prepared = await ai.prepareCreatePreview(context, { entity_type: entityType, ref: itemId, version_ref: versionId, ...input } as any);
      await ai.executePreview(context, {
        target_entity_type: prepared.targetEntityType,
        target_entity_id: prepared.targetEntityId,
        mutation_input: prepared.mutationInput,
        current_values: prepared.currentValues,
      } as any);
    };
    const br = () => budgetRev(runner, kind, versionId);
    assert.ok(await bumpOf(br, () => run({ action: 'upsert_amounts', amounts: { kind: 'monthly', year: YEAR, months: [{ period: `${YEAR}-05-01`, planned: 500 }] } })) > 0,
      `${kind}: the AI's amounts bump`);
    assert.equal(await bumpOf(br, () => run({ action: 'update_version', fields: { allocation_method: 'manual_company' } })), 1, `${kind}: the AI's version update bumps once`);
  });
}

void runSpecs('budget-freshness-counters.integration.spec', [
  ...KINDS.map((kind): [string, () => Promise<void>] => [`${kind}: row_version follows the line's columns, never status or updated_at`, () => lineColumns(kind)]),
  ...KINDS.map((kind): [string, () => Promise<void>] => [`${kind}: analytics values bump their line`, () => lineAnalytics(kind)]),
  ...KINDS.map((kind): [string, () => Promise<void>] => [`${kind}: budget_rev follows the amounts and costed lines, never a no-op`, () => versionAmounts(kind)]),
  ...KINDS.map((kind): [string, () => Promise<void>] => [`${kind}: budget_rev follows the allocation method and driver, no other version column`, () => versionColumns(kind)]),
  ...KINDS.map((kind): [string, () => Promise<void>] => [`${kind}: a freeze or unfreeze (FX pin) bumps nothing`, () => freezeFxPin(kind)]),
  ['allocations: a save or a copy bumps, the same split does not', allocations],
  ['allocations: a halfway share compares as PostgreSQL stores it', allocationShareRounding],
  ...KINDS.map((kind): [string, () => Promise<void>] => [`${kind}: column copy and clear bump once, not when repeated`, () => columnOperations(kind)]),
  ['budget file months: an unchanged month bumps nothing', budgetFileMonths],
  ['budget file: an export imported back bumps nothing', budgetFileReimport],
  ...KINDS.map((kind): [string, () => Promise<void>] => [`${kind}: the AI financial plan path bumps`, () => aiFinancialPlan(kind)]),
]);
