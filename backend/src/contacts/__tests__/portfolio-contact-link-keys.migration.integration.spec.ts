import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { PortfolioContactLinkKeys1854150000000 } from '../../migrations/1854150000000-portfolio-contact-link-keys';

// Migration 1854150000000 against a seeded dirty database, in one transaction rolled back at the
// end, starting from its down() (the state before it ran). Contact deletes made before it left
// project and request links naming a missing contact: they are deleted (counted per tenant in the
// log), a link naming another tenant's contact too, the sound links, contacts, projects and requests
// stay. Both keys end validated and ON DELETE CASCADE, so a contact delete then removes its links;
// a rerun changes nothing.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const LINKS = [
  { table: 'portfolio_project_contacts', record: 'portfolio_projects', column: 'project_id', key: 'fk_portfolio_project_contacts_contact' },
  { table: 'portfolio_request_contacts', record: 'portfolio_requests', column: 'request_id', key: 'fk_portfolio_request_contacts_contact' },
];

async function setTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(sql, params))[0].id as string;
}

async function seedTenant(runner: QueryRunner, tag: string) {
  const tenantId = randomUUID();
  const slug = `${tag}-${tenantId.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Contact link keys', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug],
  );
  return { tenantId, slug };
}

/** Each key of the two link tables into contacts: `<name>/<action>/<validated>`. */
async function contactKeys(runner: QueryRunner, table: string): Promise<string[]> {
  const rows: Array<{ key: string }> = await runner.query(
    `SELECT conname || '/' || confdeltype::text || '/' || CASE WHEN convalidated THEN 'valid' ELSE 'not valid' END AS key
       FROM pg_constraint WHERE contype = 'f' AND conrelid = $1::regclass AND confrelid = 'contacts'::regclass ORDER BY 1`,
    [table],
  );
  return rows.map((row) => row.key);
}

async function rlsStates(runner: QueryRunner) {
  return runner.query(
    `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relrowsecurity ORDER BY relname`,
  );
}

async function logged(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const migration = new PortfolioContactLinkKeys1854150000000();
    await migration.down(runner);
    for (const link of LINKS) assert.deepEqual(await contactKeys(runner, link.table), [], `${link.table}: no key before the migration`);
    const rlsBefore = await rlsStates(runner);

    const other = await seedTenant(runner, 'pcl-keys-b');
    await setTenant(runner, other.tenantId);
    const foreign = await one(runner, `INSERT INTO contacts (tenant_id, email) VALUES ($1, 'other@pcl-keys.test') RETURNING id`, [other.tenantId]);

    const { tenantId, slug } = await seedTenant(runner, 'pcl-keys');
    await setTenant(runner, tenantId);
    const contact = await one(runner, `INSERT INTO contacts (tenant_id, email) VALUES ($1, 'ana@pcl-keys.test') RETURNING id`, [tenantId]);
    const project = await one(runner, `INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES ($1, 'Project', 1) RETURNING id`, [tenantId]);
    const request = await one(runner, `INSERT INTO portfolio_requests (tenant_id, name, item_number) VALUES ($1, 'Request', 1) RETURNING id`, [tenantId]);
    const recordOf: Record<string, string> = { portfolio_projects: project, portfolio_requests: request };
    const kept: Record<string, string> = {};
    for (const link of LINKS) {
      const insert = (contactId: string) => one(runner,
        `INSERT INTO ${link.table} (tenant_id, ${link.column}, contact_id) VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, recordOf[link.record], contactId]);
      kept[link.table] = await insert(contact);
      await insert(randomUUID()); // its contact was deleted
      await insert(foreign); // names another tenant's contact
    }
    await setTenant(runner, '');

    const log = await logged(() => migration.up(runner));
    assert.deepEqual(await rlsStates(runner), rlsBefore, 'RLS is put back as found');
    const tenantLine = `tenant ${slug} \\(${tenantId}\\)`;
    for (const link of LINKS) {
      assert.match(log, new RegExp(`${tenantLine}: ${link.table}\\.contact_id: 2 row\\(s\\) naming a missing contacts row deleted`));
      assert.deepEqual(await contactKeys(runner, link.table), [`${link.key}/c/valid`], `${link.table}: one validated key, ON DELETE CASCADE`);
    }

    await setTenant(runner, tenantId);
    for (const link of LINKS) {
      const rows = await runner.query(`SELECT id FROM ${link.table} WHERE tenant_id = $1`, [tenantId]);
      assert.deepEqual(rows.map((row: { id: string }) => row.id), [kept[link.table]], `${link.table}: the orphan links are deleted, the sound one kept`);
      const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM ${link.record} WHERE id = $1`, [recordOf[link.record]]);
      assert.equal(n, 1, `${link.record}: the record stays`);
    }

    // The key does the contact delete's cleanup: its links go, the project and request stay.
    await runner.query(`DELETE FROM contacts WHERE id = $1`, [contact]);
    for (const link of LINKS) {
      const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM ${link.table} WHERE tenant_id = $1`, [tenantId]);
      assert.equal(n, 0, `${link.table}: the deleted contact's link goes`);
    }
    await setTenant(runner, '');

    const rerun = await logged(() => migration.up(runner));
    for (const link of LINKS) {
      assert.match(rerun, new RegExp(`${link.table}\\.contact_id: ${link.key} in place`));
      assert.deepEqual(await contactKeys(runner, link.table), [`${link.key}/c/valid`], `${link.table}: unchanged by the rerun`);
    }
    console.log('  ok orphan links deleted, keys validated and cascading, rerun changes nothing');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
}

run()
  .then(() => console.log('portfolio-contact-link-keys.migration.integration.spec.ts OK'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
