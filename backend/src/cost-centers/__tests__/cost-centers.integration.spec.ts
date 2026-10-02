import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { resolveItemWrite } from '../../spend/item-write.util';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { CompaniesDeleteService } from '../../companies/companies-delete.service';
import { Company } from '../../companies/company.entity';
import { ReferenceCheckService } from '../../common/reference-check.service';
import {
  backendPid,
  closeRunner,
  committed,
  context,
  deleteTenant,
  expectRefused,
  openTenantTransaction,
  seedCompany,
  seedLine,
  seedTenant,
  seedUser,
  services,
  waitUntilBlocked,
  withRollback,
} from './cost-center-test-helpers';

// The cost center tree against a real database: the per-row CHECKs, the tree
// rules of the service (one graph validation for every write), deletes and
// disables, the audit of a code rename, the list and tree reads, and the two
// races the locks exist for (reparenting, and a line assignment against a
// conversion to group).

async function seedBasics(runner: QueryRunner, tag: string) {
  const tenantId = await seedTenant(runner, tag);
  const paris = await seedCompany(runner, tenantId, 'Test company Paris');
  const brussels = await seedCompany(runner, tenantId, 'Test company Brussels');
  const { svc, del } = services(runner.manager);
  const ctx = context(runner.manager, tenantId);
  return { tenantId, paris, brussels, svc, del, ctx };
}

async function testCompanyByKind() {
  await withRollback(async (runner) => {
    const { tenantId, paris, svc, ctx } = await seedBasics(runner, 'kind');

    await expectRefused(runner, /A cost center needs a company/, () =>
      svc.create({ code: 'CC-1', kind: 'cost_center', name: 'No company' }, ctx));
    await expectRefused(runner, /A group has no company/, () =>
      svc.create({ code: 'G-1', kind: 'group', name: 'Group with company', company_id: paris }, ctx));

    // The database refuses the same thing when the service is bypassed.
    await expectRefused(runner, /cost_centers_company_by_kind_check/, () => runner.query(
      `INSERT INTO cost_centers (tenant_id, code, kind, name) VALUES ($1, 'RAW-1', 'cost_center', 'Raw')`,
      [tenantId],
    ));
    await expectRefused(runner, /cost_centers_company_by_kind_check/, () => runner.query(
      `INSERT INTO cost_centers (tenant_id, code, kind, name, company_id) VALUES ($1, 'RAW-2', 'group', 'Raw', $2)`,
      [tenantId, paris],
    ));
    await expectRefused(runner, /cost_centers_code_check/, () => runner.query(
      `INSERT INTO cost_centers (tenant_id, code, kind, name) VALUES ($1, ' RAW-3', 'group', 'Raw')`,
      [tenantId],
    ));

    // A standalone cost center needs no parent.
    const standalone = await svc.create({ code: 'CC-2', kind: 'cost_center', name: 'Standalone', company_id: paris }, ctx);
    assert.equal(standalone.parent_id, null);
    assert.equal(standalone.company_id, paris);
    assert.equal(standalone.company_name, 'Test company Paris');
    assert.equal(standalone.depth, 0);

    // Turning a cost center into a group drops its company.
    const group = await svc.update(standalone.id, { kind: 'group' }, ctx);
    assert.equal(group.kind, 'group');
    assert.equal(group.company_id, null);
    // And back: the company must come with it.
    await expectRefused(runner, /A cost center needs a company/, () => svc.update(standalone.id, { kind: 'cost_center' }, ctx));
    const back = await svc.update(standalone.id, { kind: 'cost_center', company_id: paris }, ctx);
    assert.equal(back.kind, 'cost_center');
  });
}

async function testGroupSpansCompanies() {
  await withRollback(async (runner) => {
    const { paris, brussels, svc, ctx } = await seedBasics(runner, 'span');
    const group = await svc.create({ code: 'GRP', kind: 'group', name: 'Group IT' }, ctx);
    const a = await svc.create({ code: 'GRP-FR', kind: 'cost_center', name: 'France', company_id: paris, parent_id: group.id }, ctx);
    const b = await svc.create({ code: 'GRP-BE', kind: 'cost_center', name: 'Belgium', company_id: brussels, parent_id: group.id }, ctx);
    const { items } = await svc.tree(ctx);
    assert.deepEqual(items.map((node) => node.code), ['GRP', 'GRP-BE', 'GRP-FR'], 'tree order: parent, then siblings by code');
    const byId = new Map(items.map((node) => [node.id, node]));
    assert.equal(byId.get(a.id)!.path, 'Group IT › France');
    assert.deepEqual(byId.get(b.id)!.path_ids, [group.id, b.id]);
    assert.equal(byId.get(b.id)!.company_name, 'Test company Brussels');
    assert.equal(byId.get(b.id)!.depth, 1);
  });
}

async function testOnlyGroupsAreParents() {
  await withRollback(async (runner) => {
    const { paris, svc, ctx } = await seedBasics(runner, 'parent');
    const leaf = await svc.create({ code: 'LEAF', kind: 'cost_center', name: 'Leaf', company_id: paris }, ctx);
    await expectRefused(runner, /Only a group can be a parent\. LEAF is a cost center/, () =>
      svc.create({ code: 'CHILD', kind: 'cost_center', name: 'Child', company_id: paris, parent_id: leaf.id }, ctx));
    await expectRefused(runner, /Parent group not found/, () =>
      svc.create({ code: 'ORPHAN', kind: 'group', name: 'Orphan', parent_id: randomUUID() }, ctx));
  });
}

async function testSelfParentAndCycles() {
  await withRollback(async (runner) => {
    const { svc, ctx } = await seedBasics(runner, 'cycle');
    const top = await svc.create({ code: 'TOP', kind: 'group', name: 'Top' }, ctx);
    const mid = await svc.create({ code: 'MID', kind: 'group', name: 'Middle', parent_id: top.id }, ctx);
    const low = await svc.create({ code: 'LOW', kind: 'group', name: 'Low', parent_id: mid.id }, ctx);

    await expectRefused(runner, /A node cannot be its own parent/, () => svc.update(top.id, { parent_id: top.id }, ctx));
    await expectRefused(runner, /Top cannot move under Low, which is inside it/, () => svc.update(top.id, { parent_id: low.id }, ctx));
    await expectRefused(runner, /Top cannot move under Middle, which is inside it/, () => svc.update(top.id, { parent_id: mid.id }, ctx));
    // The database refuses a self-reference on its own.
    await expectRefused(runner, /cost_centers_not_own_parent_check/, () => runner.query(
      `UPDATE cost_centers SET parent_id = id WHERE tenant_id = $1 AND id = $2`,
      [ctx.tenantId, top.id],
    ));

    // Moving a branch elsewhere is fine; a disabled group can still hold nodes.
    await svc.update(mid.id, { status: 'disabled' }, ctx);
    const moved = await svc.update(low.id, { parent_id: null }, ctx);
    assert.equal(moved.depth, 0);
    const back = await svc.update(low.id, { parent_id: mid.id }, ctx);
    assert.equal(back.path, 'Top › Middle › Low');
    assert.equal(back.parent_name, 'Middle');
  });
}

async function testKindChangesAgainstContent() {
  await withRollback(async (runner) => {
    const { tenantId, paris, svc, ctx } = await seedBasics(runner, 'convert');
    const group = await svc.create({ code: 'IT', kind: 'group', name: 'IT department' }, ctx);
    const used = await svc.create({ code: 'IT-300', kind: 'cost_center', name: 'Service desk', company_id: paris, parent_id: group.id }, ctx);
    await seedLine(runner, 'opex', tenantId, used.id);
    await seedLine(runner, 'opex', tenantId, used.id);
    await seedLine(runner, 'capex', tenantId, used.id);

    await expectRefused(
      runner,
      /IT-300 is used by 2 OPEX lines and 1 CAPEX line\. A cost center used by budget lines cannot become a group/,
      () => svc.update(used.id, { kind: 'group' }, ctx),
    );
    await expectRefused(
      runner,
      /IT department still contains 1 node\. A group that contains nodes cannot become a cost center/,
      () => svc.update(group.id, { kind: 'cost_center', company_id: paris }, ctx),
    );
    const detail = await svc.get(used.id, ctx);
    assert.equal(detail.opex_count, 2);
    assert.equal(detail.capex_count, 1);
  });
}

async function testDeleteAndDisable() {
  await withRollback(async (runner) => {
    const { tenantId, paris, svc, del, ctx } = await seedBasics(runner, 'delete');
    const group = await svc.create({ code: 'IT', kind: 'group', name: 'IT department' }, ctx);
    const sub = await svc.create({ code: 'IT-SUB', kind: 'group', name: 'IT sub', parent_id: group.id }, ctx);
    const used = await svc.create({ code: 'IT-300', kind: 'cost_center', name: 'Service desk', company_id: paris, parent_id: sub.id }, ctx);
    const free = await svc.create({ code: 'IT-400', kind: 'cost_center', name: 'Free', company_id: paris, parent_id: group.id }, ctx);
    const opex = await seedLine(runner, 'opex', tenantId, used.id);
    await seedLine(runner, 'opex', tenantId, used.id);
    await seedLine(runner, 'opex', tenantId, used.id);
    await seedLine(runner, 'capex', tenantId, used.id);

    await expectRefused(runner, /IT-300 is used by 3 OPEX lines and 1 CAPEX line\. Disable it instead\./, () => del.delete(used.id, ctx));
    await expectRefused(runner, /IT department still contains 2 nodes\. Move or delete them first\./, () => del.delete(group.id, ctx));

    // Disabling is allowed, touches neither the lines nor the descendants.
    const disabled = await svc.update(used.id, { status: 'disabled' }, ctx);
    assert.equal(disabled.status, 'disabled');
    assert.ok(disabled.disabled_at);
    const [line] = await runner.query(`SELECT cost_center_id FROM spend_items WHERE tenant_id = $1 AND id = $2`, [tenantId, opex]);
    assert.equal(line.cost_center_id, used.id, 'the line keeps its disabled cost center');
    const disabledGroup = await svc.update(sub.id, { status: 'disabled' }, ctx);
    assert.equal(disabledGroup.status, 'disabled');
    const afterGroup = await svc.get(used.id, ctx);
    assert.equal(afterGroup.disabled_at, disabled.disabled_at, 'disabling a group leaves its content as it was');
    // Re-enabling clears the end of validity.
    const enabled = await svc.update(used.id, { status: 'enabled' }, ctx);
    assert.equal(enabled.status, 'enabled');
    assert.equal(enabled.disabled_at, null);

    // A free node goes, with its audit row.
    await del.delete(free.id, ctx);
    const [audit] = await runner.query(
      `SELECT action, before_json->>'code' AS code FROM audit_log WHERE tenant_id = $1 AND table_name = 'cost_centers' AND record_id = $2 AND action = 'delete'`,
      [tenantId, free.id],
    );
    assert.equal(audit?.code, 'IT-400');
    await expectRefused(runner, /Cost center not found/, () => del.delete(free.id, ctx));
  });
}

async function testBulkDeleteKeepsGoing() {
  await withRollback(async (runner) => {
    const { tenantId, paris, svc, del, ctx } = await seedBasics(runner, 'bulk');
    const group = await svc.create({ code: 'G', kind: 'group', name: 'Group' }, ctx);
    const used = await svc.create({ code: 'USED', kind: 'cost_center', name: 'Used', company_id: paris }, ctx);
    const freeA = await svc.create({ code: 'FREE-A', kind: 'cost_center', name: 'Free A', company_id: paris, parent_id: group.id }, ctx);
    const freeB = await svc.create({ code: 'FREE-B', kind: 'cost_center', name: 'Free B', company_id: paris }, ctx);
    const boom = await svc.create({ code: 'BOOM', kind: 'group', name: 'Boom' }, ctx);
    await seedLine(runner, 'capex', tenantId, used.id);
    // A database error inside one delete (a trigger stands in for a race on a
    // foreign key): without a savepoint it would abort the whole transaction.
    const fn = `cc_test_fail_${randomUUID().replace(/-/g, '')}`;
    await runner.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'simulated database failure'; END $$`);
    await runner.query(`CREATE TRIGGER ${fn} BEFORE DELETE ON cost_centers FOR EACH ROW
      WHEN (OLD.code = 'BOOM') EXECUTE FUNCTION ${fn}()`);

    // The group is listed before its content: deeper nodes go first, so both are deleted.
    const unknown = randomUUID();
    const result = await del.bulkDelete([group.id, used.id, boom.id, freeA.id, freeB.id, unknown, 'not-an-id'], ctx);
    assert.deepEqual(result.deleted.sort(), [group.id, freeA.id, freeB.id].sort());
    assert.equal(result.failed.length, 4);
    const failure = (id: string) => result.failed.find((entry) => entry.id === id);
    assert.equal(failure(used.id)?.name, 'USED · Used');
    assert.match(failure(used.id)?.reason ?? '', /USED is used by 1 CAPEX line\. Disable it instead\./);
    assert.equal(failure(boom.id)?.name, 'BOOM · Boom', 'the name is read after the rollback to the savepoint');
    assert.match(failure(boom.id)?.reason ?? '', /simulated database failure/);
    assert.equal(failure(unknown)?.name, 'Unknown');
    assert.equal(failure('not-an-id')?.reason, 'Cost center not found.');

    // The transaction is still usable and the deletes really happened.
    const rows = await runner.query(`SELECT code FROM cost_centers WHERE tenant_id = $1 ORDER BY code`, [tenantId]);
    assert.deepEqual(rows.map((row: any) => row.code), ['BOOM', 'USED']);
  });
}

async function testCodes() {
  await withRollback(async (runner) => {
    const { tenantId, paris, svc, ctx } = await seedBasics(runner, 'codes');
    const userId = await seedUser(runner, tenantId, `cc-${randomUUID().slice(0, 8)}@example.test`);
    const node = await svc.create({ code: '  IT-100  ', kind: 'cost_center', name: '  Infrastructure ', company_id: paris }, { ...ctx, userId });
    assert.equal(node.code, 'IT-100');
    assert.equal(node.name, 'Infrastructure');
    await expectRefused(runner, /A cost center with code it-100 already exists/, () =>
      svc.create({ code: 'it-100', kind: 'group', name: 'Duplicate' }, ctx));
    await expectRefused(runner, /Code is required/, () => svc.create({ code: '   ', kind: 'group', name: 'Blank' }, ctx));
    await expectRefused(runner, /Code must be 50 characters or fewer/, () =>
      svc.create({ code: 'X'.repeat(51), kind: 'group', name: 'Long' }, ctx));
    await expectRefused(runner, /control or invisible characters/, () =>
      svc.create({ code: 'IT\u200b200', kind: 'group', name: 'Zero width' }, ctx));
    await expectRefused(runner, /Name must be 200 characters or fewer/, () =>
      svc.create({ code: 'LONG', kind: 'group', name: 'N'.repeat(201) }, ctx));

    // A rename is an ordinary audited update; lines follow by id.
    const line = await seedLine(runner, 'opex', tenantId, node.id);
    const renamed = await svc.update(node.id, { code: 'IT-110' }, { ...ctx, userId });
    assert.equal(renamed.code, 'IT-110');
    const [audit] = await runner.query(
      `SELECT before_json->>'code' AS before_code, after_json->>'code' AS after_code, user_id
       FROM audit_log WHERE tenant_id = $1 AND table_name = 'cost_centers' AND record_id = $2 AND action = 'update'`,
      [tenantId, node.id],
    );
    assert.equal(audit.before_code, 'IT-100');
    assert.equal(audit.after_code, 'IT-110');
    assert.equal(audit.user_id, userId);
    const [stored] = await runner.query(`SELECT cost_center_id FROM spend_items WHERE tenant_id = $1 AND id = $2`, [tenantId, line]);
    assert.equal(stored.cost_center_id, node.id);

    // A no-op update writes no audit row.
    await svc.update(node.id, { code: 'IT-110', name: 'Infrastructure' }, ctx);
    const [{ n }] = await runner.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND table_name = 'cost_centers' AND record_id = $2`,
      [tenantId, node.id],
    );
    assert.equal(n, 2, 'create + one rename');
  });
}

async function testOwnersAndCompanies() {
  await withRollback(async (runner) => {
    const { tenantId, paris, svc, ctx } = await seedBasics(runner, 'owner');
    const active = await seedUser(runner, tenantId, `cc-on-${randomUUID().slice(0, 8)}@example.test`);
    const inactive = await seedUser(runner, tenantId, `cc-off-${randomUUID().slice(0, 8)}@example.test`, 'disabled');
    const closed = await seedCompany(runner, tenantId, 'Closed company', { disabled: true });

    const node = await svc.create({ code: 'OWN', kind: 'cost_center', name: 'Owned', company_id: paris, owner_user_id: active }, ctx);
    assert.equal(node.owner_user_id, active);
    assert.ok(node.owner_name);
    await expectRefused(runner, /The owner must be an active user/, () => svc.update(node.id, { owner_user_id: inactive }, ctx));
    await expectRefused(runner, /Owner not found/, () => svc.update(node.id, { owner_user_id: randomUUID() }, ctx));
    await expectRefused(runner, /This company is disabled/, () => svc.update(node.id, { company_id: closed }, ctx));
    await expectRefused(runner, /Company not found/, () => svc.update(node.id, { company_id: randomUUID() }, ctx));

    // A stored owner that has been disabled since stays valid on later edits.
    await runner.query(`UPDATE users SET status = 'disabled' WHERE tenant_id = $1 AND id = $2`, [tenantId, active]);
    const renamed = await svc.update(node.id, { name: 'Owned, renamed' }, ctx);
    assert.equal(renamed.owner_user_id, active);
    const cleared = await svc.update(node.id, { owner_user_id: null }, ctx);
    assert.equal(cleared.owner_user_id, null);
  });
}

async function testListReadsAsTheTree() {
  await withRollback(async (runner) => {
    const { paris, brussels, svc, ctx } = await seedBasics(runner, 'list');
    const it = await svc.create({ code: 'IT', kind: 'group', name: 'IT department' }, ctx);
    await svc.create({ code: 'IT-200', kind: 'cost_center', name: 'Applications', company_id: paris, parent_id: it.id }, ctx);
    await svc.create({ code: 'IT-100', kind: 'cost_center', name: 'Infrastructure', company_id: paris, parent_id: it.id }, ctx);
    const lg = await svc.create({ code: 'LG-10', kind: 'cost_center', name: 'Logistics IT', company_id: brussels }, ctx);
    await svc.update(lg.id, { status: 'disabled' }, ctx);

    const all = await svc.list({ includeDisabled: '1' }, ctx);
    assert.deepEqual(all.items.map((row: any) => row.code), ['IT', 'IT-100', 'IT-200', 'LG-10'], 'default sort is the tree order');
    assert.equal(all.items[1].parent_code, 'IT');
    assert.equal(all.items[1].parent_name, 'IT department');

    const enabledOnly = await svc.list({}, ctx);
    assert.deepEqual(enabledOnly.items.map((row: any) => row.code), ['IT', 'IT-100', 'IT-200'], 'disabled nodes are out by default');
    const disabledOnly = await svc.list({ status: 'disabled' }, ctx);
    assert.deepEqual(disabledOnly.items.map((row: any) => row.code), ['LG-10']);

    const groups = await svc.list({ includeDisabled: '1', filters: JSON.stringify({ kind: { filterType: 'set', values: ['group'] } }) }, ctx);
    assert.deepEqual(groups.items.map((row: any) => row.code), ['IT']);
    const byCompany = await svc.list({ includeDisabled: '1', filters: { company_name: { filterType: 'set', values: ['Test company Brussels'] } } }, ctx);
    assert.deepEqual(byCompany.items.map((row: any) => row.code), ['LG-10']);
    const noParent = await svc.list({ includeDisabled: '1', filters: { parent_name: { filterType: 'set', values: [null] } } }, ctx);
    assert.deepEqual(noParent.items.map((row: any) => row.code), ['IT', 'LG-10']);

    // q matches code, name and path: a group's name finds its content.
    const search = await svc.list({ q: 'it department' }, ctx);
    assert.deepEqual(search.items.map((row: any) => row.code), ['IT', 'IT-100', 'IT-200']);
    const byName = await svc.list({ includeDisabled: '1', sort: 'name:DESC' }, ctx);
    assert.deepEqual(byName.items.map((row: any) => row.name), ['Logistics IT', 'IT department', 'Infrastructure', 'Applications']);
    const paged = await svc.list({ includeDisabled: '1', page: '2', limit: '3' }, ctx);
    assert.equal(paged.total, 4);
    assert.deepEqual(paged.items.map((row: any) => row.code), ['LG-10']);

    const ids = await svc.listIds({ includeDisabled: '1', sort: 'path:DESC' }, ctx);
    assert.equal(ids.total, 4);
    assert.equal(ids.ids[0], lg.id);
    assert.equal(ids.ids[3], it.id);

    const detail = await svc.get(it.id, ctx);
    assert.equal(detail.opex_count, 0);
    assert.equal(detail.description, null);
  });
}

/** A company that cost centers belong to is refused readably, single and bulk; the key backs it. */
async function testCompanyUsedByCostCenters() {
  await withRollback(async (runner) => {
    const { tenantId, paris, brussels, svc, ctx } = await seedBasics(runner, 'company');
    const spare = await seedCompany(runner, tenantId, 'Test company Spare');
    await svc.create({ code: 'P-1', kind: 'cost_center', name: 'Paris one', company_id: paris }, ctx);
    await svc.create({ code: 'P-2', kind: 'cost_center', name: 'Paris two', company_id: paris }, ctx);
    await svc.create({ code: 'B-1', kind: 'cost_center', name: 'Brussels one', company_id: brussels }, ctx);
    const audit = new AuditService(runner.manager.getRepository(AuditLog));
    const companies = new CompaniesDeleteService(runner.manager.getRepository(Company), audit, new ReferenceCheckService());
    const opts = { manager: runner.manager, userId: null };

    await expectRefused(runner, /^Test company Paris is used by 2 cost centers\. Change their company or disable it instead\.$/, () =>
      companies.delete(paris, opts));
    const bulk = await companies.bulkDelete([brussels, spare], null, { manager: runner.manager });
    assert.deepEqual(bulk.deleted, [spare]);
    assert.deepEqual(bulk.failed, [{
      id: brussels,
      name: 'Test company Brussels',
      reason: 'Test company Brussels is used by 1 cost center. Change their company or disable it instead.',
    }]);
    const left = await runner.query(`SELECT name FROM companies WHERE tenant_id = $1 ORDER BY name`, [tenantId]);
    assert.deepEqual(left.map((row: any) => row.name), ['Test company Brussels', 'Test company Paris']);
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM cost_centers WHERE tenant_id = $1`, [tenantId]);
    assert.equal(n, 3, 'the cost centers are untouched');

    // Without the check, the database key (ON DELETE RESTRICT) refuses, reported in plain words.
    const unchecked = new CompaniesDeleteService(
      runner.manager.getRepository(Company),
      audit,
      { assertNoReferences: async () => undefined } as unknown as ReferenceCheckService,
    );
    await expectRefused(runner, /^Cannot delete company "Test company Paris": cost centers still use it\. You can disable it instead\.$/, () =>
      unchecked.delete(paris, opts));
  });
}

// ---------------------------------------------------------------- races ----

async function seedRaceTenant(tag: string) {
  return committed(async (runner) => {
    const tenantId = await seedTenant(runner, tag);
    const company = await seedCompany(runner, tenantId, 'Race company');
    const { svc } = services(runner.manager);
    const ctx = context(runner.manager, tenantId);
    const a = await svc.create({ code: 'A', kind: 'group', name: 'Group A' }, ctx);
    const b = await svc.create({ code: 'B', kind: 'group', name: 'Group B' }, ctx);
    const leaf = await svc.create({ code: 'LEAF', kind: 'cost_center', name: 'Leaf', company_id: company }, ctx);
    const line = await seedLine(runner, 'opex', tenantId, null);
    return { tenantId, a: a.id, b: b.id, leaf: leaf.id, line };
  });
}

/** A under B and B under A at the same time: the lock serializes them and the second sees the loop. */
async function testConcurrentReparenting() {
  const seed = await seedRaceTenant('reparent');
  const t1 = await openTenantTransaction(seed.tenantId);
  const t2 = await openTenantTransaction(seed.tenantId);
  try {
    const one = services(t1.manager).svc.update(seed.a, { parent_id: seed.b }, context(t1.manager, seed.tenantId));
    await one;
    const pid = await backendPid(t2);
    let secondSettled = false;
    const two = services(t2.manager).svc
      .update(seed.b, { parent_id: seed.a }, context(t2.manager, seed.tenantId))
      .finally(() => { secondSettled = true; });
    const twoOutcome = two.then(() => 'ok', (err: any) => err);
    await waitUntilBlocked(pid);
    assert.equal(secondSettled, false, 'the second reparenting waits for the first');
    await t1.commitTransaction();
    const outcome = await twoOutcome;
    assert.notEqual(outcome, 'ok', 'exactly one reparenting succeeds');
    assert.match(String(outcome?.message), /Group B cannot move under Group A, which is inside it/);
    await t2.rollbackTransaction();

    const rows = await dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [seed.tenantId]);
      return manager.query(`SELECT code, parent_id FROM cost_centers WHERE tenant_id = $1 AND code IN ('A', 'B') ORDER BY code`, [seed.tenantId]);
    });
    assert.deepEqual(rows.map((row: any) => [row.code, row.parent_id]), [['A', seed.b], ['B', null]]);
  } finally {
    await closeRunner(t1);
    await closeRunner(t2);
    await deleteTenant(seed.tenantId);
  }
}

type Assignment = { outcome: 'assigned' } | { outcome: 'refused'; message: string };

/**
 * The item side of D8 through the real gate: `resolveItemWrite` reads the node
 * FOR SHARE and refuses a group; the resolved values are then written, as the
 * item services do. If the gate stops locking, the conversion-first race lets
 * a line onto a group and the spec fails.
 */
async function assignLine(runner: QueryRunner, tenantId: string, lineId: string, nodeId: string): Promise<Assignment> {
  const [existingLine] = await runner.query(`SELECT * FROM spend_items WHERE tenant_id = $1 AND id = $2`, [tenantId, lineId]);
  assert.ok(existingLine, 'the race line exists');
  let values: Record<string, unknown>;
  try {
    ({ values } = await resolveItemWrite(runner.manager, 'opex', { cost_center_id: nodeId }, existingLine));
  } catch (err) {
    if (err instanceof BadRequestException) return { outcome: 'refused', message: err.message };
    throw err;
  }
  // Column names come from the gate's writable list (cost_center_id, and the company it fills).
  const columns = Object.keys(values);
  await runner.query(
    `UPDATE spend_items SET ${columns.map((column, index) => `${column} = $${index + 3}`).join(', ')} WHERE tenant_id = $1 AND id = $2`,
    [tenantId, lineId, ...columns.map((column) => values[column])],
  );
  return { outcome: 'assigned' };
}

async function testAssignmentBeforeConversion() {
  const seed = await seedRaceTenant('assign-first');
  const t1 = await openTenantTransaction(seed.tenantId);
  const t2 = await openTenantTransaction(seed.tenantId);
  try {
    assert.deepEqual(await assignLine(t1, seed.tenantId, seed.line, seed.leaf), { outcome: 'assigned' });
    const pid = await backendPid(t2);
    const conversion = services(t2.manager).svc
      .update(seed.leaf, { kind: 'group' }, context(t2.manager, seed.tenantId))
      .then(() => 'ok', (err: any) => err);
    await waitUntilBlocked(pid);
    await t1.commitTransaction();
    const outcome = await conversion;
    assert.notEqual(outcome, 'ok', 'the conversion waits for the assignment and then refuses');
    assert.match(String(outcome?.message), /LEAF is used by 1 OPEX line\. A cost center used by budget lines cannot become a group/);
    await t2.rollbackTransaction();
    const [line] = await dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [seed.tenantId]);
      return manager.query(
        `SELECT si.cost_center_id, si.paying_company_id, cc.kind, cc.company_id
           FROM spend_items si JOIN cost_centers cc ON cc.tenant_id = si.tenant_id AND cc.id = si.cost_center_id
          WHERE si.tenant_id = $1 AND si.id = $2`,
        [seed.tenantId, seed.line],
      );
    });
    assert.equal(line?.kind, 'cost_center', 'the line sits on a cost center that stayed one');
    assert.equal(line?.paying_company_id, line?.company_id, 'the gate filled the company from the cost center');
  } finally {
    await closeRunner(t1);
    await closeRunner(t2);
    await deleteTenant(seed.tenantId);
  }
}

async function testConversionBeforeAssignment() {
  const seed = await seedRaceTenant('convert-first');
  const t1 = await openTenantTransaction(seed.tenantId);
  const t2 = await openTenantTransaction(seed.tenantId);
  try {
    const converted = await services(t2.manager).svc.update(seed.leaf, { kind: 'group' }, context(t2.manager, seed.tenantId));
    assert.equal(converted.kind, 'group');
    const pid = await backendPid(t1);
    const assignment = assignLine(t1, seed.tenantId, seed.line, seed.leaf);
    await waitUntilBlocked(pid);
    await t2.commitTransaction();
    const result = await assignment;
    assert.equal(result.outcome, 'refused', 'the assignment waits for the conversion and then sees a group');
    assert.match(result.outcome === 'refused' ? result.message : '', /Choose a cost center, not a group/);
    await t1.rollbackTransaction();
  } finally {
    await closeRunner(t1);
    await closeRunner(t2);
    await deleteTenant(seed.tenantId);
  }
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [
      testCompanyByKind,
      testGroupSpansCompanies,
      testOnlyGroupsAreParents,
      testSelfParentAndCycles,
      testKindChangesAgainstContent,
      testDeleteAndDisable,
      testBulkDeleteKeepsGoing,
      testCodes,
      testOwnersAndCompanies,
      testListReadsAsTheTree,
      testCompanyUsedByCostCenters,
      testConcurrentReparenting,
      testAssignmentBeforeConversion,
      testConversionBeforeAssignment,
    ]) {
      try {
        await test();
      } catch (err) {
        failures.push(`${test.name}: ${(err as Error).message.split('\n')[0]}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`cost-centers.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('cost-centers.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
