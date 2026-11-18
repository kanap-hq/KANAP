import 'reflect-metadata';
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { INestApplication, Module } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { NestFactory } from '@nestjs/core';
import dataSource from '../../data-source';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { Supplier } from '../supplier.entity';
import { SuppliersController } from '../suppliers.controller';
import { SuppliersService } from '../suppliers.service';
import { SuppliersDeleteService } from '../suppliers-delete.service';
import { SupplierContactsService } from '../supplier-contacts.service';

// POST /suppliers/import through the real controller, the real service and Nest's HTTP stack
// (lot I4 of 26.11.9, D21): the route always applies the clearing rule. A file of two columns
// updates without clearing anything, `-` clears, and a `mode` in the address changes nothing
// (`replace` would clear a blank cell). The route's guards (authentication, rights) are taken
// off the controller for this process: their own specs cover them. Everything runs in one
// transaction on a tenant of its own, rolled back at the end.

async function main() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  let app: INestApplication | null = null;
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Import clear', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `import-clear-http-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const service = new SuppliersService(runner.manager.getRepository(Supplier), new AuditService(runner.manager.getRepository(AuditLog)));

    Reflect.defineMetadata(GUARDS_METADATA, [], SuppliersController);
    for (const name of Object.getOwnPropertyNames(SuppliersController.prototype)) {
      const handler = (SuppliersController.prototype as any)[name];
      if (typeof handler === 'function') Reflect.defineMetadata(GUARDS_METADATA, [], handler);
    }
    @Module({
      controllers: [SuppliersController],
      providers: [
        { provide: SuppliersService, useValue: service },
        { provide: SuppliersDeleteService, useValue: {} },
        { provide: SupplierContactsService, useValue: {} },
      ],
    })
    class ImportClearProbeModule {}
    app = await NestFactory.create(ImportClearProbeModule, { logger: false, abortOnError: false });
    app.use((req: any, _res: any, next: () => void) => {
      req.tenant = { id: tenantId, slug: 'import-clear', name: 'Import clear' };
      req.user = { sub: null };
      req.queryRunner = runner;
      next();
    });
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    const post = async (lines: string[], query: string) => {
      const form = new FormData();
      form.append('file', new Blob([`${lines.join('\n')}\n`], { type: 'text/csv' }), 'suppliers.csv');
      const res = await fetch(`http://127.0.0.1:${port}/suppliers/import?language=en${query}`, { method: 'POST', body: form });
      const body = await res.json() as any;
      assert.equal(res.status, 201, JSON.stringify(body));
      assert.equal(body.ok, true, JSON.stringify(body.errors));
      return [body.inserted, body.updated, body.unchanged, body.cleared];
    };
    const read = async () => (await runner.query(
      `SELECT erp_supplier_id, notes FROM suppliers WHERE tenant_id = $1 AND name = 'Acme'`,
      [tenantId],
    ))[0];

    assert.deepEqual(await post(['name;erp_supplier_id;notes', 'Acme;ERP-1;Kept'], '&dryRun=false'), [1, 0, 0, 0]);
    // Two columns: the other values stay.
    assert.deepEqual(await post(['name;notes', 'Acme;New'], '&dryRun=false'), [0, 1, 0, 0]);
    assert.deepEqual(await read(), { erp_supplier_id: 'ERP-1', notes: 'New' });
    // A blank cell keeps its value, whatever mode the address names.
    for (const mode of ['replace', 'merge', '']) {
      assert.deepEqual(await post(['name;erp_supplier_id', 'Acme;'], `&dryRun=false&mode=${mode}`), [0, 0, 1, 0], mode);
    }
    assert.deepEqual(await read(), { erp_supplier_id: 'ERP-1', notes: 'New' });
    // `-` clears, counted the same at the check and at the load.
    assert.deepEqual(await post(['name;notes', 'Acme;-'], '&dryRun=true&mode=replace'), [0, 1, 0, 1]);
    assert.deepEqual(await read(), { erp_supplier_id: 'ERP-1', notes: 'New' });
    assert.deepEqual(await post(['name;notes', 'Acme;-'], '&dryRun=false&mode=replace'), [0, 1, 0, 1]);
    assert.deepEqual(await read(), { erp_supplier_id: 'ERP-1', notes: null });
    console.log('suppliers-import-clear-http: OK');
  } finally {
    if (app) await app.close();
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
