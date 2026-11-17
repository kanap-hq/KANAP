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
import { Supplier } from '../../suppliers/supplier.entity';
import { SupplierContactsService } from '../../suppliers/supplier-contacts.service';
import { seedCompany } from '../../spend/__tests__/cost-center.fixtures';
import { ContactsController } from '../contacts.controller';
import { ContactsService } from '../contacts.service';
import { ContactsDeleteService } from '../contacts-delete.service';
import { ExternalContact } from '../external-contact.entity';
import { SupplierContactLink } from '../supplier-contact.entity';

// POST /contacts/import through the real controller, the real services and Nest's HTTP stack (lot I4
// of 26.11.9, fourth pass): the `supplier_name` column sets a contact's main supplier by its reference
// (`SUP-n`) or its name, found as the contracts import finds one (exactly, case aside, then accents
// aside, listed and undoable); `supplier_role` sets the contact's type for it, in the screen's words.
// A blank cell keeps, `-` removes the supplier (counted in `cleared`), and the write goes through
// `ContactsService.update`: the main supplier link, its propagation to the supplier's contracts and
// the audit, as a change on the contact's page. The import never creates a supplier. The route's guards
// are taken off for this process (their own specs cover them). One transaction, rolled back.

type Body = {
  ok: boolean;
  inserted: number;
  updated: number;
  unchanged?: number;
  cleared?: number;
  errors: Array<{ row: number; column?: string; code?: string; params?: Record<string, unknown> }>;
  matches?: Array<Record<string, unknown>>;
};

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
       VALUES ($1, $2, 'Contacts supplier', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `contacts-supplier-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const supplierIds: Record<string, string> = {};
    for (const [name, number] of [['Acme', 1], ['Société Générale Info', 2], ['Société Gamma', 3], ['Societé Gamma', 4]] as const) {
      const [row] = await runner.query(`INSERT INTO suppliers (tenant_id, name, item_number) VALUES ($1, $2, $3) RETURNING id`, [tenantId, name, number]);
      supplierIds[`SUP-${number}`] = row.id;
    }
    const { companyId } = await seedCompany(runner, tenantId, 'Contacts Co');
    const [contract] = await runner.query(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, 'Acme support', $2, $3, '2024-01-01') RETURNING id`,
      [tenantId, companyId, supplierIds['SUP-1']],
    );

    const audit = new AuditService(runner.manager.getRepository(AuditLog));
    const links = new SupplierContactsService(runner.manager.getRepository(SupplierContactLink), audit);
    const service = new ContactsService(
      runner.manager.getRepository(ExternalContact),
      runner.manager.getRepository(SupplierContactLink),
      runner.manager.getRepository(Supplier),
      links,
      audit,
    );
    Reflect.defineMetadata(GUARDS_METADATA, [], ContactsController);
    for (const name of Object.getOwnPropertyNames(ContactsController.prototype)) {
      const handler = (ContactsController.prototype as any)[name];
      if (typeof handler === 'function') Reflect.defineMetadata(GUARDS_METADATA, [], handler);
    }
    @Module({
      controllers: [ContactsController],
      providers: [
        { provide: ContactsService, useValue: service },
        { provide: ContactsDeleteService, useValue: {} },
      ],
    })
    class ContactsSupplierProbeModule {}
    app = await NestFactory.create(ContactsSupplierProbeModule, { logger: false, abortOnError: false });
    app.use((req: any, _res: any, next: () => void) => {
      req.tenant = { id: tenantId, slug: 'contacts-supplier', name: 'Contacts supplier' };
      req.user = { sub: null };
      req.isAdmin = true;
      req.permissions = {};
      req.queryRunner = runner;
      next();
    });
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    const post = async (lines: string[], dryRun: boolean, unmatched?: Array<{ column: string; value: string }>): Promise<Body> => {
      const form = new FormData();
      form.append('file', new Blob([`${lines.join('\n')}\n`], { type: 'text/csv' }), 'contacts.csv');
      if (unmatched) form.append('unmatched', JSON.stringify(unmatched));
      const res = await fetch(`http://127.0.0.1:${port}/contacts/import?language=en&dryRun=${dryRun}`, { method: 'POST', body: form });
      const body = await res.json() as Body;
      assert.equal(res.status, 201, JSON.stringify(body));
      return body;
    };
    const counts = (body: Body) => [body.inserted, body.updated, body.unchanged, body.cleared];
    const errorsOf = (body: Body) => body.errors.map((error) => [error.row, error.column, error.code]);
    /** Each contact's supplier and its main supplier links, by e-mail. */
    const state = async () => Object.fromEntries((await runner.query(
      `SELECT c.email, 'SUP-' || s.item_number AS supplier,
              (SELECT string_agg('SUP-' || ls.item_number || ' ' || l.role, ', ' ORDER BY ls.item_number)
                 FROM supplier_contacts l JOIN suppliers ls ON ls.id = l.supplier_id AND ls.tenant_id = l.tenant_id
                WHERE l.tenant_id = c.tenant_id AND l.contact_id = c.id AND l.is_primary) AS links
         FROM contacts c LEFT JOIN suppliers s ON s.id = c.supplier_id AND s.tenant_id = c.tenant_id
        WHERE c.tenant_id = $1 ORDER BY c.email`,
      [tenantId],
    )).map((row: any) => [row.email, `${row.supplier ?? '-'} / ${row.links ?? '-'}`]));
    /** The contacts the supplier's contract carries from the supplier (origin `supplier`). */
    const contractContacts = async () => (await runner.query(
      `SELECT c.email || ' ' || cc.role AS r FROM contract_contacts cc JOIN contacts c ON c.id = cc.contact_id AND c.tenant_id = cc.tenant_id
        WHERE cc.tenant_id = $1 AND cc.contract_id = $2 AND cc.origin = 'supplier' ORDER BY 1`,
      [tenantId, contract.id],
    )).map((row: any) => row.r);
    const auditCount = async (table: string) => Number((await runner.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND table_name = $2`,
      [tenantId, table],
    ))[0].n);

    // By reference, by a name in another case, by a name without its accents (listed and undoable).
    const file = [
      'email;first_name;supplier_name',
      'a@x.test;Ana;SUP-1',
      'b@x.test;Ben;acme',
      'c@x.test;Cy;Societe Generale Info',
    ];
    const dry = await post(file, true);
    assert.equal(dry.ok, true, JSON.stringify(dry.errors));
    assert.deepEqual(counts(dry), [3, 0, 0, 0]);
    assert.deepEqual(dry.matches, [{
      column: 'supplier_name', name: null, value: 'Societe Generale Info', target: 'Société Générale Info', ref: 'SUP-2',
      origin: 'server', reason: 'accents', undoable: true, lines: [4], count: 1,
    }], 'only the match beyond case is listed');
    assert.deepEqual(await state(), {}, 'the check writes nothing');
    const loaded = await post(file, false);
    assert.equal(loaded.ok, true, JSON.stringify(loaded.errors));
    assert.deepEqual(counts(loaded), [3, 0, 0, 0], 'the load gives the counts of the check');
    assert.deepEqual(await state(), {
      'a@x.test': 'SUP-1 / SUP-1 commercial',
      'b@x.test': 'SUP-1 / SUP-1 commercial',
      'c@x.test': 'SUP-2 / SUP-2 commercial',
    }, 'the main supplier link takes the type a supplier choice gives on the screen');
    assert.deepEqual(await contractContacts(), ['a@x.test commercial', 'b@x.test commercial'], 'propagated to the supplier\'s contract');
    assert.ok(await auditCount('supplier_contacts') >= 3, 'each link written is audited');
    assert.ok(await auditCount('contacts') >= 3, 'each supplier set is audited on the contact');
    console.log('  supplier by reference, by name case aside and accents aside, with its link and propagation: OK');

    // The match undone: the name is found case aside only, and the row is refused.
    const undone = await post(['email;supplier_name', 'd@x.test;Societe Generale Info'], true, [{ column: 'supplier_name', value: 'Societe Generale Info' }]);
    assert.equal(undone.ok, false);
    assert.deepEqual(errorsOf(undone), [[2, 'supplier_name', 'CSV_REFERENCE_NOT_FOUND']]);
    // Unknown, ambiguous, an unknown reference: refused on the column, and no supplier is created.
    const refused = await post(['email;supplier_name', 'd@x.test;Nope Ltd', 'e@x.test;Societe Gamma', 'f@x.test;SUP-99'], true);
    assert.deepEqual(errorsOf(refused), [
      [2, 'supplier_name', 'CSV_REFERENCE_NOT_FOUND'],
      [3, 'supplier_name', 'CSV_NAME_AMBIGUOUS_AMONG'],
      [4, 'supplier_name', 'CSV_REFERENCE_NOT_FOUND'],
    ]);
    assert.equal(refused.errors[1].params?.names, 'SUP-3, SUP-4');
    assert.equal(Number((await runner.query(`SELECT count(*)::int AS n FROM suppliers WHERE tenant_id = $1`, [tenantId]))[0].n), 4);
    console.log('  an undone match, an unknown name, an ambiguous name and an unknown reference are refused: OK');

    // A blank cell keeps the supplier; a file without the column touches nothing.
    assert.deepEqual(counts(await post(['email;supplier_name;job_title', 'a@x.test;;Buyer'], false)), [0, 1, 0, 0]);
    assert.deepEqual(counts(await post(['email;job_title', 'b@x.test;Buyer'], false)), [0, 1, 0, 0]);
    assert.deepEqual(counts(await post(['email;supplier_name;supplier_role', 'b@x.test;Acme;commercial'], false)), [0, 0, 1, 0], 'the same supplier and type: unchanged');
    assert.equal((await state())['a@x.test'], 'SUP-1 / SUP-1 commercial');
    assert.equal((await state())['b@x.test'], 'SUP-1 / SUP-1 commercial');

    // The type, in the screen's words: the link changes, the contract follows.
    assert.deepEqual(counts(await post(['email;supplier_role', 'a@x.test;Technique'], false)), [0, 1, 0, 0]);
    assert.equal((await state())['a@x.test'], 'SUP-1 / SUP-1 technical');
    assert.deepEqual(await contractContacts(), ['a@x.test technical', 'b@x.test commercial']);
    const badRole = await post(['email;supplier_name;supplier_role', 'a@x.test;Acme;Boss', 'b@x.test;;-'], true);
    assert.deepEqual(errorsOf(badRole), [
      [2, 'supplier_role', 'CSV_ENUM_INVALID'],
      [3, 'supplier_role', 'CSV_VALUE_CANNOT_BE_CLEARED'],
    ]);
    // A type needs a supplier: given or stored.
    assert.deepEqual(errorsOf(await post(['email;supplier_name;supplier_role', 'g@x.test;;support'], true)), [[2, 'supplier_name', 'CSV_VALUE_REQUIRED']]);
    console.log('  a blank cell keeps, an absent column touches nothing, the type follows the screen: OK');

    // `-` removes the supplier, its main link and what it propagated; counted once.
    assert.deepEqual(counts(await post(['email;supplier_name;supplier_role', 'a@x.test;-;-'], true)), [0, 1, 0, 1]);
    assert.deepEqual(counts(await post(['email;supplier_name', 'a@x.test;-'], false)), [0, 1, 0, 1]);
    assert.equal((await state())['a@x.test'], '- / -');
    assert.deepEqual(await contractContacts(), ['b@x.test commercial']);
    assert.deepEqual(counts(await post(['email;supplier_name', 'a@x.test;-'], true)), [0, 0, 1, 0], '`-` on no supplier changes nothing');
    console.log('  `-` removes the supplier and its link, counted in cleared: OK');
    console.log('contacts-import-supplier-http: OK');
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
