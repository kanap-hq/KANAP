import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { ContactsDeleteService } from '../contacts-delete.service';
import { ExternalContact } from '../external-contact.entity';
import { SupplierContactLink } from '../supplier-contact.entity';

// Nothing refuses a contact delete: every place that names a contact holds a link row, and the
// delete removes the links with the contact while the linked records stay. So the list asks no
// check before its confirmation. Runs under a throwaway tenant in a rolled-back transaction.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const noAudit = { log: async () => undefined } as any;

/** Every table that links a contact to a record, with the record's table and column. */
const LINKS: Array<[link: string, record: string, column: string]> = [
  ['supplier_contacts', 'suppliers', 'supplier_id'],
  ['spend_item_contacts', 'spend_items', 'spend_item_id'],
  ['contract_contacts', 'contracts', 'contract_id'],
  ['application_support_contacts', 'applications', 'application_id'],
  ['asset_support_contacts', 'assets', 'asset_id'],
  ['technology_support_contacts', 'technologies', 'technology_id'],
  ['location_contacts', 'locations', 'location_id'],
  ['portfolio_project_contacts', 'portfolio_projects', 'project_id'],
  ['portfolio_request_contacts', 'portfolio_requests', 'request_id'],
];

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(sql, params))[0].id as string;
}

async function count(runner: QueryRunner, sql: string, params: unknown[]): Promise<number> {
  return Number((await runner.query(sql, params))[0].n);
}

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const t = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Contact delete', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [t, `contact-del-${t.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [t]);

    const contact = await one(runner, `INSERT INTO contacts (tenant_id, email, first_name, last_name) VALUES ($1, 'ana@example.test', 'Ana', 'Diaz') RETURNING id`, [t]);
    const other = await one(runner, `INSERT INTO contacts (tenant_id, email) VALUES ($1, 'bo@example.test') RETURNING id`, [t]);
    const supplier = await one(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Acme') RETURNING id`, [t]);
    const company = await one(runner, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Lyon', 'FR', 'Lyon') RETURNING id`, [t]);
    const records: Record<string, string> = {
      suppliers: supplier,
      spend_items: await one(runner,
        `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number) VALUES ($1, 'Licences', 'EUR', '2026-01-01', 900001) RETURNING id`, [t]),
      contracts: await one(runner,
        `INSERT INTO contracts (tenant_id, name, start_date, company_id, supplier_id) VALUES ($1, 'Support', '2026-01-01', $2, $3) RETURNING id`, [t, company, supplier]),
      applications: await one(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'ERP') RETURNING id`, [t]),
      assets: await one(runner,
        `INSERT INTO assets (tenant_id, name, kind, provider, environment, status, created_at, updated_at)
         VALUES ($1, 'srv-1', 'physical_server', 'on_premise', 'prod', 'active', now(), now()) RETURNING id`, [t]),
      locations: await one(runner,
        `INSERT INTO locations (tenant_id, name, location_reference, hosting_type) VALUES ($1, 'DC1', 'DC1', 'on_premise') RETURNING id`, [t]),
      technologies: await one(runner, `INSERT INTO technologies (tenant_id, item_number, name) VALUES ($1, 900004, 'SQL Server') RETURNING id`, [t]),
      portfolio_projects: await one(runner, `INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES ($1, 'Move', 900002) RETURNING id`, [t]),
      portfolio_requests: await one(runner, `INSERT INTO portfolio_requests (tenant_id, name, item_number) VALUES ($1, 'Ask', 900003) RETURNING id`, [t]),
    };
    for (const [link, record, column] of LINKS) {
      const role = ['supplier_contacts', 'spend_item_contacts', 'contract_contacts'].includes(link);
      for (const who of [contact, other]) {
        await runner.query(
          `INSERT INTO ${link} (tenant_id, contact_id, ${column}${role ? ', role' : ''}) VALUES ($1, $2, $3${role ? `, 'commercial'` : ''})`,
          [t, who, records[record]],
        );
      }
    }

    const m = runner.manager;
    const svc = new ContactsDeleteService(m.getRepository(ExternalContact), m.getRepository(SupplierContactLink), noAudit);
    const result = await svc.bulkDelete([contact], { manager: m });

    // Nothing refuses it.
    assert.deepEqual(result, { deleted: [contact], failed: [] });
    assert.equal(await count(runner, `SELECT count(*) AS n FROM contacts WHERE tenant_id = $1 AND id = $2`, [t, contact]), 0);
    for (const [link, record] of LINKS) {
      // Its links go, the other contact's stay, and the linked record stays.
      assert.equal(await count(runner, `SELECT count(*) AS n FROM ${link} WHERE tenant_id = $1 AND contact_id = $2`, [t, contact]), 0, `${link} of the deleted contact`);
      assert.equal(await count(runner, `SELECT count(*) AS n FROM ${link} WHERE tenant_id = $1 AND contact_id = $2`, [t, other]), 1, `${link} of the other contact`);
      assert.equal(await count(runner, `SELECT count(*) AS n FROM ${record} WHERE tenant_id = $1 AND id = $2`, [t, records[record]]), 1, `${record} kept`);
    }
    console.log('  ok a contact delete removes its links and keeps the linked records');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
}

run()
  .then(() => console.log('contact-delete.integration.spec.ts OK'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
