import 'dotenv/config';
import { NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { readSupplierUsages } from '../supplier-usages';
import { SuppliersController } from '../suppliers.controller';
import { readContactUsages } from '../../contacts/contact-usages';
import { ContactsController } from '../../contacts/contacts.controller';
import { USAGE_GROUP_LIMIT, type UsageCaller, type Usages } from '../../common/record-usages';
import { seedCompany } from '../../spend/__tests__/cost-center.fixtures';
import { withRlsLifted } from '../../common/__tests__/rls-bypass.fixtures';
import { assert, CAPEX_NUMBER_OFFSET, runSpecs, seedItem, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';

// @database-spec: opens the data-source through runSpecs, so it runs on a database lane.

// Where a supplier or a contact is used (`GET /suppliers/:id/usages`, `GET /contacts/:id/usages`):
// one group per type of object, both natures of budget lines, the contact's roles per object,
// a group per resource the caller may read, and nothing from another tenant. RLS is lifted on
// every table read, so the explicit tenant predicates are what keeps tenant B's rows out:
// tenant B's objects point at tenant A's supplier and contact ids (a foreign key does not
// check the tenant).

const BYPASS_TABLES = [
  'suppliers', 'contacts', 'supplier_contacts', 'spend_items', 'spend_item_contacts', 'contracts', 'contract_contacts',
  'applications', 'application_support_contacts', 'assets', 'asset_support_info', 'asset_support_contacts',
  'locations', 'location_contacts', 'portfolio_projects', 'portfolio_project_contacts', 'portfolio_requests',
  'portfolio_request_contacts',
];

const ADMIN: UsageCaller = { isAdmin: true };

type World = {
  tenantA: string;
  tenantB: string;
  supplier: string;
  idle: string;
  contact: string;
  ids: Record<string, string>;
};

async function seedObjects(runner: QueryRunner, tenantId: string, supplier: string, contact: string, tag: string, start: number) {
  const { companyId } = await seedCompany(runner, tenantId, `Company ${tag}`);
  const opex = await seedItem(runner, 'opex', tenantId, start, `OPEX ${tag}`);
  const capex = await seedItem(runner, 'capex', tenantId, start, `CAPEX ${tag}`);
  await runner.query(`UPDATE spend_items SET supplier_id = $2 WHERE id = ANY($1)`, [[opex, capex], supplier]);
  const [contract] = await runner.query(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, $2, $3, $4, '2024-01-01') RETURNING id`,
    [tenantId, `Contract ${tag}`, companyId, supplier],
  );
  const [application] = await runner.query(
    `INSERT INTO applications (tenant_id, name, supplier_id) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, `Application ${tag}`, supplier],
  );
  const [asset] = await runner.query(
    `INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, $2, 'server', 'prod') RETURNING id`,
    [tenantId, `Asset ${tag}`],
  );
  await runner.query(`INSERT INTO asset_support_info (tenant_id, asset_id, vendor_id) VALUES ($1, $2, $3)`, [tenantId, asset.id, supplier]);
  const [location] = await runner.query(
    `INSERT INTO locations (tenant_id, name, hosting_type, location_reference) VALUES ($1, $2, 'on_premise', $3) RETURNING id`,
    [tenantId, `Location ${tag}`, `LOC-${tag}`],
  );
  const [project] = await runner.query(
    `INSERT INTO portfolio_projects (tenant_id, name, item_number, status) VALUES ($1, $2, $3, 'planned') RETURNING id`,
    [tenantId, `Project ${tag}`, start],
  );
  const [request] = await runner.query(
    `INSERT INTO portfolio_requests (tenant_id, name, item_number, status) VALUES ($1, $2, $3, 'approved') RETURNING id`,
    [tenantId, `Request ${tag}`, start],
  );

  await runner.query(
    `INSERT INTO supplier_contacts (tenant_id, supplier_id, contact_id, role) VALUES ($1, $2, $3, 'technical')`,
    [tenantId, supplier, contact],
  );
  // Two roles on the OPEX line: one object, both roles.
  await runner.query(
    `INSERT INTO spend_item_contacts (tenant_id, spend_item_id, contact_id, role, origin)
     VALUES ($1, $2, $4, 'technical', 'manual'), ($1, $2, $4, 'commercial', 'supplier'), ($1, $3, $4, 'support', 'manual')`,
    [tenantId, opex, capex, contact],
  );
  await runner.query(
    `INSERT INTO contract_contacts (tenant_id, contract_id, contact_id, role, origin) VALUES ($1, $2, $3, 'commercial', 'manual')`,
    [tenantId, contract.id, contact],
  );
  await runner.query(
    `INSERT INTO application_support_contacts (tenant_id, application_id, contact_id, role) VALUES ($1, $2, $3, ' Account manager '), ($1, $2, $3, '')`,
    [tenantId, application.id, contact],
  );
  await runner.query(
    `INSERT INTO asset_support_contacts (tenant_id, asset_id, contact_id, role) VALUES ($1, $2, $3, 'Hardware support')`,
    [tenantId, asset.id, contact],
  );
  await runner.query(
    `INSERT INTO location_contacts (tenant_id, location_id, contact_id, role) VALUES ($1, $2, $3, NULL)`,
    [tenantId, location.id, contact],
  );
  await runner.query(`INSERT INTO portfolio_project_contacts (tenant_id, project_id, contact_id) VALUES ($1, $2, $3)`, [tenantId, project.id, contact]);
  await runner.query(`INSERT INTO portfolio_request_contacts (tenant_id, request_id, contact_id) VALUES ($1, $2, $3)`, [tenantId, request.id, contact]);
  return { opex, capex, contract: contract.id, application: application.id, asset: asset.id, location: location.id, project: project.id, request: request.id };
}

async function withWorld(fn: (runner: QueryRunner, world: World) => Promise<void>) {
  await withRlsLifted(BYPASS_TABLES, async (runner) => {
    const tenantB = await seedTenant(runner, 'usages-b');
    const tenantA = await seedTenant(runner, 'usages-a');
    const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Microsoft') RETURNING id`, [tenantA]);
    const [idle] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Idle supplier') RETURNING id`, [tenantA]);
    const [contact] = await runner.query(
      `INSERT INTO contacts (tenant_id, email, first_name, last_name) VALUES ($1, $2, 'Robert', 'Chen') RETURNING id`,
      [tenantA, `robert-${tenantA.slice(0, 8)}@example.com`],
    );
    const ids = await seedObjects(runner, tenantA, supplier.id, contact.id, 'A', 1);

    // Tenant B: the same kinds of objects, pointing at tenant A's supplier and contact.
    await setTenant(runner, tenantB);
    await seedObjects(runner, tenantB, supplier.id, contact.id, 'B', 1);

    await setTenant(runner, tenantA);
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM contracts WHERE supplier_id = $1`, [supplier.id]);
    assert.equal(n, 2, 'with RLS lifted, the session sees both tenants\' contracts of the supplier');
    await fn(runner, { tenantA, tenantB, supplier: supplier.id, idle: idle.id, contact: contact.id, ids });
  });
}

/** `type: reference|name|nature|active|roles` per item, group by group. */
function shape(usages: Usages): Record<string, string[]> {
  return Object.fromEntries(usages.groups.map((group) => [
    group.type,
    group.items.map((item) => [item.reference ?? '-', item.name, item.nature ?? '-', item.active ? 'active' : 'inactive', (item.roles ?? ['-']).join('+')].join('|')),
  ]));
}

async function testSupplierUsages() {
  await withWorld(async (runner, w) => {
    await runner.query(`UPDATE spend_items SET disabled_at = now() - interval '1 day' WHERE id = $1 AND nature = 'capex'`, [w.ids.capex]);
    const usages = await readSupplierUsages(runner.manager, w.tenantA, w.supplier, ADMIN);
    const capexRef = `BL-${1 + CAPEX_NUMBER_OFFSET}`;
    assert.deepEqual(shape(usages), {
      budget_lines: ['BL-1|OPEX A|opex|active|-', `${capexRef}|CAPEX A|capex|inactive|-`],
      contracts: ['-|Contract A|-|active|-'],
      applications: ['-|Application A|-|active|-'],
      assets: ['-|Asset A|-|active|-'],
    }, 'every object of tenant A naming the supplier, both natures, active ones first');
    assert.deepEqual(usages.groups.map((group) => group.total), [2, 1, 1, 1]);
    assert.equal(usages.total, 5);
    assert.equal(usages.groups[0].items[0].id, w.ids.opex, 'the item carries the object id');

    const idle = await readSupplierUsages(runner.manager, w.tenantA, w.idle, ADMIN);
    assert.deepEqual(idle, { total: 0, groups: [] }, 'a supplier nothing uses has no group');
  });
}

async function testContactUsages() {
  await withWorld(async (runner, w) => {
    const usages = await readContactUsages(runner.manager, w.tenantA, w.contact, ADMIN);
    assert.deepEqual(shape(usages), {
      suppliers: ['-|Microsoft|-|active|technical'],
      budget_lines: ['BL-1|OPEX A|opex|active|commercial+technical', `BL-${1 + CAPEX_NUMBER_OFFSET}|CAPEX A|capex|active|support`],
      contracts: ['-|Contract A|-|active|commercial'],
      applications: ['-|Application A|-|active|Account manager'],
      assets: ['-|Asset A|-|active|Hardware support'],
      locations: ['-|Location A|-|active|'],
      projects: ['PRJ-1|Project A|-|active|'],
      requests: ['REQ-1|Request A|-|active|'],
    }, 'one item per object, the contact\'s roles on it (types in their order, text trimmed, blanks dropped)');
    assert.equal(usages.total, 9);
    const project = usages.groups.find((group) => group.type === 'projects')!.items[0];
    assert.equal(project.status, 'planned', 'a project carries its status');
  });
}

async function testTenantIsolation() {
  await withWorld(async (runner, w) => {
    // Tenant B's objects name tenant A's ids, but tenant B does not own them.
    await setTenant(runner, w.tenantB);
    await assert.rejects(() => readSupplierUsages(runner.manager, w.tenantB, w.supplier, ADMIN), NotFoundException);
    await assert.rejects(() => readContactUsages(runner.manager, w.tenantB, w.contact, ADMIN), NotFoundException);
    await setTenant(runner, w.tenantA);
    // And tenant A's answer holds tenant A's objects only (tags 'A', totals of one tenant).
    const supplier = await readSupplierUsages(runner.manager, w.tenantA, w.supplier, ADMIN);
    const contact = await readContactUsages(runner.manager, w.tenantA, w.contact, ADMIN);
    for (const usages of [supplier, contact]) {
      for (const group of usages.groups) {
        for (const item of group.items) assert.ok(!/ B$/.test(item.name), `${group.type}: ${item.name} belongs to tenant B`);
        assert.equal(group.total, group.items.length, `${group.type}: the total counts tenant A only`);
      }
    }
  });
}

async function testPermissions() {
  await withWorld(async (runner, w) => {
    const contractsOnly: UsageCaller = { permissions: { suppliers: 'reader', contracts: 'reader' } };
    const supplier = await readSupplierUsages(runner.manager, w.tenantA, w.supplier, contractsOnly);
    assert.deepEqual(supplier.groups.map((group) => group.type), ['contracts'], 'only the groups the caller reads');
    assert.equal(supplier.total, 1, 'the total counts the readable groups only');

    const higher: UsageCaller = { permissions: { contacts: 'reader', budget: 'admin', portfolio_projects: 'contributor', suppliers: 'member' } };
    const contact = await readContactUsages(runner.manager, w.tenantA, w.contact, higher);
    assert.deepEqual(contact.groups.map((group) => group.type), ['suppliers', 'budget_lines', 'projects'], 'any level from reader up reads a group');

    const none = await readContactUsages(runner.manager, w.tenantA, w.contact, { permissions: { contacts: 'reader' } });
    assert.deepEqual(none, { total: 0, groups: [] }, 'no group without the right to read it');
  });
}

async function testLimit() {
  await withWorld(async (runner, w) => {
    const count = USAGE_GROUP_LIMIT + 2;
    await runner.query(
      `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, supplier_id)
       SELECT $1, 'Bulk ' || n, 'EUR', '2020-01-01', 100 + n, $2 FROM generate_series(1, $3::int) AS n`,
      [w.tenantA, w.supplier, count],
    );
    const usages = await readSupplierUsages(runner.manager, w.tenantA, w.supplier, ADMIN);
    const lines = usages.groups.find((group) => group.type === 'budget_lines')!;
    assert.equal(lines.items.length, USAGE_GROUP_LIMIT, 'a group lists at most the limit');
    assert.equal(lines.total, count + 2, 'its total counts every line');
    assert.equal(usages.total, count + 2 + 3);
  });
}

async function testRouteRights() {
  const supplierMeta = Reflect.getMetadata(REQUIRE_LEVEL_KEY, SuppliersController.prototype.usages);
  const contactMeta = Reflect.getMetadata(REQUIRE_LEVEL_KEY, ContactsController.prototype.usages);
  assert.deepEqual(supplierMeta, { resource: 'suppliers', level: 'reader' });
  assert.deepEqual(contactMeta, { resource: 'contacts', level: 'reader' });
}

void runSpecs('record usages', [
  ['supplier usages: every type, both natures', testSupplierUsages],
  ['contact usages: every type, roles per object', testContactUsages],
  ['tenant isolation', testTenantIsolation],
  ['groups follow the caller\'s rights', testPermissions],
  ['limit per group with a total', testLimit],
  ['routes under the resource\'s read right', testRouteRights],
]);
