import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import dataSource from '../../data-source';
import { ContractsService } from '../contracts.service';

// A contract whose supplier is missing (left by migration 1854070000000 under a NOT VALID key)
// stays repairable: an edit of another field saves, choosing an existing supplier saves, a
// missing supplier is refused. The NOT VALID key refuses a new contract naming a missing
// supplier. One transaction, rolled back.

const none = undefined as any;
const service = new ContractsService(
  none, none, none, none,
  { log: async () => undefined } as any,
  none, none,
  { syncFromSupplier: async () => undefined } as any,
  none, none,
);

/**
 * The contract is committed first, as a real one is: PostgreSQL checks an unchanged key on an
 * update only for a row inserted by the same transaction.
 */
async function seedCommitted() {
  const tenantId = randomUUID();
  await dataSource.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Orphan repair', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `orphan-repair-${tenantId.slice(0, 8)}`],
  );
  return dataSource.transaction(async (manager) => {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const [{ id: companyId }] = await manager.query(
      `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Repair company', 'FR', 'Lyon') RETURNING id`, [tenantId]);
    const [{ id: goneId }] = await manager.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Gone supplier') RETURNING id`, [tenantId]);
    const [{ id: supplierId }] = await manager.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Repair supplier') RETURNING id`, [tenantId]);
    const [{ id: contractId }] = await manager.query(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, 'Orphan contract', $2, $3, '2024-01-01') RETURNING id`,
      [tenantId, companyId, goneId],
    );
    return { tenantId, companyId, goneId, supplierId, contractId };
  });
}

async function cleanup(tenantId: string) {
  await dataSource.transaction(async (manager) => {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    for (const table of ['contracts', 'suppliers', 'companies', 'search_index']) {
      await manager.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
    }
  });
  await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
}

async function testOrphanContractIsRepairable() {
  const seed = await seedCommitted();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const { tenantId, companyId, goneId, supplierId, contractId } = seed;
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    // The state the migration leaves: the contract's supplier gone, its key NOT VALID.
    await runner.query(`ALTER TABLE contracts DROP CONSTRAINT IF EXISTS fk_contracts_supplier`);
    await runner.query(`DELETE FROM suppliers WHERE id = $1`, [goneId]);
    await runner.query(
      `ALTER TABLE contracts ADD CONSTRAINT fk_contracts_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT NOT VALID`,
    );

    const opts = { manager: runner.manager };
    const renamed = await service.update(contractId, { name: 'Orphan contract, renamed' } as any, undefined, opts);
    assert.equal(renamed.name, 'Orphan contract, renamed', 'another field saves');

    await runner.query('SAVEPOINT missing');
    await assert.rejects(
      service.update(contractId, { supplier_id: randomUUID() } as any, undefined, opts),
      (err: unknown) => err instanceof BadRequestException && err.message === 'Supplier not found.',
    );
    await runner.query('ROLLBACK TO SAVEPOINT missing');

    const repaired = await service.update(contractId, { supplier_id: supplierId } as any, undefined, opts);
    assert.equal(repaired.supplier_id, supplierId, 'an existing supplier saves');

    await runner.query('SAVEPOINT raw');
    await assert.rejects(
      runner.query(
        `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, 'New orphan', $2, $3, '2024-01-01')`,
        [tenantId, companyId, randomUUID()],
      ),
      (err: any) => err?.code === '23503' && err?.constraint === 'fk_contracts_supplier',
      'the NOT VALID key refuses a new contract naming a missing supplier',
    );
    await runner.query('ROLLBACK TO SAVEPOINT raw');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await cleanup(seed.tenantId);
  }
}

async function main() {
  await dataSource.initialize();
  try {
    await testOrphanContractIsRepairable();
  } finally {
    await dataSource.destroy();
  }
  console.log('contract-orphan-repair.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
