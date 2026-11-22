// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import type { QueryRunner } from 'typeorm';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { issueCreationToken } from '../../common/creation/creation-token';
import { deletionAuthors, refusedAsExpired } from '../../common/creation/__tests__/creation-cancel.fixtures';
import { applyDataAccess } from '../../data-access/data-access';
import { withCreatorCancelAccess } from '../../data-access/creator-cancel-access';
import { UserTimeAggregateService } from '../../portfolio/services/user-time-aggregate.service';
import { BudgetLinesController } from '../budget-lines.controller';
import { BudgetLinesService } from '../budget-lines.service';
import { CapexItemsDeleteService, SpendItemsDeleteService } from '../spend-items-delete.service';
import { SpendItem } from '../spend-item.entity';
import { itemService, refusal, seedCompany, seedCostCenter, seedUser } from './cost-center.fixtures';
import { deps } from './budget-lines.fixtures';
import { inRolledBackTransaction, runSpecs, seedTenant, setTenant } from './round-inputs.fixtures';

// A budget line is created complete, from the screen's draft (lot L3a, decision D36):
// - `POST /budget-lines` writes it with its company, account and required dimensions, and hands its
//   creator a token; the routes of the creation at the title are gone (`POST /budget-lines/creation`,
//   `POST :id/creation/complete`: no route answers them), and the item service's `creation` option
//   exempts nothing any more;
// - an update may leave a line stored without company without one, and may never clear the company a
//   line holds;
// - `GET :id/creation` counts what was written since; `DELETE :id/creation` deletes the line for its
//   creator at the member level; another person, another line's token, none or an expired one is
//   refused (`CREATION_CANCEL_EXPIRED`), and so is a line another person wrote on or that a line
//   continues; the creator's own edits keep the cancel open; the service checks the token itself;
// - a person whose data access is limited: a line placed outside the access is refused, on their
//   company it is created with its token, and the cancel deletes the line (outside the limited role
//   for that delete only), the limited role and mode back afterwards, the attachment files removed
//   only then; the window refuses a person other than the one whose access the transaction runs under.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'budget-line-creation-spec-secret';

const TODAY = new Date().toISOString().slice(0, 10);

function services(runner: QueryRunner) {
  const audit = new AuditService(runner.manager.getRepository(AuditLog));
  // Each removed file, with the role the transaction ran under at that moment.
  const deleted: Array<{ path: string; role: string | null }> = [];
  const storage = {
    deleteObject: async (path: string) => {
      const [row] = await runner.query(`SELECT current_setting('role', true) AS role`);
      deleted.push({ path, role: row?.role ?? null });
    },
  };
  const args: any[] = [runner.manager.getRepository(SpendItem), undefined, undefined, undefined, audit, storage, new UserTimeAggregateService()];
  const svc = new BudgetLinesService(
    deps.allocationCalculator as any,
    deps.fxRates as any,
    new (SpendItemsDeleteService as any)(...args),
    new (CapexItemsDeleteService as any)(...args),
    itemService('opex', audit) as any,
    itemService('capex', audit) as any,
    audit as any,
  );
  const controller = Object.create(BudgetLinesController.prototype) as BudgetLinesController;
  Object.assign(controller, { svc });
  return { svc, controller, deleted };
}

type Seed = {
  tenantId: string;
  creatorId: string;
  otherId: string;
  limitedId: string;
  companyId: string;
  accountId: string;
  otherCompanyId: string;
  otherAccountId: string;
  axisId: string;
  categoryId: string;
};

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = await seedTenant(runner, 'line-creation');
  const tag = tenantId.slice(0, 8);
  const { companyId, accountId } = await seedCompany(runner, tenantId, `${tag} company`);
  const { companyId: otherCompanyId, accountId: otherAccountId } = await seedCompany(runner, tenantId, `${tag} other company`, 6100);
  await seedCostCenter(runner, tenantId, { code: `CC-${tag}`, name: 'Centre', companyId });
  const creatorId = await seedUser(runner, tenantId, `creator-${tag}@example.com`);
  const otherId = await seedUser(runner, tenantId, `other-${tag}@example.com`);
  const limitedId = await seedUser(runner, tenantId, `limited-${tag}@example.com`);
  await runner.query(`UPDATE users SET data_access_mode = 'limited' WHERE tenant_id = $1 AND id = $2`, [tenantId, limitedId]);
  await runner.query(
    `INSERT INTO user_data_access_nodes (tenant_id, user_id, node_type, company_id, cost_center_id, access)
     VALUES ($1, $2, 'company', $3, NULL, 'edit')`,
    [tenantId, limitedId, companyId],
  );
  const [axis] = await runner.query(
    `INSERT INTO analytics_axes (tenant_id, code, name, required) VALUES ($1, 'menu', 'Menu', true) RETURNING id`,
    [tenantId],
  );
  const [category] = await runner.query(
    `INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, 'Starter') RETURNING id`,
    [tenantId, axis.id],
  );
  return { tenantId, creatorId, otherId, limitedId, companyId, accountId, otherCompanyId, otherAccountId, axisId: axis.id, categoryId: category.id };
}

function ctx(s: Seed, userId: string, runner: QueryRunner) {
  return { tenantId: s.tenantId, userId, isAdmin: false, manager: runner.manager } as any;
}

/** A complete line: its company, its account and its value on the required dimension. */
function lineBody(s: Seed, name: string, extra: Record<string, unknown> = {}) {
  return {
    nature: 'opex',
    product_name: name,
    currency: 'EUR',
    effective_start: TODAY,
    paying_company_id: s.companyId,
    account_id: s.accountId,
    analytics_values: { [s.axisId]: s.categoryId },
    ...extra,
  };
}

/** The POST routes of the controller that would answer `path` (relative to `/budget-lines`). */
function postRoutesAnswering(path: string): string[] {
  const proto = BudgetLinesController.prototype as any;
  return Object.getOwnPropertyNames(proto).filter((name) => {
    if (name === 'constructor' || typeof proto[name] !== 'function') return false;
    const route = Reflect.getMetadata(PATH_METADATA, proto[name]);
    if (typeof route !== 'string' || Reflect.getMetadata(METHOD_METADATA, proto[name]) !== RequestMethod.POST) return false;
    const pattern = new RegExp(`^${route.replace(/^\/+|\/+$/g, '').split('/').map((part) => (part.startsWith(':') ? '[^/]+' : part)).join('/')}$`);
    return pattern.test(path);
  });
}

async function lineCount(runner: QueryRunner, s: Seed, id: string): Promise<number> {
  const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM spend_items WHERE tenant_id = $1 AND id = $2`, [s.tenantId, id]);
  return n;
}

function testRoutesNeedTheMemberLevel() {
  for (const method of ['create', 'creationChanges', 'cancelCreation'] as const) {
    const meta = Reflect.getMetadata(REQUIRE_LEVEL_KEY, (BudgetLinesController.prototype as any)[method]);
    assert.deepEqual(meta, { resource: 'budget', level: 'member' }, `${method} needs budget:member`);
  }
}

// The routes of the creation at the title are gone: Nest answers 404 to a path no route matches.
function testTitleRoutesAreGone() {
  assert.deepEqual(postRoutesAnswering('creation'), [], 'no route answers POST /budget-lines/creation');
  assert.deepEqual(postRoutesAnswering('3f1c2b9e-1d2a-4c3b-9e8f-0a1b2c3d4e5f/creation/complete'), [], 'no route answers POST /budget-lines/:id/creation/complete');
  assert.deepEqual(postRoutesAnswering(''), ['create'], 'POST /budget-lines is the one create route');
}

async function testCompleteCreationAndCancel() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner);
    const { svc, controller } = services(runner);
    const asCreator = ctx(s, s.creatorId, runner);
    const { nature: _nature, ...opexFields } = lineBody(s, 'Exempted');

    // A line is complete from its creation, whatever the caller asks: the option of the creation at
    // the title exempts nothing any more.
    const items = itemService('opex');
    const untitled = await refusal(runner, () => items.create({ ...opexFields, paying_company_id: undefined, account_id: undefined, analytics_values: undefined }, s.creatorId, { manager: runner.manager, fields: 'columns', native: true, creation: true }));
    assert.match(untitled.message, /Paying company is required/, 'no company: refused, even with the old option');
    const accountless = await refusal(runner, () => items.create({ ...opexFields, account_id: undefined }, s.creatorId, { manager: runner.manager, fields: 'columns', native: true, creation: true }));
    assert.equal(accountless.message, 'Account is required.', 'no account: refused, even with the old option');
    const valueless = await refusal(runner, () => items.create({ ...opexFields, analytics_values: undefined }, s.creatorId, { manager: runner.manager, fields: 'columns', native: true, creation: true }));
    assert.match(valueless.message, /Menu dimension is required/, 'no value on a required dimension: refused, even with the old option');

    // The complete line: written with everything, and a token for its creator.
    const created: any = await controller.create(lineBody(s, 'Monitoring', { notes: 'Written with the line' }), asCreator);
    assert.equal(typeof created.creation_token, 'string', 'a creation token');
    assert.ok(created.item_number > 0, 'a reference');
    const [row] = await runner.query(`SELECT * FROM spend_items WHERE id = $1`, [created.id]);
    assert.deepEqual(
      [row.paying_company_id, row.account_id, row.notes, row.product_name],
      [s.companyId, s.accountId, 'Written with the line', 'Monitoring'],
    );
    const other: any = await controller.create(lineBody(s, 'Another'), asCreator);

    // A held company is never cleared.
    await svc.update(created.id, { description: 'Typed after the creation' }, s.creatorId, { manager: runner.manager });
    const cleared = await refusal(runner, () => svc.update(created.id, { paying_company_id: null }, s.creatorId, { manager: runner.manager }));
    assert.match(cleared.message, /Paying company is required/, 'a held company cannot be cleared');

    // What was written since the creation.
    const changes: any = await controller.creationChanges(created.id, created.creation_token, asCreator);
    assert.ok(changes.changes.fields >= 1, `fields changed since the creation: ${JSON.stringify(changes)}`);
    const fresh: any = await controller.creationChanges(other.id, other.creation_token, asCreator);
    assert.deepEqual(fresh, { changes: { fields: 0, children: {} } }, 'nothing written on the other line');

    // Refused: another person, another line's token, none, an expired one, a reference instead of the id.
    await refusedAsExpired(controller.creationChanges(created.id, created.creation_token, ctx(s, s.otherId, runner)), 'other user, preflight');
    await refusedAsExpired(controller.cancelCreation(created.id, { token: created.creation_token }, ctx(s, s.otherId, runner)), 'other user');
    await refusedAsExpired(controller.cancelCreation(created.id, { token: other.creation_token }, asCreator), 'other line');
    await refusedAsExpired(controller.cancelCreation(created.id, {}, asCreator), 'no token');
    await refusedAsExpired(controller.cancelCreation(`BL-${created.item_number}`, { token: created.creation_token }, asCreator), 'a reference');
    const expired = issueCreationToken(
      { tenantId: s.tenantId, family: 'spend_items', recordId: created.id, userId: s.creatorId },
      { now: Date.now() - 25 * 60 * 60 * 1000 },
    );
    await refusedAsExpired(controller.cancelCreation(created.id, { token: expired }, asCreator), 'expired token');

    // The service checks the token itself: a direct call without the creator's token opens nothing.
    await refusedAsExpired(svc.cancelCreation(created.id, 'not-a-token', s.creatorId, { manager: runner.manager }), 'service, bad token');
    await refusedAsExpired(svc.cancelCreation(created.id, created.creation_token, s.otherId, { manager: runner.manager }), 'service, other person');

    // Another person wrote on the other line: its creator's cancel is over (preflight and cancel).
    await svc.update(other.id, { notes: 'Seen by a colleague' }, s.otherId, { manager: runner.manager });
    await refusedAsExpired(controller.creationChanges(other.id, other.creation_token, asCreator), 'another author, preflight');
    await refusedAsExpired(controller.cancelCreation(other.id, { token: other.creation_token }, asCreator), 'another author');

    // A line that another line continues: its delete would unlink it, so the cancel is over too.
    const continued: any = await controller.create(lineBody(s, 'Continued'), asCreator);
    const successor: any = await controller.create(lineBody(s, 'Successor'), asCreator);
    await runner.query(`UPDATE spend_items SET predecessor_id = $3 WHERE tenant_id = $1 AND id = $2`, [s.tenantId, successor.id, continued.id]);
    await refusedAsExpired(controller.creationChanges(continued.id, continued.creation_token, asCreator), 'successor, preflight');
    await refusedAsExpired(controller.cancelCreation(continued.id, { token: continued.creation_token }, asCreator), 'successor');
    assert.equal(await lineCount(runner, s, continued.id), 1, 'the continued line stays');

    // The creator, a budget member (no admin), cancels it: their own edits keep the cancel open.
    await controller.cancelCreation(created.id, { token: created.creation_token }, asCreator);
    assert.equal(await lineCount(runner, s, created.id), 0, 'the line is gone');
    assert.deepEqual(await deletionAuthors(runner, s.tenantId, 'spend_items', created.id), [s.creatorId], 'the delete is audited under its creator');
    assert.equal(await lineCount(runner, s, other.id), 1, 'the other line stays');
  });
}

// A line stored without company (left by the creation at the title of earlier versions) stays editable.
async function testStoredLineWithoutCompanyStillUpdates() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner);
    const { svc } = services(runner);
    const [row] = await runner.query(
      `INSERT INTO spend_items (tenant_id, nature, product_name, currency, effective_start, status, item_number)
       VALUES ($1, 'opex', 'Left at its title', 'EUR', $2, 'enabled', (SELECT COALESCE(MAX(item_number), 0) + 1 FROM spend_items WHERE tenant_id = $1))
       RETURNING id`,
      [s.tenantId, TODAY],
    );
    const edited: any = await svc.update(row.id, { notes: 'Still editable', paying_company_id: null }, s.creatorId, { manager: runner.manager });
    assert.deepEqual([edited.notes, edited.paying_company_id ?? null], ['Still editable', null], 'a company-less line takes edits and stays without company');
    const placed: any = await svc.update(row.id, { paying_company_id: s.companyId, account_id: s.accountId }, s.creatorId, { manager: runner.manager });
    assert.deepEqual([placed.paying_company_id, placed.account_id], [s.companyId, s.accountId], 'then it is completed');
  });
}

async function testLimitedPerson() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner);
    const { controller, deleted: removedFiles } = services(runner);
    const asLimited = ctx(s, s.limitedId, runner);
    await setTenant(runner, s.tenantId);
    assert.equal(await applyDataAccess(runner, s.limitedId), 'limited');

    // A company outside the access: refused by the placement rule; on their company: created, with a token.
    const elsewhere = await refusal(runner, () => controller.create(lineBody(s, 'Elsewhere', { paying_company_id: s.otherCompanyId, account_id: s.otherAccountId }), asLimited));
    assert.equal((elsewhere as any).getResponse?.()?.code, 'DATA_ACCESS_LIMITED', `placement refusal, got ${elsewhere.message}`);
    const created: any = await controller.create(lineBody(s, 'Placed'), asLimited);
    assert.equal(created.paying_company_id, s.companyId);
    assert.equal(typeof created.creation_token, 'string', 'a creation token for a limited person too');

    // The delete itself stays refused to the limited role (DELETE policy false)...
    await runner.query('SAVEPOINT direct_delete');
    const deleted = await runner.query(`WITH gone AS (DELETE FROM spend_items WHERE id = $1 RETURNING 1) SELECT count(*)::int AS n FROM gone`, [created.id]);
    await runner.query('ROLLBACK TO SAVEPOINT direct_delete');
    assert.equal(deleted[0].n, 0, 'the limited role deletes no line');

    // ...and the creator's cancel deletes it, for that line only.
    const kept: any = await controller.create(lineBody(s, 'Kept'), asLimited);
    const file = `spend/${created.id}/quote.pdf`;
    await runner.query(
      `INSERT INTO spend_attachments (tenant_id, spend_item_id, original_filename, stored_filename, storage_path)
       VALUES ($1, $2, 'quote.pdf', 'quote.pdf', $3)`,
      [s.tenantId, created.id, file],
    );
    await controller.cancelCreation(created.id, { token: created.creation_token }, asLimited);
    assert.deepEqual(removedFiles, [{ path: file, role: 'kanap_data_limited' }], 'its file is removed once the limited role is back');
    const [state] = await runner.query(`SELECT current_setting('role', true) AS role, current_setting('app.da_mode', true) AS mode`);
    assert.deepEqual(state, { role: 'kanap_data_limited', mode: 'limited' }, 'the limited access is back after the cancel');
    assert.equal(await lineCount(runner, s, created.id), 0, 'the line is gone');
    assert.equal(await lineCount(runner, s, kept.id), 1, 'the other line stays');
    assert.deepEqual(await deletionAuthors(runner, s.tenantId, 'spend_items', created.id), [s.limitedId], 'audited under its creator');

    // Another person's token for this line is refused before anything.
    const foreign = issueCreationToken({ tenantId: s.tenantId, family: 'spend_items', recordId: kept.id, userId: s.creatorId });
    await refusedAsExpired(controller.cancelCreation(kept.id, { token: foreign }, asLimited), 'another person\'s token');

    // The window is the person's own: for anyone else than the one whose access applies, it throws
    // before leaving the limited role.
    let ran = false;
    await assert.rejects(
      withCreatorCancelAccess(runner.manager, s.creatorId, async () => {
        ran = true;
      }),
      /not the person's/,
    );
    assert.equal(ran, false, 'nothing ran in the window');
    const [after] = await runner.query(`SELECT current_setting('role', true) AS role`);
    assert.equal(after.role, 'kanap_data_limited', 'the limited role stays');
  });
}

void runSpecs('budget-line-cancel-creation.integration.spec', [
  ['routes need the member level', async () => testRoutesNeedTheMemberLevel()],
  ['the routes of the creation at the title are gone', async () => testTitleRoutesAreGone()],
  ['a line created complete, its token, its cancel', testCompleteCreationAndCancel],
  ['a stored line without company still takes edits', testStoredLineWithoutCompanyStillUpdates],
  ['limited person', testLimitedPerson],
]);
