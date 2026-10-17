// @database-spec
import 'dotenv/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import { TechnologySupport1854270000000 as Migration } from '../../migrations/1854270000000-technology-support';
import { REQUIRE_ANY_LEVEL_KEY, REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { ApplicationsController } from '../../applications/applications.controller';
import { assert, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { TechnologiesController } from '../technologies.controller';
import { one, services, technology, type AuditEntry } from './technologies.fixtures';

// The support of a technology (lot T1c) against a real database, in transactions rolled back at
// the end:
// - migration 1854270000000: the table has RLS enabled and forced and one policy
//   `technology_support_contacts_tenant_isolation` (USING and WITH CHECK), composite keys to the
//   technology and the contact, `contacts` has its unique key (tenant_id, id), `technologies` has
//   `support_notes`; a second up() changes nothing, down() then up() gives the same shape;
// - a link naming another tenant's contact is refused by the key, and by the policy when written
//   under another tenant;
// - the service: the list replaced in its order, one row per contact, one audit row per change and
//   none when nothing changes, another tenant's contact or technology refused, support notes saved;
// - the routes: read with `infrastructure:reader`, replace with `infrastructure:member`.

const migration = new Migration();
const TABLE = 'technology_support_contacts';

async function shape(runner: QueryRunner) {
  const table = await runner.query(
    `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced FROM pg_class c
      WHERE c.relname = $1 AND c.relnamespace = current_schema()::regnamespace`,
    [TABLE],
  );
  const policies = await runner.query(
    `SELECT p.polname, pg_get_expr(p.polqual, p.polrelid) AS using, pg_get_expr(p.polwithcheck, p.polrelid) AS check, p.polcmd AS cmd
       FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE c.relname = $1 ORDER BY p.polname`,
    [TABLE],
  );
  const constraints = await runner.query(
    `SELECT k.conname, pg_get_constraintdef(k.oid) AS def FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
      WHERE c.relname = $1 ORDER BY k.conname`,
    [TABLE],
  );
  const indexes = await runner.query(`SELECT indexname FROM pg_indexes WHERE tablename = $1 ORDER BY indexname`, [TABLE]);
  const contactsKey = await runner.query(
    `SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
      WHERE c.relname = 'contacts' AND i.indisunique AND pg_get_indexdef(i.indexrelid) LIKE '%(tenant_id, id)'`,
  );
  const column = await runner.query(
    `SELECT data_type, is_nullable FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'technologies' AND column_name = 'support_notes'`,
  );
  return { table, policies, constraints, indexes, contactsKey: contactsKey.length, column };
}

async function testMigration() {
  await inRolledBackTransaction(async (runner) => {
    const before = await shape(runner);
    assert.deepEqual(before.table, [{ rls: true, forced: true }]);
    assert.deepEqual(before.policies, [{
      polname: `${TABLE}_tenant_isolation`,
      using: '(tenant_id = app_current_tenant())',
      check: '(tenant_id = app_current_tenant())',
      cmd: '*',
    }]);
    const defs = new Map(before.constraints.map((c: { conname: string; def: string }) => [c.conname, c.def]));
    assert.equal(defs.get(`${TABLE}_technology_fk`), 'FOREIGN KEY (tenant_id, technology_id) REFERENCES technologies(tenant_id, id) ON DELETE CASCADE');
    assert.equal(defs.get(`${TABLE}_contact_fk`), 'FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts(tenant_id, id) ON DELETE CASCADE');
    assert.equal(defs.get(`${TABLE}_key`), 'UNIQUE (tenant_id, technology_id, contact_id)');
    assert.equal(before.contactsKey, 1);
    assert.deepEqual(before.column, [{ data_type: 'text', is_nullable: 'YES' }]);

    await migration.up(runner);
    assert.deepEqual(await shape(runner), before, 'a second up() changes nothing');
    await migration.down(runner);
    const down = await shape(runner);
    assert.deepEqual(down.table, []);
    assert.deepEqual(down.column, []);
    assert.equal(down.contactsKey, 0, 'down() removes the key it added to contacts');
    await migration.up(runner);
    assert.deepEqual(await shape(runner), before, 'down() then up() gives the same shape');
  });
}

async function contact(runner: QueryRunner, tenantId: string, firstName: string) {
  return one(runner, `INSERT INTO contacts (tenant_id, email, first_name, last_name, phone) VALUES ($1, $2, $3, 'Support', '+33 1 00 00 00 00') RETURNING id`, [tenantId, `${firstName.toLowerCase()}-${tenantId.slice(0, 8)}@example.test`, firstName]);
}

async function rejectsWith(runner: QueryRunner, code: string, fn: () => Promise<unknown>, label: string) {
  await runner.query('SAVEPOINT expect_failure');
  let error: any = null;
  try {
    await fn();
  } catch (e) {
    error = e;
  }
  await runner.query('ROLLBACK TO SAVEPOINT expect_failure');
  assert.ok(error, `${label}: expected an error`);
  assert.equal(error.code ?? error.driverError?.code, code, `${label}: ${error?.message}`);
}

async function testKeysAndPolicy() {
  await inRolledBackTransaction(async (runner) => {
    const other = await seedTenant(runner, 'tsc-other');
    const foreignContact = await contact(runner, other, 'Olga');
    const tenantId = await seedTenant(runner, 'tsc-keys');
    const sql = await technology(runner, tenantId, 1, 'SQL Server', 'database');
    const own = await contact(runner, tenantId, 'Anna');
    await runner.query(`INSERT INTO ${TABLE} (tenant_id, technology_id, contact_id) VALUES ($1, $2, $3)`, [tenantId, sql, own]);
    await rejectsWith(runner, '23505', () => runner.query(
      `INSERT INTO ${TABLE} (tenant_id, technology_id, contact_id) VALUES ($1, $2, $3)`, [tenantId, sql, own],
    ), 'the same contact twice');
    await rejectsWith(runner, '23503', () => runner.query(
      `INSERT INTO ${TABLE} (tenant_id, technology_id, contact_id) VALUES ($1, $2, $3)`, [tenantId, sql, foreignContact],
    ), 'a contact of another tenant');
    await rejectsWith(runner, '42501', () => runner.query(
      `INSERT INTO ${TABLE} (tenant_id, technology_id, contact_id) VALUES ($1, $2, $3)`, [other, sql, foreignContact],
    ), 'a row of another tenant');
    await setTenant(runner, other);
    const seen = await runner.query(`SELECT 1 FROM ${TABLE} WHERE technology_id = $1`, [sql]);
    assert.equal(seen.length, 0, 'another tenant sees nothing');
    await setTenant(runner, tenantId);
    await runner.query(`DELETE FROM contacts WHERE id = $1`, [own]);
    const left = await runner.query(`SELECT 1 FROM ${TABLE} WHERE tenant_id = $1 AND technology_id = $2`, [tenantId, sql]);
    assert.equal(left.length, 0, 'a deleted contact leaves the list');
  });
}

async function testService() {
  await inRolledBackTransaction(async (runner) => {
    const other = await seedTenant(runner, 'tsc-svc-other');
    const foreignContact = await contact(runner, other, 'Olga');
    const foreignTech = await technology(runner, other, 1, 'Other', 'other');
    const tenantId = await seedTenant(runner, 'tsc-svc');
    const audit: AuditEntry[] = [];
    const { technologies } = services(audit);
    const opts = { manager: runner.manager, tenantId, userId: null };
    const sql = await technology(runner, tenantId, 1, 'SQL Server', 'database');
    const anna = await contact(runner, tenantId, 'Anna');
    const bruno = await contact(runner, tenantId, 'Bruno');

    const saved = await technologies.bulkReplaceSupportContacts('TEC-1', [
      { contact_id: bruno, role: ' Editor support ' },
      { contact_id: anna, role: '' },
      { contact_id: bruno.toUpperCase(), role: 'Duplicate' },
      { contact_id: '' },
    ], opts);
    assert.deepEqual(saved.map((row) => [row.contact_id, row.role]), [[bruno, 'Editor support'], [anna, null]], 'list order kept, one row per contact');
    assert.equal(saved[0].contact.first_name, 'Bruno');
    assert.equal(saved[0].contact.phone, '+33 1 00 00 00 00');
    assert.equal(audit.length, 1);
    assert.deepEqual(audit[0], { table: TABLE, recordId: sql, action: 'update', before: [], after: [`${bruno}:Editor support`, `${anna}:`], userId: null });

    await technologies.bulkReplaceSupportContacts(sql, [{ contact_id: bruno, role: 'Editor support' }, { contact_id: anna }], opts);
    assert.equal(audit.length, 1, 'no audit row when nothing changes');
    assert.deepEqual((await technologies.listSupportContacts(sql, opts)).map((row) => row.contact_id), [bruno, anna]);

    await assert.rejects(technologies.bulkReplaceSupportContacts(sql, [{ contact_id: foreignContact }], opts), BadRequestException);
    await assert.rejects(technologies.bulkReplaceSupportContacts(sql, [{ contact_id: 'not-a-uuid' }], opts), BadRequestException);
    await assert.rejects(technologies.bulkReplaceSupportContacts(sql, [{ contact_id: anna, role: 'x'.repeat(201) }], opts), BadRequestException);
    await assert.rejects(technologies.bulkReplaceSupportContacts(foreignTech, [], opts), NotFoundException);
    await assert.rejects(technologies.listSupportContacts(foreignTech, opts), NotFoundException);

    const emptied = await technologies.bulkReplaceSupportContacts(sql, [], opts);
    assert.deepEqual(emptied, []);
    assert.deepEqual(audit.at(-1)?.after, []);

    const updated = await technologies.update(sql, { support_notes: '  Call the editor first.  ' }, opts);
    assert.equal(updated.support_notes, 'Call the editor first.');
    assert.equal(audit.at(-1)?.table, 'technologies');
    assert.equal((await technologies.update(sql, { support_notes: '' }, opts)).support_notes, null);
  });
}

/** A web link takes an http or https address, or one without a scheme; any other scheme is a 400. */
async function testWebLinks() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'tsc-links');
    const { technologies } = services([]);
    const opts = { manager: runner.manager, tenantId, userId: null };
    const sql = await technology(runner, tenantId, 1, 'SQL Server', 'database');
    for (const url of ['https://learn.microsoft.com/sql', 'HTTP://intranet/sql', 'www.vmware.com/support', 'intranet:8080/wiki']) {
      assert.equal((await technologies.createLink(sql, { url: ` ${url} ` }, opts)).url, url, url);
    }
    for (const url of ['javascript:alert(document.domain)', 'JavaScript:void(0)', 'data:text/html,<b>x</b>', 'ftp://files.example.test', 'vbscript:msgbox']) {
      await assert.rejects(technologies.createLink(sql, { url }, opts), BadRequestException, url);
    }
    const link = await technologies.createLink(sql, { url: 'https://example.test', description: 'Docs' }, opts);
    await assert.rejects(technologies.updateLink(sql, link.id, { url: 'javascript:alert(1)' }, opts), BadRequestException);
    assert.equal((await technologies.updateLink(sql, link.id, { description: 'Kept' }, opts)).url, 'https://example.test', 'an update without url keeps it');
  });
}

function testRoutes() {
  const level = (method: keyof TechnologiesController) => Reflect.getMetadata(REQUIRE_LEVEL_KEY, TechnologiesController.prototype[method]);
  assert.deepEqual(level('listSupportContacts'), { resource: 'infrastructure', level: 'reader' });
  assert.deepEqual(level('replaceSupportContacts'), { resource: 'infrastructure', level: 'member' });
  assert.deepEqual(level('update'), { resource: 'infrastructure', level: 'member' });
  // The classification catalog of the Compliance tab: the applications' or the infrastructure's readers, nothing else.
  const catalog = ApplicationsController.prototype.classificationCatalog;
  assert.equal(Reflect.getMetadata(REQUIRE_LEVEL_KEY, catalog), undefined);
  assert.deepEqual(Reflect.getMetadata(REQUIRE_ANY_LEVEL_KEY, catalog), [
    { resource: 'applications', level: 'reader' },
    { resource: 'infrastructure', level: 'reader' },
  ]);
}

runSpecs('technology-support.integration.spec', [
  ['migration', testMigration],
  ['keys and policy', testKeysAndPolicy],
  ['service', testService],
  ['web links', testWebLinks],
  ['routes', async () => testRoutes()],
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
