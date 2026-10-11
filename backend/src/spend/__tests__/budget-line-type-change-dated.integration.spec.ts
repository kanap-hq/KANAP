import 'dotenv/config';
import { HttpException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import { SpendItemsController } from '../spend-items.controller';
import { CapexItemsController } from '../capex-items.controller';
import { readBudgetLineMeta } from '../item-meta';
import { requiredDimensionMessage } from '../item-analytics.util';
import { preflightBudgetFile } from './budget-file.fixtures';
import {
  changeAuditRows,
  lineChildren,
  seedRoleUser,
  seedTypeChangeLine,
  seedTypeChangeWorld,
  storedLine,
  typeChangeService,
  versionTotals,
} from './budget-line-type-change.fixtures';
import { assert, captureAudit, freezeColumn, inRolledBackTransaction, runSpecs, setTenant } from './round-inputs.fixtures';
import { itemService } from './cost-center.fixtures';

// The change of type of a budget line from a later year (lot M, plan planning/budget-unifie.md,
// decision U4; `budget-line-type-change.service.ts`), each test in a transaction rolled back. An
// OPEX line with versions 2025 to 2027 changes to CAPEX from 2026:
// - the old line keeps 2025, ends on 31 December 2025, keeps its tasks, attachments, web links,
//   contacts and links; the new CAPEX line starts on 1 January 2026 with the versions of 2026 and
//   2027 (same ids, their months, totals, round input and allocations), the old line's contacts and
//   links copied, its description, the values that apply to CAPEX plus those given, a CPX number,
//   and names the old line (`predecessor_id`); the account of the other type and the values of the
//   other type stay behind; each line gets an audit row and names the user in its meta; each
//   workspace shows the other line;
// - the new line goes through the creation of its type: a missing required dimension is refused;
//   a year without a version, a line ending or starting too late, a line already continued, a
//   frozen column in the years that move are refused; the years before do not count;
// - a later end of validity moves to the new line; a budget file finds the new line by its BL number.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const NUMBER = 990251;

async function seedTenant(runner: QueryRunner): Promise<string> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Type change from a year', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `type-change-dated-${tenantId.slice(0, 8)}`],
  );
  await setTenant(runner, tenantId);
  return tenantId;
}

async function statusOf(runner: QueryRunner, call: () => Promise<unknown>): Promise<{ status: number; body?: any }> {
  await runner.query('SAVEPOINT type_change_call');
  try {
    const body = await call();
    await runner.query('RELEASE SAVEPOINT type_change_call');
    return { status: 200, body };
  } catch (err) {
    await runner.query('ROLLBACK TO SAVEPOINT type_change_call');
    if (err instanceof HttpException) return { status: err.getStatus(), body: err.getResponse() };
    throw err;
  }
}

async function seed(runner: QueryRunner, line: { disabledAt?: string | null; effectiveStart?: string } = {}) {
  const tenantId = await seedTenant(runner);
  const w = await seedTypeChangeWorld(runner, tenantId);
  const member = await seedRoleUser(runner, tenantId, 'member', { budget: 'member', tasks: 'member' });
  const seeded = await seedTypeChangeLine(runner, w, {
    itemNumber: NUMBER,
    values: { [w.sharedAxis.id]: w.sharedAxis.opexOnly, [w.opexAxis.id]: w.opexAxis.first },
    ...line,
  });
  const none = undefined as any;
  const audit = captureAudit();
  const typeChange = typeChangeService(runner);
  const opexSvc = itemService('opex', audit);
  const capexSvc = itemService('capex', audit);
  const opex = new SpendItemsController(opexSvc, none, none, none, none, audit as any, none, capexSvc, typeChange) as any;
  const capex = new CapexItemsController(capexSvc, none, none, none, none, audit as any, none, opexSvc, typeChange) as any;
  const ctx = { manager: runner.manager, tenantId, userId: member };
  return { w, member, line: seeded, ctx, opex, capex };
}

async function testFromYear() {
  await inRolledBackTransaction(async (runner) => {
    const { w, member, line, ctx, opex, capex } = await seed(runner);
    const tenantId = w.tenantId;
    const children = await lineChildren(runner, tenantId, line.id);
    const totals = await versionTotals(runner, tenantId, line.id);

    const check = await opex.changeTypeCheck(line.id, '2026', ctx);
    assert.deepEqual([check.mode, check.years, check.from_year, check.dated_refusal], ['dated', [2025, 2026, 2027], 2026, null]);
    assert.deepEqual(
      check.dimensions.map((d: any) => [d.axis_id, d.reason, d.required]),
      [[w.requiredAxis.id, 'required', true], [w.sharedAxis.id, 'value_other_type', false]],
      'the new line needs the required CAPEX dimension; the OPEX-only value stays behind',
    );
    assert.deepEqual(check.carried, {
      versions: 2, tasks: 0, attachments: 0, links: 0, contacts: 1, applications: 1, assets: 1, contracts: 1, projects: 1, requests: 1,
    }, 'two versions move; tasks, attachments and web links stay; contacts and links are copied');
    assert.equal(check.account.carried, false, 'the OPEX account is not copied');

    // The new line passes the creation of its type: without the required dimension it is refused.
    const missing = await statusOf(runner, () => opex.changeType(line.id, { row_version: check.row_version, from_year: 2026 }, ctx));
    assert.deepEqual([missing.status, missing.body.message], [400, requiredDimensionMessage({ name: 'Investment kind' })]);
    assert.deepEqual(await lineChildren(runner, tenantId, line.id), children, 'nothing written by the refusal');

    const result = await opex.changeType(line.id, {
      row_version: check.row_version,
      from_year: 2026,
      analytics_values: { [w.requiredAxis.id]: w.requiredAxis.first, [w.sharedAxis.id]: w.sharedAxis.both },
      reason: 'Capitalised from 2026',
    }, ctx);
    assert.equal(result.nature, 'capex');
    assert.equal(result.predecessor_id, line.id);
    const newId = result.id as string;
    assert.notEqual(newId, line.id, 'a new line');

    // The old line: 2025 only, ended on 31 December 2025, its own children kept.
    const old = (await storedLine(runner, tenantId, line.id))!;
    assert.deepEqual([old.nature, old.item_number, new Date(old.disabled_at!).toISOString(), old.status], ['opex', NUMBER, '2025-12-31T12:00:00.000Z', 'disabled']);
    const oldChildren = await lineChildren(runner, tenantId, line.id);
    assert.deepEqual(oldChildren.versions, [line.versions[2025]], 'the old line keeps 2025');
    for (const key of ['values', 'links', 'attachments', 'contacts', 'applications', 'assets', 'contracts', 'projects', 'requests', 'tasks'] as const) {
      assert.deepEqual(oldChildren[key], children[key], `the old line keeps its ${key}`);
    }
    assert.deepEqual((await versionTotals(runner, tenantId, line.id)), totals.filter((t) => t.startsWith('2025')), 'its 2025 totals unchanged');

    // The new line: CAPEX from 2026, the versions of 2026 and 2027 with everything under them.
    const created = (await storedLine(runner, tenantId, newId))!;
    assert.equal(result.reference, `BL-${created.item_number}`);
    assert.deepEqual(
      [created.nature, created.effective_start, created.disabled_at, created.predecessor_id, created.product_name, created.description],
      ['capex', '2026-01-01', null, line.id, `Line ${NUMBER}`, `Description of ${NUMBER}`],
    );
    assert.match(String(created.legacy_number), /^CPX-\d+$/, 'a CPX number');
    assert.deepEqual([created.account_id, created.cost_center_id], [null, w.costCenterId], 'the OPEX account stays behind, the cost center is copied');
    const newChildren = await lineChildren(runner, tenantId, newId);
    assert.deepEqual(newChildren.versions, [line.versions[2026], line.versions[2027]].sort(), 'the same versions moved');
    const moved = new Set([line.versions[2026], line.versions[2027]]);
    assert.equal(newChildren.amounts.length, 24, 'their months');
    assert.equal(newChildren.allocations.length + oldChildren.allocations.length, children.allocations.length, 'their allocations, same ids');
    assert.deepEqual([...newChildren.allocations, ...oldChildren.allocations].sort(), children.allocations, 'allocations kept by id');
    assert.deepEqual([...newChildren.amounts, ...oldChildren.amounts].sort(), children.amounts, 'months kept by id');
    assert.deepEqual([...newChildren.rounds, ...oldChildren.rounds].sort(), children.rounds, 'the round input kept by id');
    assert.deepEqual(await versionTotals(runner, tenantId, newId), totals.filter((t) => !t.startsWith('2025')), 'their totals');
    assert.equal(moved.size, 2);
    assert.deepEqual(newChildren.values, [`${w.requiredAxis.id}:${w.requiredAxis.first}`, `${w.sharedAxis.id}:${w.sharedAxis.both}`].sort(), 'the values given; the OPEX-only ones not copied');
    for (const key of ['contacts', 'applications', 'assets', 'contracts', 'projects', 'requests'] as const) {
      assert.deepEqual(newChildren[key], children[key], `the new line gets the ${key}`);
    }
    assert.deepEqual([newChildren.links, newChildren.attachments, newChildren.tasks], [[], [], []], 'web links, attachments and tasks stay behind');

    // An audit row on each line, under its own label; each line's meta names the member.
    const [oldRow] = await changeAuditRows(runner, tenantId, line.id);
    const [newRow] = await changeAuditRows(runner, tenantId, newId);
    assert.deepEqual([oldRow.table_name, oldRow.after_json.successor_id, oldRow.after_json.from_year, oldRow.after_json.reason], ['spend_items', newId, 2026, 'Capitalised from 2026']);
    assert.deepEqual([newRow.table_name, newRow.after_json.predecessor_id, newRow.after_json.to_reference], ['capex_items', line.id, created.legacy_number]);
    // What was copied, counted and named per family (no audit row per link).
    assert.deepEqual(newRow.after_json.copied, {
      contacts: { count: 1, items: [{ id: w.contactId, name: 'Con Tact', role: 'commercial' }] },
      applications: { count: 1, items: [{ id: w.applicationId, name: 'Type change app' }] },
      assets: { count: 1, items: [{ id: w.assetId, name: 'Type change asset' }] },
      contracts: { count: 1, items: [{ id: w.contractId, name: 'Type change contract' }] },
      projects: { count: 1, items: [{ id: w.projectId, name: 'PRJ-990301: Type change project' }] },
      requests: { count: 1, items: [{ id: w.requestId, name: 'REQ-990301: Type change request' }] },
    });
    assert.equal((await readBudgetLineMeta(runner.manager, 'opex', tenantId, line.id))?.changed_by?.id, member);
    assert.equal((await readBudgetLineMeta(runner.manager, 'capex', tenantId, newId))?.changed_by?.id, member);

    // Each workspace shows the other line.
    const oldDetail = await opex.get(line.id, ctx);
    assert.deepEqual(oldDetail.lineage, { predecessor: null, successor: { id: newId, reference: result.reference, nature: 'capex', from_year: 2026 } });
    const newDetail = await capex.get(newId, ctx);
    assert.deepEqual(newDetail.lineage, { predecessor: { id: line.id, reference: `BL-${NUMBER}`, nature: 'opex' }, successor: null });

    // One successor per line: the old line offers its first year only.
    const again = await opex.changeTypeCheck(line.id, undefined, ctx);
    assert.deepEqual([again.years, again.dated_refusal, again.successor?.id], [[2025], 'successor', newId], 'continued already: in place only');
    const second = await statusOf(runner, () => opex.changeType(line.id, { row_version: again.row_version, from_year: 2026 }, ctx));
    assert.equal(second.status, 400);
    assert.match(second.body.message, /is already replaced by BL-/);

    // A budget file names the new line by its BL number, as a CAPEX line.
    const file = await preflightBudgetFile(runner.manager, 'capex', tenantId, `nature,item_number,name\ncapex,${result.reference},Line ${NUMBER}\n`);
    assert.deepEqual([file.ok, file.changes.unchanged], [true, 1], JSON.stringify(file.errors));
  });
}

async function testRefusals() {
  await inRolledBackTransaction(async (runner) => {
    const { w, line, ctx, opex } = await seed(runner);
    const tenantId = w.tenantId;
    const rv = async () => Number((await storedLine(runner, tenantId, line.id))!.row_version);
    const values = { [w.requiredAxis.id]: w.requiredAxis.first };
    const refusal = async (body: Record<string, unknown>) => statusOf(runner, async () => opex.changeType(line.id, { row_version: await rv(), analytics_values: values, ...body }, ctx));

    const late = await refusal({ from_year: 2028 });
    assert.deepEqual([late.status, late.body.message], [400, 'This line has no budget from 2028: there is nothing to carry.']);
    const early = await refusal({ from_year: 2024 });
    assert.equal(early.status, 400, 'before the first year');

    // A frozen column in the years that move refuses it; one in the year that stays does not.
    await freezeColumn(runner as any, 'opex', tenantId, 2025, 'budget');
    assert.deepEqual((await opex.changeTypeCheck(line.id, '2026', ctx)).blockers, [], 'the year that stays does not count');
    await freezeColumn(runner as any, 'capex', tenantId, 2027, 'budget');
    assert.deepEqual((await opex.changeTypeCheck(line.id, '2026', ctx)).blockers.map((b: any) => `${b.year} ${b.nature}`), ['2027 capex']);
    const frozen = await refusal({ from_year: 2026 });
    assert.deepEqual([frozen.status, frozen.body.code], [409, 'budget_frozen']);
    assert.equal((await lineChildren(runner, tenantId, line.id)).versions.length, 3, 'nothing moved');
    const inPlace = await opex.changeTypeCheck(line.id, undefined, ctx);
    assert.deepEqual(inPlace.blockers.map((b: any) => `${b.year} ${b.nature}`), ['2025 opex', '2027 capex'], 'in place, every year counts');
  });

  // A line that ends during 2025 offers no later year; one that starts in 2027 neither.
  for (const [label, line, refused] of [
    ['ends', { disabledAt: '2025-06-30T12:00:00Z' }, 'This line ends before 2026: there is nothing to carry.'],
    ['starts', { effectiveStart: '2027-03-01' }, 'This line starts in 2027: change its type from its first year.'],
  ] as const) {
    await inRolledBackTransaction(async (runner) => {
      const { w, line: seeded, ctx, opex } = await seed(runner, line);
      const check = await opex.changeTypeCheck(seeded.id, undefined, ctx);
      assert.deepEqual([check.years, check.dated_refusal], [[2025], label], `${label}: no later year`);
      const answer = await statusOf(runner, () => opex.changeType(seeded.id, { row_version: check.row_version, from_year: 2026, analytics_values: { [w.requiredAxis.id]: w.requiredAxis.first } }, ctx));
      assert.deepEqual([answer.status, answer.body.message], [400, refused]);
    });
  }
}

async function testLaterEndAndCapexSource() {
  // The old line's later end moves to the new line.
  await inRolledBackTransaction(async (runner) => {
    const { w, line, ctx, opex } = await seed(runner, { disabledAt: '2027-06-30T12:00:00Z' });
    const check = await opex.changeTypeCheck(line.id, '2027', ctx);
    const result = await opex.changeType(line.id, { row_version: check.row_version, from_year: 2027, analytics_values: { [w.requiredAxis.id]: w.requiredAxis.second } }, ctx);
    const created = (await storedLine(runner, w.tenantId, result.id))!;
    assert.deepEqual([created.effective_start, new Date(created.disabled_at!).toISOString()], ['2027-01-01', '2027-06-30T12:00:00.000Z']);
    const old = (await storedLine(runner, w.tenantId, line.id))!;
    assert.equal(new Date(old.disabled_at!).toISOString(), '2026-12-31T12:00:00.000Z');
    assert.deepEqual((await lineChildren(runner, w.tenantId, line.id)).versions, [line.versions[2025], line.versions[2026]].sort());
  });

  // A CAPEX line to OPEX from a year: the OPEX line gets the title and description; its tasks stay.
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner);
    const w = await seedTypeChangeWorld(runner, tenantId);
    const member = await seedRoleUser(runner, tenantId, 'member', { budget: 'member', tasks: 'member' });
    const line = await seedTypeChangeLine(runner, w, {
      nature: 'capex', itemNumber: NUMBER + 5, cpx: 77, accountId: w.accounts.any, description: null,
      values: { [w.requiredAxis.id]: w.requiredAxis.first, [w.sharedAxis.id]: w.sharedAxis.both },
    });
    const none = undefined as any;
    const audit = captureAudit();
    const typeChange = typeChangeService(runner);
    const capex = new CapexItemsController(itemService('capex', audit), none, none, none, none, audit as any, none, itemService('opex', audit), typeChange) as any;
    const ctx = { manager: runner.manager, tenantId, userId: member };
    const check = await capex.changeTypeCheck('CPX-77', '2026', ctx);
    assert.deepEqual([check.from_nature, check.to_nature, check.dimensions, check.account.carried], ['capex', 'opex', [], true], 'nothing to ask; the account for both types is copied');
    const result = await capex.changeType('CPX-77', { row_version: check.row_version, from_year: 2026 }, ctx);
    const created = (await storedLine(runner, tenantId, result.id))!;
    assert.deepEqual([created.nature, created.legacy_number, created.account_id, created.product_name], ['opex', null, w.accounts.any, `Line ${NUMBER + 5}`]);
    assert.deepEqual((await lineChildren(runner, tenantId, result.id)).values, [`${w.sharedAxis.id}:${w.sharedAxis.both}`], 'the CAPEX-only dimension stays behind');
    assert.deepEqual((await lineChildren(runner, tenantId, line.id)).tasks, [`${line.taskId}:capex_item`], 'the task stays on the CAPEX line');
  });
}

runSpecs('budget-line-type-change-dated.integration.spec', [
  ['from a later year: the old line ends, a new line of the other type carries the later years', testFromYear],
  ['from a later year: years, ends, starts and freezes that refuse it', testRefusals],
  ['from a later year: a later end moves; a CAPEX line to OPEX', testLaterEndAndCapexSource],
]);
