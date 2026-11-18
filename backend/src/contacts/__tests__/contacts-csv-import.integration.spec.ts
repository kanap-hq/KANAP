import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { ContactsService } from '../contacts.service';
import { ExternalContact } from '../external-contact.entity';
import { SupplierContactLink } from '../supplier-contact.entity';
import { Supplier } from '../../suppliers/supplier.entity';

// A re-imported contact equal to the stored one counts as unchanged and is not
// written. The check and the load give the same counts.

type Result = {
  ok: boolean;
  dryRun: boolean;
  inserted: number;
  updated: number;
  unchanged?: number;
  errors: Array<{ row: number; message: string }>;
};

const HEADERS = 'first_name;last_name;job_title;email;phone;mobile;country;notes;active';

function file(lines: string[]): Express.Multer.File {
  const content = `${HEADERS}\n${lines.join('\n')}\n`;
  return { buffer: Buffer.from(content, 'utf8'), originalname: 'contacts.csv' } as Express.Multer.File;
}

function contactsService(manager: QueryRunner['manager']): ContactsService {
  return new ContactsService(
    manager.getRepository(ExternalContact),
    manager.getRepository(SupplierContactLink),
    manager.getRepository(Supplier),
    undefined as any,
    undefined as any,
  );
}

async function withTenant(fn: (runner: QueryRunner, tenantId: string) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Contacts CSV test', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `contacts-csv-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await fn(runner, tenantId);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testIdenticalRowsUnchanged() {
  await withTenant(async (runner, tenantId) => {
    await runner.query(
      `INSERT INTO contacts (tenant_id, first_name, last_name, job_title, email, phone, mobile, country, notes, active)
       VALUES ($1, 'Ada', 'Lovelace', 'Analyst', 'ada@example.test', '+33 1', NULL, 'FR', NULL, true),
              ($1, 'Alan', 'Turing', NULL, 'alan@example.test', NULL, NULL, NULL, 'Note', true)`,
      [tenantId],
    );
    const ctid = async (email: string): Promise<string> => {
      const [row] = await runner.query(
        `SELECT ctid::text AS ctid FROM contacts WHERE tenant_id = $1 AND email = $2`,
        [tenantId, email],
      );
      return row.ctid;
    };
    const adaBefore = await ctid('ada@example.test');
    const alanBefore = await ctid('alan@example.test');

    const contacts = contactsService(runner.manager);
    const again = file([
      'Ada;Lovelace;Analyst;ADA@example.test;+33 1;;FR;;yes',
      'Alan;Turing;;alan@example.test;;;;Changed note;true',
    ]);
    const dry: Result = await contacts.importCsv({ file: again, dryRun: true }, { manager: runner.manager, tenantId });
    assert.equal(dry.ok, true, JSON.stringify(dry.errors));
    assert.deepEqual(
      { inserted: dry.inserted, updated: dry.updated, unchanged: dry.unchanged },
      { inserted: 0, updated: 1, unchanged: 1 },
      'the check counts the identical row as unchanged',
    );

    const loaded: Result = await contacts.importCsv({ file: again, dryRun: false }, { manager: runner.manager, tenantId });
    assert.equal(loaded.ok, true, JSON.stringify(loaded.errors));
    assert.deepEqual(
      { inserted: loaded.inserted, updated: loaded.updated, unchanged: loaded.unchanged },
      { inserted: 0, updated: 1, unchanged: 1 },
      'the load gives the counts of the check',
    );
    assert.equal(await ctid('ada@example.test'), adaBefore, 'the identical contact is not written');
    assert.notEqual(await ctid('alan@example.test'), alanBefore, 'the changed contact is written');
    const [alan] = await runner.query(
      `SELECT notes FROM contacts WHERE tenant_id = $1 AND email = 'alan@example.test'`,
      [tenantId],
    );
    assert.equal(alan.notes, 'Changed note');

    const fresh = file(['New;Person;;new@example.test;;;;;']);
    const dryNew: Result = await contacts.importCsv({ file: fresh, dryRun: true }, { manager: runner.manager, tenantId });
    assert.deepEqual({ inserted: dryNew.inserted, updated: dryNew.updated, unchanged: dryNew.unchanged }, { inserted: 1, updated: 0, unchanged: 0 });
  });
}

// A contact attached to a supplier without a link (created by the API): a row that keeps the
// supplier and leaves the type empty writes nothing, and the contact stays without a link.
async function testSupplierKeptWithoutLinkUnchanged() {
  await withTenant(async (runner, tenantId) => {
    const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name, item_number) VALUES ($1, 'One', 1) RETURNING id`, [tenantId]);
    await runner.query(
      `INSERT INTO contacts (tenant_id, email, supplier_id, item_number) VALUES ($1, 'c@example.test', $2, 1)`,
      [tenantId, supplier.id],
    );
    const contacts = contactsService(runner.manager);
    const upload = { buffer: Buffer.from('email;supplier_name;supplier_role\nc@example.test;SUP-1;\n', 'utf8'), originalname: 'c.csv' } as Express.Multer.File;
    for (const dryRun of [true, false]) {
      const result: Result = await contacts.importCsv(
        { file: upload, dryRun, mode: 'enrich', access: { isAdmin: true, levels: {} } } as any,
        { manager: runner.manager, tenantId },
      );
      assert.equal(result.ok, true, JSON.stringify(result.errors));
      assert.deepEqual({ updated: result.updated, unchanged: result.unchanged }, { updated: 0, unchanged: 1 }, `dryRun=${dryRun}`);
    }
    const links = await runner.query(`SELECT 1 FROM supplier_contacts WHERE tenant_id = $1`, [tenantId]);
    assert.equal(links.length, 0, 'no link is created');
  });
}

async function main() {
  await dataSource.initialize();
  const tests: Array<[string, () => Promise<void>]> = [
    ['testIdenticalRowsUnchanged', testIdenticalRowsUnchanged],
    ['testSupplierKeptWithoutLinkUnchanged', testSupplierKeptWithoutLinkUnchanged],
  ];
  let failed = 0;
  try {
    for (const [name, test] of tests) {
      try {
        await test();
        console.log(`ok - ${name}`);
      } catch (err) {
        failed += 1;
        console.error(`not ok - ${name}`);
        console.error(err);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failed > 0) {
    console.error(`contacts-csv-import.integration.spec: ${failed} failed`);
    process.exit(1);
  }
  console.log('contacts-csv-import.integration.spec: ok');
}

void main();
