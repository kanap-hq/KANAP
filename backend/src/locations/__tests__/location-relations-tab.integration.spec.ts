// @database-spec
import 'dotenv/config';
import { NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { assert, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { LocationsController } from '../locations.controller';
import { LocationsService } from '../locations.service';

// GET /locations/:id/relations and /relation-counts (lot R2g), on an empty migrated database:
// the assets at the location and the applications that run on them, the sections a caller cannot
// read, a Business Contributor's participation, sub-locations, the badge, and another tenant.

type Ref = { id: string; reference: string };

type Seed = {
  tenantId: string;
  readerId: string;
  contributorId: string;
  locationId: string;
  locationRef: string;
  bareId: string;
  subId: string;
  assets: { alpha: Ref; zulu: Ref; elsewhere: Ref };
  apps: { alpha: Ref; mid: Ref; elsewhere: Ref };
};

const ALL = { locations: 'reader', infrastructure: 'reader', applications: 'reader' };

function httpOf() {
  const svc = new LocationsService(undefined as any, undefined as any, undefined as any, undefined as any);
  return new LocationsController(svc, undefined as any);
}

function ctx(runner: QueryRunner, seed: Seed, permissions: Record<string, string>, userId: string = seed.readerId) {
  return { tenantId: seed.tenantId, userId, userRoles: [], isAdmin: false, permissions, manager: runner.manager } as any;
}

async function rejection(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected a refusal');
}

async function seedTab(runner: QueryRunner, tag: string): Promise<Seed> {
  const tenantId = await seedTenant(runner, tag);
  const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0];
  const readerRole = (await one(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Site reader') RETURNING id`, [tenantId])).id;
  const contributorRole = (await one(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Business Contributor') RETURNING id`, [tenantId])).id;
  await runner.query(
    `INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, 'applications', 'reader')`,
    [tenantId, contributorRole],
  );
  const user = (roleId: string, name: string) => one(
    `INSERT INTO users (tenant_id, email, role_id, first_name, last_name) VALUES ($1, $2, $3, $4, 'Martin') RETURNING id`,
    [tenantId, `${name}-${tag}-${tenantId.slice(0, 8)}@example.test`, roleId, name],
  ).then((row) => row.id as string);
  const readerId = await user(readerRole, 'Rita');
  const contributorId = await user(contributorRole, 'Ada');

  const location = async (name: string) => one(
    `INSERT INTO locations (tenant_id, name, hosting_type) VALUES ($1, $2, 'on_prem') RETURNING id, location_reference`,
    [tenantId, name],
  );
  const site = await location(`Lyon DC ${tag}`);
  const bare = await location(`Empty site ${tag}`);
  const other = await location(`Paris DC ${tag}`);
  const subId = (await one(
    `INSERT INTO location_sub_items (tenant_id, location_id, name) VALUES ($1, $2, 'Room A') RETURNING id`,
    [tenantId, site.id],
  )).id as string;

  const asset = async (name: string, locationId: string, columns: { sub?: string; provider?: string; environment?: string; kind?: string } = {}) => {
    const row = await one(
      `INSERT INTO assets (tenant_id, name, kind, environment, status, location_id, sub_location_id, provider)
       VALUES ($1, $2, $3, $4, 'active', $5, $6, $7) RETURNING id, asset_reference AS reference`,
      [tenantId, name, columns.kind ?? 'physical_server', columns.environment ?? 'prod', locationId, columns.sub ?? null, columns.provider ?? null],
    );
    return { id: row.id as string, reference: row.reference as string };
  };
  // Zulu sorts after alpha whatever the case.
  const zulu = await asset('zulu host', site.id, { environment: 'dev', kind: 'virtual_machine' });
  const alpha = await asset('Alpha host', site.id, { sub: subId, provider: 'dell' });
  const elsewhere = await asset('Elsewhere host', other.id);

  const application = async (name: string, lifecycle = 'active') => {
    const row = await one(
      `INSERT INTO applications (tenant_id, name, lifecycle) VALUES ($1, $2, $3) RETURNING id, sequential_id AS reference`,
      [tenantId, name, lifecycle],
    );
    return { id: row.id as string, reference: row.reference as string };
  };
  const alphaApp = await application('Alpha app');
  const midApp = await application('Mid app', 'proposed');
  const elsewhereApp = await application('Elsewhere app');
  await runner.query(
    `INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`,
    [tenantId, midApp.id, contributorId],
  );
  const instance = async (appId: string, environment: string) => (await one(
    `INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, appId, environment],
  )).id as string;
  const assign = (instanceId: string, assetId: string) => runner.query(
    `INSERT INTO app_asset_assignments (tenant_id, app_instance_id, asset_id, role) VALUES ($1, $2, $3, 'app')`,
    [tenantId, instanceId, assetId],
  );
  const alphaProd = await instance(alphaApp.id, 'prod');
  const alphaDev = await instance(alphaApp.id, 'dev');
  const midProd = await instance(midApp.id, 'prod');
  // Alpha app runs twice on the site (two assets, two environments), once elsewhere.
  await assign(alphaProd, alpha.id);
  await assign(alphaDev, zulu.id);
  await assign(alphaProd, zulu.id);
  await assign(midProd, alpha.id);
  await assign(await instance(elsewhereApp.id, 'prod'), elsewhere.id);

  await runner.query(
    `INSERT INTO location_links (tenant_id, location_id, url, description) VALUES ($1, $2, 'https://a.example', 'Portal'), ($1, $2, 'https://b.example', NULL)`,
    [tenantId, site.id],
  );

  return {
    tenantId,
    readerId,
    contributorId,
    locationId: site.id,
    locationRef: site.location_reference,
    bareId: bare.id,
    subId,
    assets: { alpha, zulu, elsewhere },
    apps: { alpha: alphaApp, mid: midApp, elsewhere: elsewhereApp },
  };
}

async function testPayload() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'locrel-payload');
    const http = httpOf();
    const res = await http.relations(seed.locationId, ctx(runner, seed, ALL));
    assert.deepEqual(res.assets, [
      {
        id: seed.assets.alpha.id, reference: seed.assets.alpha.reference, name: 'Alpha host', kind: 'physical_server',
        environment: 'prod', status: 'active', provider: 'dell', sub_location_id: seed.subId, sub_location_name: 'Room A',
      },
      {
        id: seed.assets.zulu.id, reference: seed.assets.zulu.reference, name: 'zulu host', kind: 'virtual_machine',
        environment: 'dev', status: 'active', provider: null, sub_location_id: null, sub_location_name: null,
      },
    ]);
    assert.match(seed.assets.alpha.reference, /^AST-\d+$/);
    assert.deepEqual(res.applications, [
      { id: seed.apps.alpha.id, reference: seed.apps.alpha.reference, name: 'Alpha app', lifecycle: 'active', status: 'enabled', environments: ['dev', 'prod'] },
      { id: seed.apps.mid.id, reference: seed.apps.mid.reference, name: 'Mid app', lifecycle: 'proposed', status: 'enabled', environments: ['prod'] },
    ]);
    assert.match(seed.apps.alpha.reference, /^APP-\d+$/);

    const byRef = await http.relations(seed.locationRef, ctx(runner, seed, ALL));
    assert.deepEqual(byRef, res);

    const empty = await http.relations(seed.bareId, ctx(runner, seed, ALL));
    assert.deepEqual(empty, { assets: [], applications: [] });

    // The badge counts two assets, two applications and two web links.
    assert.deepEqual(await http.relationCounts(seed.locationId, ctx(runner, seed, ALL)), { relations: 6 });
    assert.deepEqual(await http.relationCounts(seed.bareId, ctx(runner, seed, ALL)), { relations: 0 });
  });
}

async function testSectionsWithoutRead() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'locrel-rights');
    const http = httpOf();
    const noInfra = ctx(runner, seed, { locations: 'reader', applications: 'reader' });
    const res = await http.relations(seed.locationId, noInfra);
    assert.equal(res.assets, null);
    assert.deepEqual(res.applications?.map((row) => row.id), [seed.apps.alpha.id, seed.apps.mid.id]);
    assert.deepEqual(await http.relationCounts(seed.locationId, noInfra), { relations: 4 });

    const noApps = ctx(runner, seed, { locations: 'reader', infrastructure: 'reader' });
    const other = await http.relations(seed.locationId, noApps);
    assert.equal(other.applications, null);
    assert.equal(other.assets?.length, 2);
    assert.deepEqual(await http.relationCounts(seed.locationId, noApps), { relations: 4 });

    const bare = ctx(runner, seed, { locations: 'reader' });
    assert.deepEqual(await http.relations(seed.locationId, bare), { assets: null, applications: null });
    assert.deepEqual(await http.relationCounts(seed.locationId, bare), { relations: 2 });
  });
}

async function testContributor() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'locrel-contrib');
    const http = httpOf();
    const contributor = ctx(runner, seed, ALL, seed.contributorId);
    const res = await http.relations(seed.locationId, contributor);
    assert.deepEqual(res.applications?.map((row) => row.id), [seed.apps.mid.id]);
    assert.equal(res.assets?.length, 2);
    assert.deepEqual(await http.relationCounts(seed.locationId, contributor), { relations: 5 });
  });
}

async function testUnknownLocation() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'locrel-unknown');
    const http = httpOf();
    for (const id of ['LOC-999999', '00000000-0000-4000-8000-000000000000', 'not-an-id']) {
      const err = await rejection(() => http.relations(id, ctx(runner, seed, ALL)));
      assert.ok(err instanceof NotFoundException, err.message);
      const counts = await rejection(() => http.relationCounts(id, ctx(runner, seed, ALL)));
      assert.ok(counts instanceof NotFoundException, counts.message);
    }
  });
}

async function testTenantIsolation() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seedTab(runner, 'locrel-a');
    const b = await seedTab(runner, 'locrel-b');
    await setTenant(runner, b.tenantId);
    const http = httpOf();
    for (const call of [
      () => http.relations(a.locationId, ctx(runner, b, ALL)),
      () => http.relationCounts(a.locationId, ctx(runner, b, ALL)),
    ]) {
      const err = await rejection(call);
      assert.ok(err instanceof NotFoundException, err.message);
    }
    const own = await http.relations(b.locationId, ctx(runner, b, ALL));
    assert.deepEqual(own.assets?.map((row) => row.id), [b.assets.alpha.id, b.assets.zulu.id]);
    assert.deepEqual(own.applications?.map((row) => row.id), [b.apps.alpha.id, b.apps.mid.id]);

    await setTenant(runner, a.tenantId);
    const back = await http.relations(a.locationId, ctx(runner, a, ALL));
    assert.deepEqual(back.assets?.map((row) => row.id), [a.assets.alpha.id, a.assets.zulu.id]);
    assert.deepEqual(await http.relationCounts(a.locationId, ctx(runner, a, ALL)), { relations: 6 });
  });
}

function testPermissionMetadata() {
  const proto = LocationsController.prototype;
  assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto.relations), { resource: 'locations', level: 'reader' });
  assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto.relationCounts), { resource: 'locations', level: 'reader' });
  return Promise.resolve();
}

void runSpecs('location-relations-tab.integration.spec', [
  ['testPermissionMetadata', testPermissionMetadata],
  ['testPayload', testPayload],
  ['testSectionsWithoutRead', testSectionsWithoutRead],
  ['testContributor', testContributor],
  ['testUnknownLocation', testUnknownLocation],
  ['testTenantIsolation', testTenantIsolation],
]);
