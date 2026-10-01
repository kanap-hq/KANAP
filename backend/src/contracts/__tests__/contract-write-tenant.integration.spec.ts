import 'dotenv/config';
import { BadRequestException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { ContractsService } from '../contracts.service';
import { seedCompany, seedUser } from '../../spend/__tests__/cost-center.fixtures';
import { assert, captureAudit, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';

// A contract create or update resolves the company, supplier and owner it
// names in the session tenant, like resolveItemWrite does for OPEX and CAPEX:
// an id of another tenant is refused as "<Field> not found." and nothing is
// written; id, tenant_id and timestamps in a body are ignored.

type Refs = { tenantId: string; companyId: string; supplierId: string; userId: string };

async function seedRefs(runner: QueryRunner, tag: string): Promise<Refs> {
  const tenantId = await seedTenant(runner, tag);
  const { companyId } = await seedCompany(runner, tenantId, `${tag} company`);
  const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, `${tag} supplier`]);
  const userId = await seedUser(runner, tenantId, `${tag}-${tenantId.slice(0, 8)}@example.com`);
  return { tenantId, companyId, supplierId: supplier.id, userId };
}

function contracts(): ContractsService {
  const args: any[] = Array.from({ length: 9 }, () => undefined);
  args[4] = captureAudit();
  args[7] = { syncFromSupplier: async () => undefined };
  return new (ContractsService as any)(...args);
}

function body(refs: Refs, extra: Record<string, unknown> = {}) {
  return {
    name: 'Tenant contract',
    company_id: refs.companyId,
    supplier_id: refs.supplierId,
    owner_user_id: refs.userId,
    start_date: '2026-01-01',
    ...extra,
  } as any;
}

async function refusal(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof BadRequestException) return err.message;
    throw err;
  }
  throw new Error('expected a refusal');
}

async function testForeignIdsRefused() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seedRefs(runner, 'contract-a');
    const b = await seedRefs(runner, 'contract-b');
    await setTenant(runner, b.tenantId);
    const svc = contracts();
    const opts = { manager: runner.manager };
    const count = async () => (await runner.query(`SELECT count(*)::int AS n FROM contracts WHERE tenant_id = $1`, [b.tenantId]))[0].n;

    const own = await svc.create(body(b), b.userId, opts);
    const stored = (await runner.query(`SELECT * FROM contracts WHERE id = $1`, [own.id]))[0];
    assert.equal(stored.tenant_id, b.tenantId);

    for (const [field, id, message] of [
      ['company_id', a.companyId, 'Company not found.'],
      ['supplier_id', a.supplierId, 'Supplier not found.'],
      ['owner_user_id', a.userId, 'Owner not found.'],
      ['owner_user_id', 'not-a-uuid', 'Owner not found.'],
    ] as const) {
      assert.equal(await refusal(() => svc.create(body(b, { [field]: id }), b.userId, opts)), message, `create ${field}`);
      assert.equal(await refusal(() => svc.update(own.id, { [field]: id } as any, b.userId, opts)), message, `update ${field}`);
    }
    assert.equal(await count(), 1, 'nothing is written by a refused call');
    const after = (await runner.query(`SELECT company_id, supplier_id, owner_user_id FROM contracts WHERE id = $1`, [own.id]))[0];
    assert.deepEqual(after, { company_id: b.companyId, supplier_id: b.supplierId, owner_user_id: b.userId }, 'the stored contract is unchanged');

    // Identity, tenant and timestamps in a body are ignored.
    const updated = await svc.update(own.id, { tenant_id: a.tenantId, id: a.companyId, notes: 'Edited' } as any, b.userId, opts);
    assert.equal(updated.notes, 'Edited');
    const row = (await runner.query(`SELECT id, tenant_id FROM contracts WHERE id = $1`, [own.id]))[0];
    assert.deepEqual(row, { id: own.id, tenant_id: b.tenantId });

    // An owner can be cleared.
    await svc.update(own.id, { owner_user_id: null } as any, b.userId, opts);
    assert.equal((await runner.query(`SELECT owner_user_id FROM contracts WHERE id = $1`, [own.id]))[0].owner_user_id, null);
  });
}

void runSpecs('contract-write-tenant.integration.spec', [
  ['testForeignIdsRefused', testForeignIdsRefused],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
