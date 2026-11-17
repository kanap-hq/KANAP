import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../data-source';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { Supplier } from '../../suppliers/supplier.entity';
import { SupplierContactsService } from '../../suppliers/supplier-contacts.service';
import { ContactsService } from '../contacts.service';
import { ExternalContact } from '../external-contact.entity';
import { SupplierContactLink } from '../supplier-contact.entity';

// Lot I4 of 26.11.9: two imports of the same contact at once, one moving it to another supplier, the
// other changing its role. `ContactsService.update` locks the contact's row first, so the second
// waits for the first and reads its links: one primary link at the end.

const upload = (lines: string[]) => ({ buffer: Buffer.from(`${lines.join('\n')}\n`, 'utf8'), originalname: 'i.csv' }) as any;

async function session(tenantId: string) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const manager = runner.manager;
  const audit = new AuditService(manager.getRepository(AuditLog));
  const contacts = new ContactsService(
    manager.getRepository(ExternalContact),
    manager.getRepository(SupplierContactLink),
    manager.getRepository(Supplier),
    new SupplierContactsService(manager.getRepository(SupplierContactLink), audit),
    audit,
  );
  const run = (lines: string[]) => contacts.importCsv(
    { file: upload(lines), dryRun: false, language: 'en', mode: 'enrich', access: { isAdmin: true, levels: {} } } as any,
    { manager, tenantId, userId: null },
  );
  return { runner, run };
}

async function deleteRaceTenant(tenantId: string) {
  await dataSource.transaction(async (manager) => {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    for (const table of ['supplier_contacts', 'contacts', 'suppliers', 'audit_log']) {
      await manager.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
    }
  });
  await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
}

async function main() {
  await dataSource.initialize();
  const tenantId = randomUUID();
  try {
    const setup = await session(tenantId);
    await setup.runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Contacts race', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `contacts-race-${tenantId.slice(0, 8)}`],
    );
    const [one] = await setup.runner.query(`INSERT INTO suppliers (tenant_id, name, item_number) VALUES ($1, 'One', 1) RETURNING id`, [tenantId]);
    await setup.runner.query(`INSERT INTO suppliers (tenant_id, name, item_number) VALUES ($1, 'Two', 2)`, [tenantId]);
    const [contact] = await setup.runner.query(
      `INSERT INTO contacts (tenant_id, email, supplier_id, item_number) VALUES ($1, 'c@x.com', $2, 1) RETURNING id`,
      [tenantId, one.id],
    );
    await setup.runner.query(
      `INSERT INTO supplier_contacts (tenant_id, supplier_id, contact_id, role, is_primary) VALUES ($1, $2, $3, 'commercial', true)`,
      [tenantId, one.id, contact.id],
    );
    await setup.runner.commitTransaction();
    await setup.runner.release();

    const a = await session(tenantId);
    const b = await session(tenantId);
    try {
      const moved = await a.run(['email;supplier_name', 'c@x.com;Two']);
      assert.equal(moved.updated, 1, 'A moves the contact to Two');
      let bDone = false;
      const roleChange = b.run(['email;supplier_role', 'c@x.com;technical']).then((result) => {
        bDone = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      assert.equal(bDone, false, 'B waits for A on the contact row');
      await a.runner.commitTransaction();
      const changed = await roleChange;
      assert.deepEqual(changed.errors, []);
      await b.runner.commitTransaction();
    } finally {
      for (const s of [a, b]) {
        if (s.runner.isTransactionActive) await s.runner.rollbackTransaction();
        await s.runner.release();
      }
    }

    const links = await dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      return manager.query(
        `SELECT s.name, l.role, l.is_primary FROM supplier_contacts l JOIN suppliers s ON s.id = l.supplier_id
          WHERE l.tenant_id = $1 AND l.is_primary ORDER BY s.name`,
        [tenantId],
      );
    });
    assert.deepEqual(links, [{ name: 'Two', role: 'technical', is_primary: true }], 'one primary link, on the supplier A set, with the role B set');
  } finally {
    await deleteRaceTenant(tenantId);
    await dataSource.destroy();
  }
  console.log('contacts-import-race.integration.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
