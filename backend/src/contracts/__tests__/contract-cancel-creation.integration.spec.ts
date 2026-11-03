// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import type { QueryRunner } from 'typeorm';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService, writeAuditLog } from '../../audit/audit.service';
import { issueCreationToken } from '../../common/creation/creation-token';
import { auditedEdit, deletionAuthors, refusedAsExpired } from '../../common/creation/__tests__/creation-cancel.fixtures';
import { applyDataAccess } from '../../data-access/data-access';
import { UserTimeAggregateService } from '../../portfolio/services/user-time-aggregate.service';
import { seedCompany, seedUser } from '../../spend/__tests__/cost-center.fixtures';
import { inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { Contract } from '../contract.entity';
import { ContractsController } from '../contracts.controller';
import { ContractsDeleteService } from '../contracts-delete.service';

// "Cancel" of a contract being created (`DELETE /contracts/:id/creation`, lot V2 of the creation
// frame), as for a budget line being created:
// - its creator deletes it with its token; another person's token, or a contract another person
//   wrote on, is refused (`CREATION_CANCEL_EXPIRED`);
// - a person whose data access is limited, for whom the delete of a contract is reserved (DELETE
//   policy false), deletes the contract they created in their scope: outside the limited role for
//   that delete only, the limited role and mode back afterwards, the attachment files removed only
//   then, the delete audited under them;
// - a contract they may not modify (outside their scope) is not found, and stays, even with a valid
//   token: the lock runs under their access, before the window;
// - a contract another person chose as the contract of a budget line the limited person may not
//   modify is refused (`CREATION_CANCEL_EXPIRED`): the line keeps its contract.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'contract-cancel-creation-spec-secret';

const TODAY = new Date().toISOString().slice(0, 10);

function services(runner: QueryRunner) {
  const audit = new AuditService(runner.manager.getRepository(AuditLog));
  // Each removed file, with the role the transaction ran under at that moment.
  const removed: Array<{ path: string; role: string | null }> = [];
  const storage = {
    deleteObject: async (path: string) => {
      const [row] = await runner.query(`SELECT current_setting('role', true) AS role`);
      removed.push({ path, role: row?.role ?? null });
    },
  };
  const deleteSvc = new ContractsDeleteService(runner.manager.getRepository(Contract), storage as any, audit, new UserTimeAggregateService());
  const controller = Object.create(ContractsController.prototype) as ContractsController;
  Object.assign(controller, { deleteSvc });
  return { controller, removed };
}

type Seed = {
  tenantId: string;
  creatorId: string;
  otherId: string;
  limitedId: string;
  companyId: string;
  otherCompanyId: string;
  supplierId: string;
};

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = await seedTenant(runner, 'contract-creation');
  const tag = tenantId.slice(0, 8);
  const { companyId } = await seedCompany(runner, tenantId, `${tag} company`);
  const { companyId: otherCompanyId } = await seedCompany(runner, tenantId, `${tag} other company`, 6100);
  const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, `${tag} supplier`]);
  const creatorId = await seedUser(runner, tenantId, `creator-${tag}@example.com`);
  const otherId = await seedUser(runner, tenantId, `other-${tag}@example.com`);
  const limitedId = await seedUser(runner, tenantId, `limited-${tag}@example.com`);
  await runner.query(`UPDATE users SET data_access_mode = 'limited' WHERE tenant_id = $1 AND id = $2`, [tenantId, limitedId]);
  await runner.query(
    `INSERT INTO user_data_access_nodes (tenant_id, user_id, node_type, company_id, cost_center_id, access)
     VALUES ($1, $2, 'company', $3, NULL, 'edit')`,
    [tenantId, limitedId, companyId],
  );
  return { tenantId, creatorId, otherId, limitedId, companyId, otherCompanyId, supplierId: supplier.id };
}

function ctx(s: Seed, userId: string, runner: QueryRunner) {
  return { tenantId: s.tenantId, userId, isAdmin: false, manager: runner.manager } as any;
}

/** A contract as its create route leaves it: the row, its `create` entry under `userId`, its token. */
async function created(runner: QueryRunner, s: Seed, userId: string, name: string, companyId = s.companyId) {
  const [row] = await runner.query(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [s.tenantId, name, companyId, s.supplierId, TODAY],
  );
  await writeAuditLog(runner.manager, { table: 'contracts', recordId: row.id, action: 'create', before: null, after: { name }, userId });
  return { id: row.id as string, token: issueCreationToken({ tenantId: s.tenantId, family: 'contracts', recordId: row.id, userId }) };
}

async function contractCount(runner: QueryRunner, s: Seed, id: string): Promise<number> {
  const [row] = await runner.query(`SELECT count(*)::int AS n FROM contracts WHERE tenant_id = $1 AND id = $2`, [s.tenantId, id]);
  return row.n;
}

async function testCreatorCancels() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner);
    await setTenant(runner, s.tenantId);
    const { controller } = services(runner);
    const asCreator = ctx(s, s.creatorId, runner);

    const contract = await created(runner, s, s.creatorId, 'Cancelled');
    const foreign = issueCreationToken({ tenantId: s.tenantId, family: 'contracts', recordId: contract.id, userId: s.otherId });
    await refusedAsExpired(controller.cancelCreation(contract.id, { token: foreign }, asCreator), 'another person\'s token');
    await refusedAsExpired(controller.cancelCreation(contract.id, {}, asCreator), 'no token');
    await controller.cancelCreation(contract.id, { token: contract.token }, asCreator);
    assert.equal(await contractCount(runner, s, contract.id), 0, 'the contract is gone');
    assert.deepEqual(await deletionAuthors(runner, s.tenantId, 'contracts', contract.id), [s.creatorId], 'audited under its creator');

    const shared = await created(runner, s, s.creatorId, 'Shared');
    await auditedEdit(runner, 'contracts', shared.id, s.otherId);
    await refusedAsExpired(controller.cancelCreation(shared.id, { token: shared.token }, asCreator), 'another person wrote on it');
    assert.equal(await contractCount(runner, s, shared.id), 1, 'the contract another person wrote on stays');
  });
}

async function testLimitedPerson() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner);
    await setTenant(runner, s.tenantId);
    // Outside their scope, made before their access applies, with a token of theirs all the same.
    const outside = await created(runner, s, s.limitedId, 'Outside', s.otherCompanyId);
    // In their scope, chosen by another person as the contract of a line outside it.
    const named = await created(runner, s, s.limitedId, 'Named elsewhere');
    const [line] = await runner.query(
      `INSERT INTO spend_items (tenant_id, nature, item_number, product_name, currency, effective_start, paying_company_id, contract_id)
       VALUES ($1, 'opex', 990001, 'Elsewhere', 'EUR', $2, $3, $4) RETURNING id`,
      [s.tenantId, TODAY, s.otherCompanyId, named.id],
    );
    const { controller, removed } = services(runner);
    const asLimited = ctx(s, s.limitedId, runner);
    // Rolled back to at the end: the owner's role comes back with it, to read what stayed.
    await runner.query('SAVEPOINT before_access');
    assert.equal(await applyDataAccess(runner, s.limitedId), 'limited');

    const contract = await created(runner, s, s.limitedId, 'Placed');
    const kept = await created(runner, s, s.limitedId, 'Kept');

    // The delete itself stays refused to the limited role (DELETE policy false)...
    await runner.query('SAVEPOINT direct_delete');
    const deleted = await runner.query(`WITH gone AS (DELETE FROM contracts WHERE id = $1 RETURNING 1) SELECT count(*)::int AS n FROM gone`, [contract.id]);
    await runner.query('ROLLBACK TO SAVEPOINT direct_delete');
    assert.equal(deleted[0].n, 0, 'the limited role deletes no contract');

    // ...and the creator's cancel deletes it, for that contract only.
    const file = `contracts/${contract.id}/terms.pdf`;
    await runner.query(
      `INSERT INTO contract_attachments (tenant_id, contract_id, original_filename, stored_filename, storage_path)
       VALUES ($1, $2, 'terms.pdf', 'terms.pdf', $3)`,
      [s.tenantId, contract.id, file],
    );
    await controller.cancelCreation(contract.id, { token: contract.token }, asLimited);
    assert.deepEqual(removed, [{ path: file, role: 'kanap_data_limited' }], 'its file is removed once the limited role is back');
    const [state] = await runner.query(`SELECT current_setting('role', true) AS role, current_setting('app.da_mode', true) AS mode`);
    assert.deepEqual(state, { role: 'kanap_data_limited', mode: 'limited' }, 'the limited access is back after the cancel');
    assert.equal(await contractCount(runner, s, contract.id), 0, 'the contract is gone');
    assert.equal(await contractCount(runner, s, kept.id), 1, 'the other contract stays');
    assert.deepEqual(await deletionAuthors(runner, s.tenantId, 'contracts', contract.id), [s.limitedId], 'audited under its creator');

    // A line outside their scope names one of their contracts (another person chose it): the cancel,
    // which would clear it, is refused, and the line keeps its contract.
    await refusedAsExpired(controller.cancelCreation(named.id, { token: named.token }, asLimited), 'a line outside their scope names it');
    assert.equal(await contractCount(runner, s, named.id), 1, 'the contract named by the line stays');
    assert.deepEqual(await runner.query(`SELECT current_setting('role', true) AS role`), [{ role: 'kanap_data_limited' }], 'the limited role is back after the refusal');

    // A contract they may not modify is not found, before the window: it stays.
    await assert.rejects(controller.cancelCreation(outside.id, { token: outside.token }, asLimited), NotFoundException);
    const [after] = await runner.query(`SELECT current_setting('role', true) AS role`);
    assert.equal(after.role, 'kanap_data_limited', 'the limited role stays');
    await runner.query('ROLLBACK TO SAVEPOINT before_access');
    assert.equal(await contractCount(runner, s, outside.id), 1, 'the contract outside their scope stays');
    assert.deepEqual(await deletionAuthors(runner, s.tenantId, 'contracts', outside.id), [], 'and no delete is recorded');
    const [lineAfter] = await runner.query(`SELECT contract_id FROM spend_items WHERE tenant_id = $1 AND id = $2`, [s.tenantId, line.id]);
    assert.equal(lineAfter.contract_id, named.id, 'the line outside their scope keeps its contract');
  });
}

void runSpecs('contract-cancel-creation.integration.spec', [
  ['creator cancels, others refused', testCreatorCancels],
  ['limited person', testLimitedPerson],
]);
