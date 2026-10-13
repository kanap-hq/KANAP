import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { QueryRunner } from 'typeorm';
import { ensureCapexDimensions } from '../../analytics/capex-dimensions.seed';
import { itemService, refusal, seedCompany } from './cost-center.fixtures';
import { captureAudit, inRolledBackTransaction, runSpecs, seedTenant } from './round-inputs.fixtures';

// Lot C1a: the PP&E type, investment type and priority of a CAPEX line are the values of the
// dimensions of those codes. Through the CAPEX service (the `/capex-items` routes): a create
// without one of them is refused naming the dimension; the former keys of a body are not written;
// the line, its detail, its list row and its audit rows carry the values in `analytics_values`
// and none of the former fields, even when the database columns still hold a value. Each test in a
// transaction rolled back.
// @database-spec: opens the data-source through the fixtures, so run-ci-tests.js runs it on a lane.

const RETIRED = ['ppe_type', 'investment_type', 'priority'];

async function setup(runner: QueryRunner) {
  const tenantId = await seedTenant(runner, 'c1-api');
  await ensureCapexDimensions(runner.manager, tenantId);
  const { companyId } = await seedCompany(runner, tenantId, 'Criteria company');
  const rows: Array<{ axis: string; code: string; value: string; name: string }> = await runner.query(
    `SELECT a.id AS axis, a.code, c.id AS value, c.name
       FROM analytics_axes a JOIN analytics_categories c ON c.axis_id = a.id AND c.tenant_id = a.tenant_id
      WHERE a.tenant_id = $1`,
    [tenantId],
  );
  const axis = (code: string) => rows.find((row) => row.code === code)!.axis;
  const value = (code: string, name: string) => rows.find((row) => row.code === code && row.name === name)!.value;
  const body = { description: 'Criteria line', paying_company_id: companyId, currency: 'EUR', effective_start: '2026-01-01' };
  const values = {
    [axis('ppe_type')]: value('ppe_type', 'Hardware'),
    [axis('investment_type')]: value('investment_type', 'Capacity'),
    [axis('priority')]: value('priority', 'High'),
  };
  return { tenantId, companyId, axis, value, body, values };
}

function assertNoRetiredKey(row: Record<string, unknown>, label: string) {
  for (const key of RETIRED) assert.ok(!(key in row), `${label}: no ${key}`);
}

async function testCreateNeedsTheDimensions() {
  await inRolledBackTransaction(async (runner) => {
    const s = await setup(runner);
    const svc = itemService('capex');
    const opts = { manager: runner.manager };
    // The former keys alone: not written, the first required dimension is named.
    const missing = await refusal(runner, () => svc.create({ ...s.body, ppe_type: 'hardware', investment_type: 'capacity', priority: 'high' }, undefined, opts));
    assert.equal(missing.message, 'The PP&E type dimension is required. Choose a value.');
    const lastMissing = await refusal(runner, () => svc.create({
      ...s.body, analytics_values: { [s.axis('ppe_type')]: s.value('ppe_type', 'Software'), [s.axis('investment_type')]: s.value('investment_type', 'Other') },
    }, undefined, opts));
    assert.equal(lastMissing.message, 'The Priority dimension is required. Choose a value.');
  });
}

async function testOutputsCarryTheValues() {
  await inRolledBackTransaction(async (runner) => {
    const s = await setup(runner);
    const audit = captureAudit();
    const svc = itemService('capex', audit);
    const opts = { manager: runner.manager };
    const created = await svc.create({ ...s.body, ppe_type: 'software', analytics_values: s.values }, undefined, opts);
    assertNoRetiredKey(created, 'create');
    assert.deepEqual(
      created.analytics_values.map((v: any) => `${v.axis_code}=${v.category_name}`),
      ['ppe_type=Hardware', 'investment_type=Capacity', 'priority=High'],
      'the values, in the dimension order',
    );
    const [stored] = await runner.query(`SELECT ppe_type, investment_type, priority FROM spend_items WHERE id = $1`, [created.id]);
    assert.deepEqual({ ...stored }, { ppe_type: null, investment_type: null, priority: null }, 'the former columns are not written');

    // A stale value left in a former column never shows.
    await runner.query(`UPDATE spend_items SET ppe_type = 'software', priority = 'low' WHERE id = $1`, [created.id]);
    assertNoRetiredKey(await svc.get(created.id, opts), 'detail');
    const page = await svc.summary({ includeDisabled: 'true', limit: 10 }, opts);
    const row = page.items.find((item: any) => item.id === created.id);
    assertNoRetiredKey(row, 'list row');
    assert.equal(row[`analytics_${s.axis('priority')}`], 'High', 'the list row carries the dimension value');
    const grid = await svc.summary({ includeDisabled: 'true', limit: 10, shape: 'grid' }, opts);
    assertNoRetiredKey(grid.items.find((item: any) => item.id === created.id), 'grid row');

    // An update naming a former key writes nothing of it; the dimensions change through their values.
    const updated = await svc.update(created.id, { priority: 'mandatory', analytics_values: { [s.axis('priority')]: s.value('priority', 'Mandatory') } }, undefined, opts);
    assertNoRetiredKey(updated, 'update');
    const [after] = await runner.query(`SELECT priority FROM spend_items WHERE id = $1`, [created.id]);
    assert.equal(after.priority, 'low', 'the stale column is left as it was');
    assert.equal(updated.analytics_values.find((v: any) => v.axis_code === 'priority').category_name, 'Mandatory');
    const cleared = await refusal(runner, () => svc.update(created.id, { analytics_values: { [s.axis('ppe_type')]: null } }, undefined, opts));
    assert.equal(cleared.message, 'The PP&E type dimension is required. Choose a value.', 'a held value cannot be cleared');

    for (const entry of audit.entries) {
      assertNoRetiredKey(entry.after ?? {}, `audit ${entry.action} after`);
      assertNoRetiredKey(entry.before ?? {}, `audit ${entry.action} before`);
    }
    assert.ok(audit.entries.some((entry) => entry.action === 'update'), 'the update was audited');
  });
}

void runSpecs('capex-criteria-api.integration.spec', [
  ['a create needs the CAPEX dimensions', testCreateNeedsTheDimensions],
  ['outputs carry the values, not the former fields', testOutputsCarryTheValues],
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
