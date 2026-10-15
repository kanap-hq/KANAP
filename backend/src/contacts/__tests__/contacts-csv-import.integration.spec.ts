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

async function main() {
  await dataSource.initialize();
  const tests: Array<[string, () => Promise<void>]> = [
    ['testIdenticalRowsUnchanged', testIdenticalRowsUnchanged],
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
