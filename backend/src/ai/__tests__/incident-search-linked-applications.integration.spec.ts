// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import { AiEntityService } from '../ai-entity.service';
import { Incident } from '../../incidents/incident.entity';
import { IncidentsService } from '../../incidents/services/incidents.service';
import { IncidentSearchLinkedApplicationsTechnologies1856030000000 } from '../../migrations/1856030000000-incident-search-linked-applications-technologies';
import { runSpecs, seedTenant, withRollback } from '../../analytics/__tests__/analytics-test-helpers';

/**
 * Incidents found by the name and reference of their linked applications and
 * technologies (migration 1856030000000). The asset text of 1855300000000 stays.
 *
 * Global search goes through `AiEntityService.searchAll` (the index used by
 * Plaid, the @-mention picker and the MCP server). The legacy incident search
 * (`AI_SEARCH_INDEX_ENABLED=false`) and the incidents list quick search are
 * checked on the same rows. Each scenario runs in its own transaction.
 */

const TITLE = 'Disk full on the tracker';
const ITEM_NUMBER = 9601;

function createEntityService(): AiEntityService {
  return new AiEntityService(
    {
      search: async () => ({ items: [], total: 0 }),
      searchMentionOptions: async () => ({ items: [], total: 0 }),
      listReadableLibraryIdsForUser: async () => null,
      getKnowledgeContextForEntity: async () => ({ access: 'granted', total: 0, groups: [] }),
    } as any,
    {
      listReadableEntityTypes: async (_context: unknown, requested: string[]) => requested,
      canReadKnowledge: async () => true,
      assertEntityTypeReadAccess: async () => undefined,
      adminFamiliesGap: async () => 'right',
      canReadEntityType: async () => false,
    } as any,
  );
}

function context(runner: QueryRunner, tenantId: string, userId: string) {
  return {
    tenantId,
    userId,
    isPlatformHost: false,
    surface: 'chat' as const,
    authMethod: 'jwt' as const,
    manager: runner.manager,
  };
}

function migration(): IncidentSearchLinkedApplicationsTechnologies1856030000000 {
  return new IncidentSearchLinkedApplicationsTechnologies1856030000000();
}

async function seedRole(runner: QueryRunner, tenantId: string, roleName: string): Promise<string> {
  const roleId = randomUUID();
  await runner.query(
    `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, $2, $3, $3, false, false, now(), now())`,
    [roleId, tenantId, roleName],
  );
  return roleId;
}

async function seedUser(
  runner: QueryRunner,
  tenantId: string,
  roleId: string,
  firstName: string,
  lastName: string,
): Promise<string> {
  const userId = randomUUID();
  await runner.query(
    `INSERT INTO users (
       id, tenant_id, first_name, last_name, email, password_hash, role_id,
       mfa_enabled, status, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, null, $6, false, 'enabled', now(), now())`,
    [userId, tenantId, firstName, lastName, `${firstName}.${lastName}.${userId.slice(0, 8)}@example.test`.toLowerCase(), roleId],
  );
  return userId;
}

async function seedIncident(
  runner: QueryRunner,
  tenantId: string,
  itemNumber: number,
  title: string,
  confidential = false,
  ownerUserId: string | null = null,
): Promise<string> {
  const incidentId = randomUUID();
  await runner.query(
    `INSERT INTO incidents (
       id, tenant_id, item_number, title, severity, status, confidential, owner_user_id, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, 'minor', 'open', $5, $6, now(), now())`,
    [incidentId, tenantId, itemNumber, title, confidential, ownerUserId],
  );
  return incidentId;
}

async function seedApplication(
  runner: QueryRunner,
  tenantId: string,
  name: string,
  reference: string,
): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO applications (tenant_id, name, sequential_id) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, name, reference],
  );
  return row.id as string;
}

async function seedTechnology(
  runner: QueryRunner,
  tenantId: string,
  name: string,
  itemNumber: number,
): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO technologies (tenant_id, item_number, name, family) VALUES ($1, $2, $3, 'database') RETURNING id`,
    [tenantId, itemNumber, name],
  );
  return row.id as string;
}

async function seedAsset(runner: QueryRunner, tenantId: string, hostname: string): Promise<string> {
  const assetId = randomUUID();
  await runner.query(
    `INSERT INTO assets (
       id, tenant_id, name, kind, environment, hostname, status, created_at, updated_at
     )
     VALUES ($1, $2, 'Tracker host', 'server', 'qa', $3, 'active', now(), now())`,
    [assetId, tenantId, hostname],
  );
  return assetId;
}

async function searchItems(
  service: AiEntityService,
  runner: QueryRunner,
  tenantId: string,
  userId: string,
  query: string,
): Promise<any[]> {
  const result = await service.searchAll(context(runner, tenantId, userId) as any, {
    query,
    entity_types: ['incidents'],
    limit: 10,
  });
  return result.items;
}

async function vectorMatches(
  runner: QueryRunner,
  tenantId: string,
  incidentId: string,
  query: string,
): Promise<boolean> {
  const [row] = await runner.query(
    `SELECT search_vector @@ websearch_to_tsquery('kanap_en', $3) AS matches
       FROM search_index
      WHERE tenant_id = $1 AND entity_type = 'incidents' AND entity_id = $2`,
    [tenantId, incidentId, query],
  );
  return row?.matches === true;
}

async function weightCOnly(
  runner: QueryRunner,
  tenantId: string,
  incidentId: string,
  query: string,
): Promise<boolean> {
  const [row] = await runner.query(
    `SELECT
       ts_filter(search_vector, '{C}') @@ websearch_to_tsquery('kanap_en', $3) AS weight_c,
       ts_filter(search_vector, '{A,B}') @@ websearch_to_tsquery('kanap_en', $3) AS weight_higher
       FROM search_index
      WHERE tenant_id = $1 AND entity_type = 'incidents' AND entity_id = $2`,
    [tenantId, incidentId, query],
  );
  return row?.weight_c === true && row?.weight_higher !== true;
}

async function withLegacySearch<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.AI_SEARCH_INDEX_ENABLED;
  process.env.AI_SEARCH_INDEX_ENABLED = 'false';
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.AI_SEARCH_INDEX_ENABLED;
    else process.env.AI_SEARCH_INDEX_ENABLED = previous;
  }
}

async function linkedApplicationAndTechnology() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'inc-linked-catalog');
    const roleId = await seedRole(runner, tenantId, 'Member');
    const userId = await seedUser(runner, tenantId, roleId, 'Lea', 'Reader');
    const service = createEntityService();
    await migration().up(runner);

    const applicationId = await seedApplication(runner, tenantId, 'CheeseTrack', 'APP-9601');
    const technologyId = await seedTechnology(runner, tenantId, 'PostgreSQL', 9601);
    const incidentId = await seedIncident(runner, tenantId, ITEM_NUMBER, TITLE);
    await runner.query(
      `INSERT INTO incident_applications (tenant_id, incident_id, application_id) VALUES ($1, $2, $3)`,
      [tenantId, incidentId, applicationId],
    );
    await runner.query(
      `INSERT INTO incident_technologies (tenant_id, incident_id, technology_id) VALUES ($1, $2, $3)`,
      [tenantId, incidentId, technologyId],
    );

    for (const query of ['CheeseTrack', 'APP-9601', 'PostgreSQL', 'TEC-9601']) {
      assert.equal(await vectorMatches(runner, tenantId, incidentId, query), true, `${query} is in the incident vector`);
      assert.equal(await weightCOnly(runner, tenantId, incidentId, query), true, `${query} is indexed at weight C`);
    }

    const byApplication = await searchItems(service, runner, tenantId, userId, 'CheeseTrack');
    const incident = byApplication.find((item) => item.id === incidentId);
    assert.ok(incident, 'the global search finds the incident by the linked application name');
    assert.equal(incident.label, TITLE, 'the result names the incident');
    assert.equal(incident.ref, `INC-${ITEM_NUMBER}`, 'the result carries the incident reference');
    assert.equal(JSON.stringify(incident).includes('CheeseTrack'), false, 'the result does not carry the linked name');
    assert.equal(
      (await searchItems(service, runner, tenantId, userId, 'APP-9601')).some((item) => item.id === incidentId),
      true,
      'the global search finds the incident by the application reference',
    );
    assert.equal(
      (await searchItems(service, runner, tenantId, userId, 'PostgreSQL')).some((item) => item.id === incidentId),
      true,
      'the global search finds the incident by the linked technology name',
    );
    assert.equal(
      (await searchItems(service, runner, tenantId, userId, 'TEC-9601')).some((item) => item.id === incidentId),
      true,
      'the global search finds the incident by the technology reference',
    );

    await withLegacySearch(async () => {
      assert.equal(
        (await searchItems(service, runner, tenantId, userId, 'CheeseTrack')).some((item) => item.id === incidentId),
        true,
        'the legacy incident search finds the incident by the linked application',
      );
      assert.equal(
        (await searchItems(service, runner, tenantId, userId, 'PostgreSQL')).some((item) => item.id === incidentId),
        true,
        'the legacy incident search finds the incident by the linked technology',
      );
    });

    const incidents = new IncidentsService(
      runner.manager.getRepository(Incident),
      { log: async () => undefined } as any,
      null as any,
      null as any,
    );
    const listed = async (q: string, technologies: boolean, applications: boolean) => (
      await incidents.list({ q }, {
        manager: runner.manager,
        tenantId,
        technologies,
        applications,
        viewer: { userId: null, isAdmin: true },
      })
    ).total;
    assert.equal(await listed('CheeseTrack', true, true), 1, 'the list search matches the application');
    assert.equal(await listed('APP-9601', true, true), 1, 'the list search matches the application reference');
    assert.equal(await listed('PostgreSQL', true, true), 1, 'the list search matches the technology');
    assert.equal(await listed('TEC-9601', true, true), 1, 'the list search matches the technology reference');
    assert.equal(await listed('PostgreSQL', false, true), 0, 'without the infrastructure read, the technology name does not match');
    assert.equal(await listed('CheeseTrack', true, false), 0, 'without the applications read, the application name does not match');
    assert.equal(await listed(TITLE, false, false), 1, 'the title still matches when linked names are hidden');

    await runner.query(`UPDATE applications SET name = 'ButterTrack' WHERE tenant_id = $1 AND id = $2`, [tenantId, applicationId]);
    assert.equal(await vectorMatches(runner, tenantId, incidentId, 'CheeseTrack'), false, 'the old application name leaves the vector');
    assert.equal(await vectorMatches(runner, tenantId, incidentId, 'ButterTrack'), true, 'the new application name enters the vector');
    assert.equal(
      (await searchItems(service, runner, tenantId, userId, 'ButterTrack')).some((item) => item.id === incidentId),
      true,
      'the global search follows the renamed application',
    );

    await runner.query(`UPDATE applications SET sequential_id = 'APP-9602' WHERE tenant_id = $1 AND id = $2`, [tenantId, applicationId]);
    assert.equal(await vectorMatches(runner, tenantId, incidentId, 'APP-9601'), false, 'the old application reference leaves the vector');
    assert.equal(await vectorMatches(runner, tenantId, incidentId, 'APP-9602'), true, 'the new application reference enters the vector');

    await runner.query(`DELETE FROM incident_applications WHERE tenant_id = $1 AND incident_id = $2`, [tenantId, incidentId]);
    assert.equal(await vectorMatches(runner, tenantId, incidentId, 'ButterTrack'), false, 'unlinking the application drops its name');
    assert.equal(await vectorMatches(runner, tenantId, incidentId, 'APP-9602'), false, 'unlinking the application drops its reference');
    assert.equal(
      (await searchItems(service, runner, tenantId, userId, 'ButterTrack')).some((item) => item.id === incidentId),
      false,
      'the incident is no longer found by the unlinked application',
    );
    assert.equal(await vectorMatches(runner, tenantId, incidentId, 'PostgreSQL'), true, 'the technology text stays when the application is unlinked');

    await runner.query(`UPDATE technologies SET name = 'ZephyrDB' WHERE tenant_id = $1 AND id = $2`, [tenantId, technologyId]);
    assert.equal(await vectorMatches(runner, tenantId, incidentId, 'PostgreSQL'), false, 'the old technology name leaves the vector');
    assert.equal(await vectorMatches(runner, tenantId, incidentId, 'ZephyrDB'), true, 'the new technology name enters the vector');
    assert.equal(
      (await searchItems(service, runner, tenantId, userId, 'ZephyrDB')).some((item) => item.id === incidentId),
      true,
      'the global search follows the renamed technology',
    );

    await runner.query(`UPDATE technologies SET item_number = 9602 WHERE tenant_id = $1 AND id = $2`, [tenantId, technologyId]);
    assert.equal(await vectorMatches(runner, tenantId, incidentId, 'TEC-9601'), false, 'the old technology reference leaves the vector');
    assert.equal(await vectorMatches(runner, tenantId, incidentId, 'TEC-9602'), true, 'the new technology reference enters the vector');

    await runner.query(`DELETE FROM incident_technologies WHERE tenant_id = $1 AND incident_id = $2`, [tenantId, incidentId]);
    assert.equal(await vectorMatches(runner, tenantId, incidentId, 'ZephyrDB'), false, 'unlinking the technology drops its name');
    assert.equal(await vectorMatches(runner, tenantId, incidentId, 'TEC-9602'), false, 'unlinking the technology drops its reference');
    assert.equal(
      (await searchItems(service, runner, tenantId, userId, 'ZephyrDB')).some((item) => item.id === incidentId),
      false,
      'the incident is no longer found by the unlinked technology',
    );
  });
}

async function migrationDownRestoresAssetBody() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'inc-linked-catalog-down');
    await migration().up(runner);

    const applicationId = await seedApplication(runner, tenantId, 'CheeseTrack', 'APP-9611');
    const technologyId = await seedTechnology(runner, tenantId, 'PostgreSQL', 9611);
    const assetId = await seedAsset(runner, tenantId, 'QA-CATALOG-01');
    const incidentId = await seedIncident(runner, tenantId, 9611, 'Incident with three links');
    await runner.query(
      `INSERT INTO incident_applications (tenant_id, incident_id, application_id) VALUES ($1, $2, $3)`,
      [tenantId, incidentId, applicationId],
    );
    await runner.query(
      `INSERT INTO incident_technologies (tenant_id, incident_id, technology_id) VALUES ($1, $2, $3)`,
      [tenantId, incidentId, technologyId],
    );
    await runner.query(
      `INSERT INTO incident_assets (tenant_id, incident_id, asset_id) VALUES ($1, $2, $3)`,
      [tenantId, incidentId, assetId],
    );
    assert.equal(await vectorMatches(runner, tenantId, incidentId, 'CheeseTrack'), true);
    assert.equal(await vectorMatches(runner, tenantId, incidentId, 'PostgreSQL'), true);
    assert.equal(await vectorMatches(runner, tenantId, incidentId, 'QA-CATALOG-01'), true);

    await migration().down(runner);
    const [downFunction] = await runner.query(
      `SELECT prosrc FROM pg_proc WHERE proname = 'search_index_refresh_incidents'`,
    );
    const downSource = String(downFunction?.prosrc ?? '');
    assert.match(downSource, /incident_assets/, 'down keeps the linked asset text');
    assert.doesNotMatch(downSource, /incident_applications/, 'down removes the linked application text');
    assert.doesNotMatch(downSource, /incident_technologies/, 'down removes the linked technology text');
    const dropped = await runner.query(
      `SELECT tgname FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgname IN (
            'trg_search_index_link_incident_applications_insert',
            'trg_search_index_link_incident_applications_update',
            'trg_search_index_link_incident_applications_delete',
            'trg_search_index_link_incident_technologies_insert',
            'trg_search_index_link_incident_technologies_update',
            'trg_search_index_link_incident_technologies_delete',
            'trg_search_index_incident_applications_on_application',
            'trg_search_index_incident_technologies_on_technology'
          )`,
    );
    assert.deepEqual(dropped, [], 'down removes the eight maintenance triggers');
    const assetTrigger = await runner.query(
      `SELECT tgname FROM pg_trigger
        WHERE NOT tgisinternal AND tgname = 'trg_search_index_incident_assets_on_asset'`,
    );
    assert.equal(assetTrigger.length, 1, 'down leaves the asset maintenance trigger in place');
    assert.equal(await vectorMatches(runner, tenantId, incidentId, 'CheeseTrack'), false, 'down reindexes without the application name');
    assert.equal(await vectorMatches(runner, tenantId, incidentId, 'PostgreSQL'), false, 'down reindexes without the technology name');
    assert.equal(await vectorMatches(runner, tenantId, incidentId, 'QA-CATALOG-01'), true, 'down keeps the linked asset text in the entry');

    await migration().up(runner);
    const [upFunction] = await runner.query(
      `SELECT prosrc FROM pg_proc WHERE proname = 'search_index_refresh_incidents'`,
    );
    const upSource = String(upFunction?.prosrc ?? '');
    assert.match(upSource, /incident_applications/, 'up puts the application text back');
    assert.match(upSource, /incident_technologies/, 'up puts the technology text back');
    assert.equal(await vectorMatches(runner, tenantId, incidentId, 'CheeseTrack'), true, 'up reindexes the application name');
    assert.equal(await vectorMatches(runner, tenantId, incidentId, 'PostgreSQL'), true, 'up reindexes the technology name');
    assert.equal(await vectorMatches(runner, tenantId, incidentId, 'QA-CATALOG-01'), true, 'up keeps the asset text');
  });
}

async function restrictedIncidentVisibility() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'inc-linked-catalog-acl');
    const adminRoleId = await seedRole(runner, tenantId, 'Administrator');
    const memberRoleId = await seedRole(runner, tenantId, 'Member');
    const adminId = await seedUser(runner, tenantId, adminRoleId, 'Ada', 'Admin');
    const readerId = await seedUser(runner, tenantId, memberRoleId, 'Remi', 'Reader');
    const ownerId = await seedUser(runner, tenantId, memberRoleId, 'Olga', 'Owner');
    const service = createEntityService();
    await migration().up(runner);

    const applicationId = await seedApplication(runner, tenantId, 'CheeseTrack', 'APP-9621');
    const restrictedId = await seedIncident(runner, tenantId, 9621, 'Restricted tracker outage', true, ownerId);
    await runner.query(
      `INSERT INTO incident_applications (tenant_id, incident_id, application_id) VALUES ($1, $2, $3)`,
      [tenantId, restrictedId, applicationId],
    );

    const ids = (userId: string) => searchItems(service, runner, tenantId, userId, 'CheeseTrack')
      .then((items) => items.map((item) => item.id));
    assert.equal((await ids(readerId)).includes(restrictedId), false, 'a reader does not see the restricted incident by its application');
    assert.equal((await ids(adminId)).includes(restrictedId), true, 'an incidents administrator sees the restricted incident');
    assert.equal((await ids(ownerId)).includes(restrictedId), true, 'the owner sees the restricted incident');

    const publicId = await seedIncident(runner, tenantId, 9622, 'Public tracker outage');
    await runner.query(
      `INSERT INTO incident_applications (tenant_id, incident_id, application_id) VALUES ($1, $2, $3)`,
      [tenantId, publicId, applicationId],
    );
    const readerIds = await ids(readerId);
    assert.equal(readerIds.includes(publicId), true, 'the same application still finds the public incident');
    assert.equal(readerIds.includes(restrictedId), false, 'the restricted incident stays hidden');
  });
}

async function run() {
  await runSpecs('incident-search-linked-applications', [
    linkedApplicationAndTechnology,
    migrationDownRestoresAssetBody,
    restrictedIncidentVisibility,
  ]);
}

void run();
