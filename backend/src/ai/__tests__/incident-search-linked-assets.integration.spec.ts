// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import { AiEntityService } from '../ai-entity.service';
import { IncidentSearchLinkedAssets1855300000000 } from '../../migrations/1855300000000-incident-search-linked-assets';
import { runSpecs, seedTenant, withRollback } from '../../analytics/__tests__/analytics-test-helpers';

/**
 * Incidents found by the name, reference, hostname or FQDN of their linked assets
 * (migration 1855300000000).
 *
 * The search goes through `AiEntityService.searchAll`, the indexed path used by Plaid,
 * the @-mention picker and the MCP server. Each scenario runs in its own transaction,
 * rolled back at the end.
 */

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

async function seedAsset(
  runner: QueryRunner,
  tenantId: string,
  values: { name: string; reference?: string | null; hostname: string | null; fqdn: string | null },
): Promise<string> {
  const assetId = randomUUID();
  await runner.query(
    `INSERT INTO assets (
       id, tenant_id, name, asset_reference, kind, environment, hostname, fqdn, status, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, 'server', 'qa', $5, $6, 'active', now(), now())`,
    [assetId, tenantId, values.name, values.reference ?? null, values.hostname, values.fqdn],
  );
  return assetId;
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

async function linkAsset(runner: QueryRunner, tenantId: string, incidentId: string, assetId: string): Promise<void> {
  await runner.query(
    `INSERT INTO incident_assets (tenant_id, incident_id, asset_id) VALUES ($1, $2, $3)`,
    [tenantId, incidentId, assetId],
  );
}

async function searchIncidentIds(
  service: AiEntityService,
  runner: QueryRunner,
  tenantId: string,
  userId: string,
  query: string,
): Promise<string[]> {
  const result = await service.searchAll(context(runner, tenantId, userId) as any, {
    query,
    entity_types: ['incidents'],
    limit: 10,
  });
  return result.items.map((item: any) => item.id);
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

async function migrationReplay() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'inc-linked-assets-replay');
    const assetId = await seedAsset(runner, tenantId, {
      name: 'Serveur replay',
      hostname: 'QA-REPLAY-01',
      fqdn: null,
    });
    const incidentId = await seedIncident(runner, tenantId, 9401, 'Incident rejoué');
    await linkAsset(runner, tenantId, incidentId, assetId);

    const migration = new IncidentSearchLinkedAssets1855300000000();
    // The migration is already applied on this database: running it again must replace
    // the same functions and triggers, and rewrite the same entries.
    await migration.up(runner);
    await migration.up(runner);
    assert.equal(
      await vectorMatches(runner, tenantId, incidentId, 'QA-REPLAY-01'),
      true,
      'the replay reindexes the existing incidents',
    );

    const [refresh] = await runner.query(
      `SELECT prosrc FROM pg_proc WHERE proname = 'search_index_refresh_incidents'`,
    );
    assert.match(String(refresh?.prosrc ?? ''), /incident_assets/, 'replay keeps the linked asset text');
    const triggers = await runner.query(
      `SELECT tgname FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgname IN (
            'trg_search_index_link_incident_assets_insert',
            'trg_search_index_link_incident_assets_update',
            'trg_search_index_link_incident_assets_delete',
            'trg_search_index_incident_assets_on_asset'
          )
        ORDER BY tgname`,
    );
    assert.deepEqual(
      triggers.map((row: any) => row.tgname),
      [
        'trg_search_index_incident_assets_on_asset',
        'trg_search_index_link_incident_assets_delete',
        'trg_search_index_link_incident_assets_insert',
        'trg_search_index_link_incident_assets_update',
      ],
      'the four maintenance triggers exist after a replay',
    );
  });
}

async function migrationDownThenUp() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'inc-linked-assets-down-up');
    const assetId = await seedAsset(runner, tenantId, {
      name: 'Serveur down up',
      hostname: 'QA-DOWN-UP-01',
      fqdn: null,
    });
    const incidentId = await seedIncident(runner, tenantId, 9411, 'Incident down up');
    await linkAsset(runner, tenantId, incidentId, assetId);

    const migration = new IncidentSearchLinkedAssets1855300000000();
    await migration.down(runner);
    const [downFunction] = await runner.query(
      `SELECT prosrc FROM pg_proc WHERE proname = 'search_index_refresh_incidents'`,
    );
    assert.doesNotMatch(
      String(downFunction?.prosrc ?? ''),
      /incident_assets/,
      'down removes the linked asset text from the refresh function',
    );
    const downTriggers = await runner.query(
      `SELECT tgname FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgname IN (
            'trg_search_index_link_incident_assets_insert',
            'trg_search_index_link_incident_assets_update',
            'trg_search_index_link_incident_assets_delete',
            'trg_search_index_incident_assets_on_asset'
          )
        ORDER BY tgname`,
    );
    assert.deepEqual(downTriggers, [], 'down removes the four maintenance triggers');
    assert.equal(
      await vectorMatches(runner, tenantId, incidentId, 'QA-DOWN-UP-01'),
      false,
      'down reindexes the entries without the linked asset text',
    );

    await migration.up(runner);
    const [upFunction] = await runner.query(
      `SELECT prosrc FROM pg_proc WHERE proname = 'search_index_refresh_incidents'`,
    );
    assert.match(
      String(upFunction?.prosrc ?? ''),
      /incident_assets/,
      'up puts the linked asset text back in the refresh function',
    );
    assert.equal(
      await vectorMatches(runner, tenantId, incidentId, 'QA-DOWN-UP-01'),
      true,
      'up reindexes the entries with the linked asset text',
    );
  });
}

async function movedLink() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'inc-linked-assets-move');
    const assetId = await seedAsset(runner, tenantId, {
      name: 'Serveur déplacé',
      hostname: 'QA-MOVE-01',
      fqdn: null,
    });
    const firstId = await seedIncident(runner, tenantId, 9501, 'Premier incident du lien');
    const secondId = await seedIncident(runner, tenantId, 9502, 'Deuxième incident du lien');
    await linkAsset(runner, tenantId, firstId, assetId);
    assert.equal(await vectorMatches(runner, tenantId, firstId, 'QA-MOVE-01'), true);
    assert.equal(await vectorMatches(runner, tenantId, secondId, 'QA-MOVE-01'), false);

    await runner.query(
      `UPDATE incident_assets SET incident_id = $1
        WHERE tenant_id = $2 AND incident_id = $3 AND asset_id = $4`,
      [secondId, tenantId, firstId, assetId],
    );
    assert.equal(
      await vectorMatches(runner, tenantId, firstId, 'QA-MOVE-01'),
      false,
      'the old incident loses the asset text when the link moves',
    );
    assert.equal(
      await vectorMatches(runner, tenantId, secondId, 'QA-MOVE-01'),
      true,
      'the new incident gains the asset text when the link moves',
    );
  });
}

async function linkedAssetText() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'inc-linked-assets');
    const roleId = await seedRole(runner, tenantId, 'Member');
    const userId = await seedUser(runner, tenantId, roleId, 'Léa', 'Lectrice');
    const service = createEntityService();

    const assetId = await seedAsset(runner, tenantId, {
      name: 'Serveur QA Alpha',
      reference: 'AST-4711',
      hostname: 'QA-HOST-01',
      fqdn: 'qa-host-01.example.test',
    });
    const incidentId = await seedIncident(runner, tenantId, 9101, 'Saturation du disque système');
    await linkAsset(runner, tenantId, incidentId, assetId);

    assert.equal(
      await vectorMatches(runner, tenantId, incidentId, 'QA-HOST-01'),
      true,
      'the hostname is in the incident vector',
    );
    assert.equal(
      await vectorMatches(runner, tenantId, incidentId, 'qa-host-01.example.test'),
      true,
      'the FQDN is in the incident vector',
    );
    assert.equal(
      await vectorMatches(runner, tenantId, incidentId, 'Serveur QA Alpha'),
      true,
      'the asset name is in the incident vector',
    );
    assert.equal(
      await vectorMatches(runner, tenantId, incidentId, 'AST-4711'),
      true,
      'the asset reference is in the incident vector',
    );

    assert.equal(
      (await searchIncidentIds(service, runner, tenantId, userId, 'QA-HOST-01')).includes(incidentId),
      true,
      'the global search finds the incident by linked asset hostname',
    );
    assert.equal(
      (await searchIncidentIds(service, runner, tenantId, userId, 'qa-host-01.example.test')).includes(incidentId),
      true,
      'the global search finds the incident by linked asset FQDN',
    );
    assert.equal(
      (await searchIncidentIds(service, runner, tenantId, userId, 'Serveur QA Alpha')).includes(incidentId),
      true,
      'the global search finds the incident by linked asset name',
    );
    assert.equal(
      (await searchIncidentIds(service, runner, tenantId, userId, 'AST-4711')).includes(incidentId),
      true,
      'the global search finds the incident by linked asset reference',
    );

    // A reference-only update refreshes the entry: asset_reference is in UPDATE OF.
    await runner.query(
      `UPDATE assets SET asset_reference = 'AST-4712' WHERE tenant_id = $1 AND id = $2`,
      [tenantId, assetId],
    );
    assert.equal(
      await vectorMatches(runner, tenantId, incidentId, 'AST-4711'),
      false,
      'the old reference is gone from the vector',
    );
    assert.equal(
      await vectorMatches(runner, tenantId, incidentId, 'AST-4712'),
      true,
      'the new reference is in the vector',
    );
    assert.equal(
      (await searchIncidentIds(service, runner, tenantId, userId, 'AST-4712')).includes(incidentId),
      true,
      'the global search finds the incident by the new asset reference',
    );

    // Removing the link refreshes the entry and drops the asset text.
    await runner.query(`DELETE FROM incident_assets WHERE tenant_id = $1 AND incident_id = $2`, [tenantId, incidentId]);
    assert.equal(
      await vectorMatches(runner, tenantId, incidentId, 'QA-HOST-01'),
      false,
      'the removed hostname is gone from the vector',
    );
    assert.equal(
      (await searchIncidentIds(service, runner, tenantId, userId, 'QA-HOST-01')).includes(incidentId),
      false,
      'the incident is no longer found by the removed linked asset',
    );
    assert.equal(
      await vectorMatches(runner, tenantId, incidentId, 'AST-4712'),
      false,
      'the removed asset reference is gone from the vector',
    );

    // Renaming the asset refreshes the incidents linked to it.
    await linkAsset(runner, tenantId, incidentId, assetId);
    await runner.query(
      `UPDATE assets SET name = 'Serveur QA Beta', hostname = 'QA-HOST-02', fqdn = 'qa-host-02.example.test'
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, assetId],
    );
    assert.equal(
      await vectorMatches(runner, tenantId, incidentId, 'QA-HOST-01'),
      false,
      'the old hostname is gone from the vector',
    );
    assert.equal(
      await vectorMatches(runner, tenantId, incidentId, 'Serveur QA Alpha'),
      false,
      'the old name is gone from the vector',
    );
    assert.equal(
      await vectorMatches(runner, tenantId, incidentId, 'QA-HOST-02'),
      true,
      'the new hostname is in the vector',
    );
    assert.equal(
      await vectorMatches(runner, tenantId, incidentId, 'Serveur QA Beta'),
      true,
      'the new name is in the vector',
    );
    assert.equal(
      (await searchIncidentIds(service, runner, tenantId, userId, 'QA-HOST-02')).includes(incidentId),
      true,
      'the global search finds the incident under the new asset name',
    );

    // Deleting the asset cascades to the link and refreshes the incident again.
    await runner.query(`DELETE FROM assets WHERE tenant_id = $1 AND id = $2`, [tenantId, assetId]);
    assert.equal(
      await vectorMatches(runner, tenantId, incidentId, 'QA-HOST-02'),
      false,
      'the deleted asset hostname is gone from the vector',
    );
    assert.equal(
      (await searchIncidentIds(service, runner, tenantId, userId, 'QA-HOST-02')).includes(incidentId),
      false,
      'the incident is no longer found once the asset is deleted',
    );
    assert.equal(
      await vectorMatches(runner, tenantId, incidentId, 'AST-4712'),
      false,
      'the deleted asset reference is gone from the vector',
    );
  });
}

async function restrictedIncidentVisibility() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'inc-linked-assets-acl');
    const adminRoleId = await seedRole(runner, tenantId, 'Administrator');
    const memberRoleId = await seedRole(runner, tenantId, 'Member');
    const adminId = await seedUser(runner, tenantId, adminRoleId, 'Ada', 'Admin');
    const readerId = await seedUser(runner, tenantId, memberRoleId, 'Rémi', 'Lecteur');
    const ownerId = await seedUser(runner, tenantId, memberRoleId, 'Olga', 'Responsable');
    const service = createEntityService();

    const assetId = await seedAsset(runner, tenantId, {
      name: 'Serveur restreint',
      hostname: 'RESTRICTED-HOST-01',
      fqdn: null,
    });
    const restrictedId = await seedIncident(
      runner,
      tenantId,
      9201,
      'Incident restreint lié à un actif',
      true,
      ownerId,
    );
    await linkAsset(runner, tenantId, restrictedId, assetId);

    assert.equal(
      (await searchIncidentIds(service, runner, tenantId, readerId, 'RESTRICTED-HOST-01')).includes(restrictedId),
      false,
      'a reader without incidents:admin does not see the restricted incident by its linked asset',
    );
    assert.equal(
      (await searchIncidentIds(service, runner, tenantId, adminId, 'RESTRICTED-HOST-01')).includes(restrictedId),
      true,
      'an incidents:admin sees the restricted incident by its linked asset, through the admin right',
    );
    assert.equal(
      (await searchIncidentIds(service, runner, tenantId, ownerId, 'RESTRICTED-HOST-01')).includes(restrictedId),
      true,
      'the incident owner sees the restricted incident by its linked asset',
    );

    // The same asset linked to a public incident stays visible to the reader.
    const publicId = await seedIncident(runner, tenantId, 9202, 'Incident public lié au même actif');
    await linkAsset(runner, tenantId, publicId, assetId);
    assert.equal(
      (await searchIncidentIds(service, runner, tenantId, readerId, 'RESTRICTED-HOST-01')).includes(publicId),
      true,
      'the asset text keeps indexing public incidents for the reader',
    );
  });
}

async function bulkLinkChange() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'inc-linked-assets-bulk');
    const assetId = await seedAsset(runner, tenantId, {
      name: 'Serveur bulk',
      hostname: 'QA-BULK-01',
      fqdn: null,
    });
    const first = await seedIncident(runner, tenantId, 9301, 'Premier incident');
    const second = await seedIncident(runner, tenantId, 9302, 'Deuxième incident');

    await runner.query(
      `INSERT INTO incident_assets (tenant_id, incident_id, asset_id)
       VALUES ($1, $2, $3), ($1, $4, $3)`,
      [tenantId, first, assetId, second],
    );
    for (const incidentId of [first, second]) {
      assert.equal(
        await vectorMatches(runner, tenantId, incidentId, 'QA-BULK-01'),
        true,
        'one statement linking two incidents refreshes both through the batch',
      );
    }

    await runner.query(`DELETE FROM incident_assets WHERE tenant_id = $1 AND asset_id = $2`, [tenantId, assetId]);
    for (const incidentId of [first, second]) {
      assert.equal(
        await vectorMatches(runner, tenantId, incidentId, 'QA-BULK-01'),
        false,
        'one statement unlinking both incidents refreshes both through the batch',
      );
    }
  });
}

async function run() {
  await runSpecs('incident-search-linked-assets', [
    migrationReplay,
    migrationDownThenUp,
    linkedAssetText,
    movedLink,
    restrictedIncidentVisibility,
    bulkLinkChange,
  ]);
}

void run();
