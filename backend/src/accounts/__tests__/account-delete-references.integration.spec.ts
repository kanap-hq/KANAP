import 'dotenv/config';
import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AccountsDeleteService } from '../accounts-delete.service';
import { Account } from '../account.entity';
import { ReferenceCheckService } from '../../common/reference-check.service';
import { seedCompany } from '../../spend/__tests__/cost-center.fixtures';
import { assert, captureAudit, inRolledBackTransaction, runSpecs, setTenant } from '../../spend/__tests__/round-inputs.fixtures';

// An account used by budget lines cannot be deleted, whatever the lines' nature: the refusal (409)
// names the OPEX and the CAPEX lines. Since lot Z1 the CAPEX lines are in spend_items, whose
// account key has no delete action; the old capex_items key was ON DELETE SET NULL, so a delete
// detached the CAPEX lines from their account in silence. It is refused instead, and the line keeps
// its account. An account no line uses is deleted.

async function seedTenant(runner: QueryRunner, tag: string): Promise<string> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Account delete', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `acct-del-${tag}-${tenantId.slice(0, 8)}`],
  );
  await setTenant(runner, tenantId);
  return tenantId;
}

async function seedLine(runner: QueryRunner, tenantId: string, nature: 'opex' | 'capex', itemNumber: number, companyId: string, accountId: string) {
  const capex = nature === 'capex';
  const [row] = await runner.query(
    `INSERT INTO spend_items (tenant_id, nature, item_number, legacy_number, product_name, ppe_type, investment_type, priority,
                              currency, effective_start, paying_company_id, account_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'EUR', '2024-01-01', $9, $10) RETURNING id`,
    [
      tenantId, nature, itemNumber, `${capex ? 'CPX' : 'OPX'}-${itemNumber}`, `${nature} line ${itemNumber}`,
      capex ? 'hardware' : null, capex ? 'replacement' : null, capex ? 'medium' : null, companyId, accountId,
    ],
  );
  return row.id as string;
}

function deleteService(runner: QueryRunner) {
  return new AccountsDeleteService(runner.manager.getRepository(Account), captureAudit() as any, new ReferenceCheckService());
}

async function refusal(runner: QueryRunner, fn: () => Promise<unknown>): Promise<Error> {
  await runner.query('SAVEPOINT account_delete');
  try {
    await fn();
  } catch (error) {
    return error as Error;
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT account_delete');
  }
  throw new Error('the delete should have been refused');
}

async function testCapexLinesBlockTheDelete() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'capex');
    const { companyId, accountId } = await seedCompany(runner, tenantId, 'Delete company');
    const lineId = await seedLine(runner, tenantId, 'capex', 1, companyId, accountId);
    const references = new ReferenceCheckService();

    assert.deepEqual(
      await references.checkAccountReferences(accountId, { manager: runner.manager }),
      { hasReferences: true, referenceDetails: ['1 CAPEX item(s) reference this account'], totalCount: 1 },
      'a CAPEX line is a reference of its account',
    );
    const error = await refusal(runner, () => deleteService(runner).delete(accountId, { manager: runner.manager }));
    assert.ok(error instanceof ConflictException, `a 409 (${error.message})`);
    assert.equal(
      error.message,
      'Cannot delete account "6000 - Delete company account": 1 CAPEX item(s) reference this account. Please disable instead or remove references first.',
    );
    const [line] = await runner.query(`SELECT account_id FROM spend_items WHERE id = $1`, [lineId]);
    assert.equal(line.account_id, accountId, 'the CAPEX line keeps its account');

    const bulk = await deleteService(runner).bulkDelete([accountId], null, { manager: runner.manager });
    assert.deepEqual(bulk.deleted, [], 'the bulk delete keeps it too');
    assert.match(bulk.failed[0]?.reason ?? '', /1 CAPEX item\(s\) reference this account/);
  });
}

async function testBothNaturesNamed() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'both');
    const { companyId, accountId } = await seedCompany(runner, tenantId, 'Both company');
    await seedLine(runner, tenantId, 'opex', 1, companyId, accountId);
    await seedLine(runner, tenantId, 'opex', 2, companyId, accountId);
    await seedLine(runner, tenantId, 'capex', 3, companyId, accountId);
    const error = await refusal(runner, () => deleteService(runner).delete(accountId, { manager: runner.manager }));
    assert.equal(
      error.message,
      'Cannot delete account "6000 - Both company account": 2 OPEX item(s) reference this account; 1 CAPEX item(s) reference this account. Please disable instead or remove references first.',
    );
  });
}

async function testUnusedAccountIsDeleted() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'unused');
    const { accountId } = await seedCompany(runner, tenantId, 'Unused company');
    await deleteService(runner).delete(accountId, { manager: runner.manager });
    assert.deepEqual(await runner.query(`SELECT id FROM accounts WHERE id = $1`, [accountId]), [], 'an account no line uses goes');
  });
}

void runSpecs('account-delete-references.integration.spec', [
  ['testCapexLinesBlockTheDelete', testCapexLinesBlockTheDelete],
  ['testBothNaturesNamed', testBothNaturesNamed],
  ['testUnusedAccountIsDeleted', testUnusedAccountIsDeleted],
]);

// `dataSource` is imported so the CI runner schedules this spec on a database lane.
void dataSource;
