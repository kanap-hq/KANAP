// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { createRaceTenant, dropRaceTenant, seed } from '../../spend/__tests__/race-harness';
import { audit, seedHistoryData, seedPerson, type HistorySeed, type Person } from './record-history.fixtures';
import {
  assertNoField,
  assertPresentable,
  findChange,
  findChild,
  findItem,
  readPage,
} from './record-history-family-c.fixtures';

// The history of a site (lot 2, family C): its own creation and modification in words, its four
// children (a named person, a contact, a web link, a sub-location) added, changed and removed, and
// its access rule (200 with the module, 403 without it, 404 for an unknown, missing or foreign
// site). A company the reader cannot read is hidden; another family's name is never copied.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

type Seeded = {
  data: HistorySeed;
  locationReader: Person;
  allReader: Person;
};

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const [row] = await runner.query(sql, params);
  return row.id as string;
}

async function stored(runner: QueryRunner, table: string, id: string): Promise<Record<string, unknown>> {
  const [row] = await runner.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE t.id = $1`, [id]);
  return row.row as Record<string, unknown>;
}

async function seedLocationAudits(runner: QueryRunner, data: HistorySeed) {
  await runner.query(
    `UPDATE locations SET operating_company_id = $3, country_iso = 'FR', city = 'Lyon', provider = 'OVH', region = 'Rhone'
      WHERE tenant_id = $1 AND id = $2`,
    [data.tenantId, data.location, data.companyA],
  );
  const location = await stored(runner, 'locations', data.location);
  await audit(runner, {
    table: 'locations', recordId: data.location, action: 'create', userId: data.owner, after: location,
  });
  await audit(runner, {
    table: 'locations', recordId: data.location, action: 'update', userId: data.owner,
    before: location,
    after: { ...location, name: 'Paris DC 2', city: 'Paris', additional_info: 'Moved to the new building' },
  });

  // An internal contact: a named person of the tenant.
  const userContact = await one(
    runner,
    `INSERT INTO location_user_contacts (tenant_id, location_id, user_id, role)
     VALUES ($1, $2, $3, 'site manager') RETURNING id`,
    [data.tenantId, data.location, data.owner],
  );
  const userContactRow = await stored(runner, 'location_user_contacts', userContact);
  await audit(runner, {
    table: 'location_user_contacts', recordId: userContact, action: 'create', userId: data.owner, after: userContactRow,
  });
  await audit(runner, {
    table: 'location_user_contacts', recordId: userContact, action: 'update', userId: data.owner,
    before: userContactRow, after: { ...userContactRow, role: 'facility manager' },
  });
  await audit(runner, {
    table: 'location_user_contacts', recordId: userContact, action: 'delete', userId: data.owner,
    before: { ...userContactRow, role: 'facility manager' }, after: null,
  });

  // An external contact link.
  const contactLink = await one(
    runner,
    `INSERT INTO location_contacts (tenant_id, location_id, contact_id, role)
     VALUES ($1, $2, $3, 'support') RETURNING id`,
    [data.tenantId, data.location, data.contact],
  );
  const contactRow = await stored(runner, 'location_contacts', contactLink);
  await audit(runner, {
    table: 'location_contacts', recordId: contactLink, action: 'create', userId: data.owner, after: contactRow,
  });
  await audit(runner, {
    table: 'location_contacts', recordId: contactLink, action: 'delete', userId: data.owner, before: contactRow, after: null,
  });

  // A web link.
  const link = await one(
    runner,
    `INSERT INTO location_links (tenant_id, location_id, url, description)
     VALUES ($1, $2, 'https://example.invalid/runbook', 'Runbook') RETURNING id`,
    [data.tenantId, data.location],
  );
  const linkRow = await stored(runner, 'location_links', link);
  await audit(runner, {
    table: 'location_links', recordId: link, action: 'create', userId: data.owner, after: linkRow,
  });
  await audit(runner, {
    table: 'location_links', recordId: link, action: 'update', userId: data.owner,
    before: linkRow, after: { ...linkRow, url: 'https://example.invalid/runbook-v2' },
  });
  await audit(runner, {
    table: 'location_links', recordId: link, action: 'delete', userId: data.owner, before: linkRow, after: null,
  });

  // A sub-location: created, renamed, removed, and its order changed.
  const subItem = await one(
    runner,
    `INSERT INTO location_sub_items (tenant_id, location_id, name, description, display_order)
     VALUES ($1, $2, 'Rack 5', 'Cold aisle', 0) RETURNING id`,
    [data.tenantId, data.location],
  );
  const subItemRow = await stored(runner, 'location_sub_items', subItem);
  await audit(runner, {
    table: 'location_sub_items', recordId: subItem, action: 'create', userId: data.owner, after: subItemRow,
  });
  await audit(runner, {
    table: 'location_sub_items', recordId: subItem, action: 'update', userId: data.owner,
    before: subItemRow, after: { ...subItemRow, name: 'Rack 6', display_order: 1 },
  });
  await audit(runner, {
    table: 'location_sub_items', recordId: data.location, action: 'update', userId: data.owner,
    before: null, after: { ordered_ids: [subItem] },
    parent: { table: 'locations', id: data.location },
  });
  await audit(runner, {
    table: 'location_sub_items', recordId: subItem, action: 'delete', userId: data.owner,
    before: { ...subItemRow, name: 'Rack 6' }, after: null,
  });
}

async function testAccess(seeded: Seeded, foreign: HistorySeed) {
  const location = { locations: 'reader' };
  const page = await readPage(seeded.locationReader, seeded.data.tenantId, 'locations', seeded.data.location, location);
  assert.ok(page.items.length >= 10, 'a locations reader reads the site history');

  await assert.rejects(
    () => readPage(seeded.locationReader, seeded.data.tenantId, 'locations', seeded.data.location, { infrastructure: 'reader' }),
    (error: any) => error?.status === 403 && error?.response?.code === 'MODULE_RIGHT_REQUIRED',
    'a reader without locations gets 403 MODULE_RIGHT_REQUIRED',
  );
  await assert.rejects(
    () => readPage(seeded.locationReader, seeded.data.tenantId, 'locations', 'not-a-uuid', location),
    (error: any) => error?.status === 404,
    'a malformed id gets 404',
  );
  await assert.rejects(
    () => readPage(seeded.locationReader, seeded.data.tenantId, 'locations', randomUUID(), location),
    (error: any) => error?.status === 404,
    'a missing site gets 404',
  );
  await assert.rejects(
    () => readPage(seeded.allReader, seeded.data.tenantId, 'locations', foreign.location, location),
    (error: any) => error?.status === 404,
    'a site of another tenant gets 404',
  );
  console.log('  200 with the module, 403 without it, 404 for malformed, missing and foreign sites: OK');
}

async function testLocationEntries(seeded: Seeded) {
  const { data } = seeded;
  const location = { locations: 'reader' };
  const page = await readPage(seeded.locationReader, data.tenantId, 'locations', data.location, location);
  assertPresentable(page);

  const create = findItem(page, 'create');
  assert.equal(findChange(create, 'name').after, 'Paris DC');
  assert.equal(findChange(create, 'hosting_type').after, 'cloud');
  assert.deepEqual(findChange(create, 'operating_company_id').after, { hidden: true, kind: 'company' });
  assert.equal(findChange(create, 'city').after, 'Lyon');
  assert.equal(findChange(create, 'country_iso').after, 'FR');
  assert.equal(findChange(create, 'provider').after, 'OVH');
  assert.ok(!JSON.stringify(page).includes('Alpha Co'), 'a company the reader cannot read is not named');

  const update = findItem(page, 'update');
  assert.equal(findChange(update, 'name').before, 'Paris DC');
  assert.equal(findChange(update, 'name').after, 'Paris DC 2');
  assert.equal(findChange(update, 'city').before, 'Lyon');
  assert.equal(findChange(update, 'city').after, 'Paris');
  assert.equal(findChange(update, 'additional_info').after, 'Moved to the new building');
  assertNoField(page, 'tenant_id');

  // The same creation read by a company reader: the operating company is named.
  const full = await readPage(seeded.allReader, data.tenantId, 'locations', data.location, {
    locations: 'reader', companies: 'reader', contacts: 'reader',
  });
  const company = findChange(findItem(full, 'create'), 'operating_company_id').after as any;
  assert.equal(company.kind, 'company');
  assert.equal(company.label, 'Alpha Co');
  console.log('  site creation and modification in words, operating company hidden by module then named: OK');
}

async function testChildren(seeded: Seeded) {
  const { data } = seeded;
  const page = await readPage(seeded.allReader, data.tenantId, 'locations', data.location, {
    locations: 'reader', companies: 'reader', contacts: 'reader',
  });

  const personCreate = findChild(page, 'person', 'create');
  assert.equal(personCreate.actor.kind, 'user');
  const personAdded = findChange(personCreate, 'person');
  assert.equal(personAdded.event, 'added');
  assert.equal((personAdded.after as any).label, 'Ava Reader');
  const personUpdate = findChild(page, 'person', 'update');
  assert.equal(findChange(personUpdate, 'role').before, 'site manager');
  assert.equal(findChange(personUpdate, 'role').after, 'facility manager');
  const personDelete = findChild(page, 'person', 'delete');
  assert.equal(findChange(personDelete, 'person').event, 'removed');

  const contactCreate = findChild(page, 'contact', 'create');
  const contactAdded = findChange(contactCreate, 'contact');
  assert.equal(contactAdded.event, 'added');
  assert.equal((contactAdded.after as any).kind, 'contact');
  assert.equal((contactAdded.after as any).label, 'Cora Contact');
  assert.equal(findChange(findChild(page, 'contact', 'delete'), 'contact').event, 'removed');

  const linkCreate = findChild(page, 'link', 'create');
  assert.equal(linkCreate.subject.label, 'Runbook');
  const linkAdded = findChange(linkCreate, 'link');
  assert.equal(linkAdded.event, 'added');
  assert.equal((linkAdded.after as any).label, 'Runbook');
  assert.equal(findChange(findChild(page, 'link', 'update'), 'url').after, 'https://example.invalid/runbook-v2');
  assert.equal(findChange(findChild(page, 'link', 'delete'), 'link').event, 'removed');

  const subCreate = findChild(page, 'sub_item', 'create');
  assert.equal(findChange(subCreate, 'sub_item').event, 'added');
  assert.equal(findChange(subCreate, 'sub_item').after, 'Rack 5');
  const subUpdate = findChild(page, 'sub_item', 'update');
  assert.equal(subUpdate.subject.label, 'Rack 6');
  assert.equal(findChange(subUpdate, 'name').before, 'Rack 5');
  assert.equal(findChange(subUpdate, 'name').after, 'Rack 6');
  assert.equal(findChange(findChild(page, 'sub_item', 'delete'), 'sub_item').event, 'removed');
  // The reorder writes no readable field: an update that presents nothing is not an entry.
  assert.equal(
    page.items.filter((item) => item.subject.kind === 'sub_item' && item.action === 'update').length,
    1,
    'the sub-location reorder does not add an empty entry',
  );
  for (const field of ['location_id', 'display_order', 'external_source', 'external_id', 'external_url', 'ordered_ids']) {
    assertNoField(page, field);
  }
  console.log('  person, contact, link and sub-location added, changed and removed in words: OK');
}

async function run() {
  await dataSource.initialize();
  const tenantId = await createRaceTenant('record-history-locations');
  const foreignTenantId = await createRaceTenant('record-history-locations-foreign');
  try {
    const seeded: Seeded = await seed(tenantId, async (runner) => {
      const data = await seedHistoryData(runner, tenantId);
      await seedLocationAudits(runner, data);
      const locationReader = await seedPerson(runner, tenantId, { first: 'Lise', last: 'Site' }, { locations: 'reader' });
      const allReader = await seedPerson(
        runner,
        tenantId,
        { first: 'Alba', last: 'All' },
        { locations: 'reader', companies: 'reader', contacts: 'reader' },
      );
      return { data, locationReader, allReader };
    });
    const foreign = await seed(foreignTenantId, (runner) => seedHistoryData(runner, foreignTenantId));

    await testAccess(seeded, foreign);
    await testLocationEntries(seeded);
    await testChildren(seeded);
    console.log('record-history-locations.integration.spec: ok');
  } finally {
    await dropRaceTenant(tenantId);
    await dropRaceTenant(foreignTenantId);
    await dataSource.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
