import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../data-source';
import { AiEntityService } from '../ai-entity.service';

/**
 * Integration coverage for the unified search_index path (Phase B of
 * planning/search-revamp.md): trigger sync, reindex freshness backstop,
 * RLS, participation scope, document library ACL, ranking/typo/accent
 * behavior and the AI_SEARCH_INDEX_ENABLED=false legacy fallback.
 * Runs against a real PostgreSQL with migrations applied.
 */

function createEntityService(overrides?: { knowledge?: Record<string, unknown> }) {
  return new AiEntityService(
    {
      search: async () => ({ items: [], total: 0 }),
      searchMentionOptions: async () => ({ items: [], total: 0 }),
      listReadableLibraryIdsForUser: async () => null,
      getKnowledgeContextForEntity: async () => ({ access: 'granted', total: 0, groups: [] }),
      ...(overrides?.knowledge ?? {}),
    } as any,
    {
      listReadableEntityTypes: async (_context: unknown, requested: string[]) => requested,
      canReadKnowledge: async () => true,
      assertEntityTypeReadAccess: async () => undefined,
    } as any,
  );
}

function createContext(runner: any, tenantId: string, userId: string) {
  return {
    tenantId,
    userId,
    isPlatformHost: false,
    surface: 'chat' as const,
    authMethod: 'jwt' as const,
    manager: runner.manager,
  };
}

async function setCurrentTenant(runner: any, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function seedTenant(runner: any, tenantId: string, tag: string) {
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `search-index-${tag}-${tenantId.slice(0, 8)}`, `Search Index ${tag}`],
  );
}

async function seedRole(runner: any, tenantId: string, roleName: string): Promise<string> {
  const roleId = randomUUID();
  await runner.query(
    `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, $2, $3, $3, false, false, now(), now())`,
    [roleId, tenantId, roleName],
  );
  return roleId;
}

async function seedUser(
  runner: any,
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

async function seedTask(
  runner: any,
  tenantId: string,
  itemNumber: number,
  title: string,
  description: string | null,
  assigneeUserId: string | null = null,
  related: { type: string; id: string } | null = null,
): Promise<string> {
  const taskId = randomUUID();
  await runner.query(
    `INSERT INTO tasks (
       id, tenant_id, item_number, title, description, status, assignee_user_id,
       related_object_type, related_object_id, labels, owner_ids, viewer_ids, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, $8, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, now(), now())`,
    [taskId, tenantId, itemNumber, title, description, assigneeUserId, related?.type ?? null, related?.id ?? null],
  );
  return taskId;
}

async function seedIncident(
  runner: any,
  tenantId: string,
  opts: { title: string },
): Promise<string> {
  const incidentId = randomUUID();
  await runner.query(
    `INSERT INTO incidents (
       id, tenant_id, item_number, title, severity, status, created_at, updated_at
     )
     VALUES ($1, $2, 8801, $3, 'minor', 'open', now(), now())`,
    [incidentId, tenantId, opts.title],
  );
  return incidentId;
}

async function seedProject(
  runner: any,
  tenantId: string,
  itemNumber: number,
  name: string,
  overrideJustification: string | null = null,
): Promise<string> {
  const projectId = randomUUID();
  await runner.query(
    `INSERT INTO portfolio_projects (
       id, tenant_id, item_number, name, origin, status, execution_progress, override_justification, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, 'standard', 'planned', 0, $5, now(), now())`,
    [projectId, tenantId, itemNumber, name, overrideJustification],
  );
  return projectId;
}

async function fetchIndexRow(runner: any, tenantId: string, entityType: string, entityId: string) {
  const rows = await runner.query(
    `SELECT * FROM search_index WHERE tenant_id = $1 AND entity_type = $2 AND entity_id = $3`,
    [tenantId, entityType, entityId],
  );
  return rows[0] ?? null;
}

async function testTriggersKeepIndexInSync() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await seedTenant(runner, tenantId, 'sync');
    await setCurrentTenant(runner, tenantId);

    // INSERT → row indexed.
    const taskId = await seedTask(runner, tenantId, 4101, 'Remplacement imprimante', 'Imprimante du 2e étage en panne.');
    let row = await fetchIndexRow(runner, tenantId, 'tasks', taskId);
    assert.ok(row, 'task should be indexed on insert');
    assert.equal(row.label, 'Remplacement imprimante');
    assert.equal(row.ref_prefix, 'T');
    assert.equal(row.ref_number, 4101);
    assert.ok(String(row.search_vector).length > 0);

    // UPDATE → row refreshed.
    await runner.query(`UPDATE tasks SET title = 'Remplacement écran' WHERE id = $1`, [taskId]);
    row = await fetchIndexRow(runner, tenantId, 'tasks', taskId);
    assert.equal(row.label, 'Remplacement écran');

    // DELETE → row removed.
    await runner.query(`DELETE FROM tasks WHERE id = $1`, [taskId]);
    row = await fetchIndexRow(runner, tenantId, 'tasks', taskId);
    assert.equal(row, null);

    // Projects and documents are indexed too.
    const projectId = await seedProject(runner, tenantId, 9301, 'Sauvegarde des serveurs');
    const projectRow = await fetchIndexRow(runner, tenantId, 'projects', projectId);
    assert.ok(projectRow, 'project should be indexed on insert');
    assert.equal(projectRow.ref_prefix, 'PRJ');
    assert.equal(projectRow.ref_number, 9301);

    const libraryId = randomUUID();
    const documentId = randomUUID();
    await runner.query(
      `INSERT INTO document_libraries (id, tenant_id, name, slug, is_system, display_order, created_at, updated_at)
       VALUES ($1, $2, 'Search Index Library', $3, false, 0, now(), now())`,
      [libraryId, tenantId, `search-index-lib-${tenantId.slice(0, 8)}`],
    );
    await runner.query(
      `INSERT INTO documents (
         id, tenant_id, item_number, title, summary, content_markdown, content_plain,
         library_id, document_type_id, status, revision, current_version_number, created_at, updated_at
       )
       VALUES ($1, $2, 77, 'Procédure de restauration', 'Runbook', 'Texte du runbook.', 'Texte du runbook.',
               $3, null, 'published', 1, 0, now(), now())`,
      [documentId, tenantId, libraryId],
    );
    const documentRow = await fetchIndexRow(runner, tenantId, 'documents', documentId);
    assert.ok(documentRow, 'document should be indexed on insert');
    assert.equal(documentRow.ref_prefix, 'DOC');
    assert.equal(documentRow.ref_number, 77);
    // The document vector reuses the bilingual documents.search_vector.
    assert.equal(String(documentRow.search_vector).includes('runbook'), true);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testRelatedRenameGoesStaleUntilReindex() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await seedTenant(runner, tenantId, 'stale');
    await setCurrentTenant(runner, tenantId);

    const baseRoleId = await seedRole(runner, tenantId, 'Member');
    const userId = await seedUser(runner, tenantId, baseRoleId, 'Alice', 'Martin');
    const taskId = await seedTask(runner, tenantId, 4102, 'Configurer le pare-feu', null, userId);

    let row = await fetchIndexRow(runner, tenantId, 'tasks', taskId);
    assert.equal(row.extra_json?.assignee, 'Alice Martin');

    // Renaming the assignee is NOT trigger-cascaded → the task entry is stale.
    await runner.query(`UPDATE users SET first_name = 'Alicia' WHERE id = $1`, [userId]);
    row = await fetchIndexRow(runner, tenantId, 'tasks', taskId);
    assert.equal(row.extra_json?.assignee, 'Alice Martin');

    // The per-type refresh function (used by the daily job and the admin
    // endpoint) restores freshness.
    await runner.query(`SELECT search_index_refresh_tasks($1, NULL)`, [tenantId]);
    row = await fetchIndexRow(runner, tenantId, 'tasks', taskId);
    assert.equal(row.extra_json?.assignee, 'Alicia Martin');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testTaskIndexesRelatedIncidentTitle() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await seedTenant(runner, tenantId, 'inc-ref');
    await setCurrentTenant(runner, tenantId);

    const incidentId = await seedIncident(runner, tenantId, { title: 'ZXQFLUTTER panne cluster' });
    const taskId = await seedTask(
      runner,
      tenantId,
      4103,
      'Diagnostiquer le cluster',
      null,
      null,
      { type: 'incident', id: incidentId },
    );

    let row = await fetchIndexRow(runner, tenantId, 'tasks', taskId);
    assert.ok(row, 'linked task should be indexed on insert');
    assert.equal(
      String(row.search_vector).includes('zxqflutter'),
      true,
      'task vector matches related incident title',
    );

    // Renaming the incident is NOT trigger-cascaded → the task entry is stale.
    await runner.query(`UPDATE incidents SET title = 'ZQYMELON panne cluster' WHERE id = $1`, [incidentId]);
    row = await fetchIndexRow(runner, tenantId, 'tasks', taskId);
    assert.equal(String(row.search_vector).includes('zxqflutter'), true, 'rename is not trigger-cascaded');
    assert.equal(String(row.search_vector).includes('zqymelon'), false, 'stale until reindex');

    await runner.query(`SELECT search_index_refresh_tasks($1, NULL)`, [tenantId]);
    row = await fetchIndexRow(runner, tenantId, 'tasks', taskId);
    assert.equal(String(row.search_vector).includes('zxqflutter'), false);
    assert.equal(String(row.search_vector).includes('zqymelon'), true, 'reindex picks up the new title');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testSearchAllIndexedBehavior() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await seedTenant(runner, tenantId, 'behavior');
    await setCurrentTenant(runner, tenantId);

    const service = createEntityService();
    const context = createContext(runner, tenantId, randomUUID());

    const backupProject = await seedProject(runner, tenantId, 9310, 'Sauvegarde des serveurs');
    const contentOnlyProject = await seedProject(
      runner,
      tenantId,
      9311,
      'Notes diverses',
      'La sauvegarde des serveurs est mentionnée ici.',
    );
    const refTask = await seedTask(runner, tenantId, 9410, 'Audit annuel', 'Vérification des accès.');
    const accentTask = await seedTask(runner, tenantId, 9411, 'Référentiel des imprimantes', null);

    // Exact ref beats everything; bare prefix ordering still works.
    const refSearch = await service.searchAll(context as any, {
      query: 'T-9410',
      entity_types: ['tasks', 'projects'],
      limit: 10,
    });
    assert.equal(refSearch.items[0]?.id, refTask);
    assert.equal(refSearch.items[0]?.ref, 'T-9410');

    // Label match outranks content-only (tsvector) match.
    const labelSearch = await service.searchAll(context as any, {
      query: 'sauvegarde des serveurs',
      entity_types: ['projects'],
      limit: 10,
    });
    const labelIds = labelSearch.items.map((item: any) => item.id);
    assert.deepEqual(labelIds.slice(0, 2), [backupProject, contentOnlyProject]);

    // Trigram typo tolerance on the label.
    const typoSearch = await service.searchAll(context as any, {
      query: 'sauvegrade des serveurs',
      entity_types: ['projects'],
      limit: 10,
    });
    assert.equal(typoSearch.items.some((item: any) => item.id === backupProject), true);

    // Accent folding + French stemming on entity names.
    const accentSearch = await service.searchAll(context as any, {
      query: 'referentiel imprimantes',
      entity_types: ['tasks'],
      limit: 10,
    });
    assert.equal(accentSearch.items.some((item: any) => item.id === accentTask), true);

    // Legacy fallback flag routes to the old per-type path and still works.
    const previousFlag = process.env.AI_SEARCH_INDEX_ENABLED;
    process.env.AI_SEARCH_INDEX_ENABLED = 'false';
    try {
      const legacySearch = await service.searchAll(context as any, {
        query: 'Audit annuel',
        entity_types: ['tasks'],
        limit: 10,
      });
      assert.equal(legacySearch.items.some((item: any) => item.id === refTask), true);
    } finally {
      if (previousFlag === undefined) {
        delete process.env.AI_SEARCH_INDEX_ENABLED;
      } else {
        process.env.AI_SEARCH_INDEX_ENABLED = previousFlag;
      }
    }
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testBudgetLineRefMatchesAndIsReturned() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await seedTenant(runner, tenantId, 'spend');
    await setCurrentTenant(runner, tenantId);

    const spendItemId = randomUUID();
    await runner.query(
      `INSERT INTO spend_items (
         id, tenant_id, product_name, description, currency, effective_start, status, item_number, created_at, updated_at
       )
       VALUES ($1, $2, 'Licence supervision', 'Renouvellement annuel', 'EUR', DATE '2026-01-01', 'enabled', 4205, now(), now())`,
      [spendItemId, tenantId],
    );

    const service = createEntityService();
    const context = createContext(runner, tenantId, randomUUID());

    const search = await service.searchAll(context as any, {
      query: 'OPX-4205',
      entity_types: ['spend_items', 'tasks'],
      limit: 10,
    });
    assert.equal(search.items[0]?.id, spendItemId);
    // The result names the line by its reference, so the model can quote it.
    assert.equal(search.items[0]?.ref, 'OPX-4205');
    assert.equal((search.items[0] as any)?.metadata?.supplier ?? null, null);

    const capexItemId = randomUUID();
    await runner.query(
      `INSERT INTO capex_items (
         id, tenant_id, description, ppe_type, investment_type, priority, currency, effective_start, item_number
       )
       VALUES ($1, $2, 'Storage refresh', 'hardware', 'replacement', 'medium', 'EUR', DATE '2026-01-01', 4206)`,
      [capexItemId, tenantId],
    );
    const capexSearch = await service.searchAll(context as any, {
      query: 'CPX-4206',
      entity_types: ['capex_items', 'spend_items'],
      limit: 10,
    });
    assert.equal(capexSearch.items[0]?.id, capexItemId);
    assert.equal(capexSearch.items[0]?.ref, 'CPX-4206');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testParticipationScopeOnIndexedPath() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await seedTenant(runner, tenantId, 'scope');
    await setCurrentTenant(runner, tenantId);

    const contributorRoleId = await seedRole(runner, tenantId, 'Business Contributor');
    const adminRoleId = await seedRole(runner, tenantId, 'Administrator');
    const scopedUserId = await seedUser(runner, tenantId, contributorRoleId, 'Paul', 'Scoped');
    const adminUserId = await seedUser(runner, tenantId, adminRoleId, 'Ada', 'Admin');

    const teamProject = await seedProject(runner, tenantId, 9501, 'Migration scoped alpha');
    const otherProject = await seedProject(runner, tenantId, 9502, 'Migration scoped beta');
    await runner.query(
      `INSERT INTO portfolio_project_team (id, tenant_id, project_id, user_id, role, created_at)
       VALUES ($1, $2, $3, $4, 'contributor', now())`,
      [randomUUID(), tenantId, teamProject, scopedUserId],
    );

    const scopedTask = await seedTask(runner, tenantId, 9510, 'Tâche migration scoped', null, scopedUserId);
    const otherTask = await seedTask(runner, tenantId, 9511, 'Autre tâche migration scoped', null, adminUserId);

    const service = createEntityService();

    const scopedSearch = await service.searchAll(createContext(runner, tenantId, scopedUserId) as any, {
      query: 'migration scoped',
      entity_types: ['projects', 'tasks'],
      limit: 10,
    });
    const scopedIds = scopedSearch.items.map((item: any) => item.id);
    assert.equal(scopedIds.includes(teamProject), true, 'scoped user sees own team project');
    assert.equal(scopedIds.includes(scopedTask), true, 'scoped user sees assigned task');
    assert.equal(scopedIds.includes(otherProject), false, 'scoped user must NOT see non-team project');
    assert.equal(scopedIds.includes(otherTask), false, 'scoped user must NOT see unrelated task');

    const adminSearch = await service.searchAll(createContext(runner, tenantId, adminUserId) as any, {
      query: 'migration scoped',
      entity_types: ['projects', 'tasks'],
      limit: 10,
    });
    const adminIds = adminSearch.items.map((item: any) => item.id);
    for (const id of [teamProject, otherProject, scopedTask, otherTask]) {
      assert.equal(adminIds.includes(id), true, 'admin sees everything');
    }
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testDocumentLibraryAclOnIndexedPath() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await seedTenant(runner, tenantId, 'acl');
    await setCurrentTenant(runner, tenantId);

    const allowedLibrary = randomUUID();
    const restrictedLibrary = randomUUID();
    for (const [libraryId, name] of [[allowedLibrary, 'Allowed'], [restrictedLibrary, 'Restricted']] as const) {
      await runner.query(
        `INSERT INTO document_libraries (id, tenant_id, name, slug, is_system, display_order, created_at, updated_at)
         VALUES ($1, $2, $3, $4, false, 0, now(), now())`,
        [libraryId, tenantId, name, `${name.toLowerCase()}-${libraryId.slice(0, 8)}`],
      );
    }
    const allowedDoc = randomUUID();
    const restrictedDoc = randomUUID();
    for (const [documentId, libraryId, itemNumber] of [
      [allowedDoc, allowedLibrary, 601],
      [restrictedDoc, restrictedLibrary, 602],
    ] as const) {
      await runner.query(
        `INSERT INTO documents (
           id, tenant_id, item_number, title, summary, content_markdown, content_plain,
           library_id, document_type_id, status, revision, current_version_number, created_at, updated_at
         )
         VALUES ($1, $2, $3, 'Guide indexation recherche', '', '', '',
                 $4, null, 'published', 1, 0, now(), now())`,
        [documentId, tenantId, itemNumber, libraryId],
      );
    }

    const service = createEntityService({
      knowledge: {
        listReadableLibraryIdsForUser: async () => [allowedLibrary],
      },
    });
    const search = await service.searchAll(createContext(runner, tenantId, randomUUID()) as any, {
      query: 'Guide indexation recherche',
      entity_types: ['documents'],
      limit: 10,
    });
    const ids = search.items.map((item: any) => item.id);
    assert.equal(ids.includes(allowedDoc), true);
    assert.equal(ids.includes(restrictedDoc), false, 'restricted library document must not leak');

    const unrestricted = createEntityService();
    const fullSearch = await unrestricted.searchAll(createContext(runner, tenantId, randomUUID()) as any, {
      query: 'Guide indexation recherche',
      entity_types: ['documents'],
      limit: 10,
    });
    assert.equal(fullSearch.items.length, 2);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testRlsIsolatesSearchIndex() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    // Structural: policy present, RLS enabled AND forced.
    const policyRows = await runner.query(
      `SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'search_index'`,
    );
    assert.equal(
      policyRows.some((row: any) => row.policyname === 'search_index_tenant_isolation'),
      true,
    );
    const rlsRows = await runner.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'search_index'`,
    );
    assert.equal(rlsRows[0].relrowsecurity, true);
    assert.equal(rlsRows[0].relforcerowsecurity, true);

    // Functional cross-tenant check — meaningful only when the connected role
    // cannot bypass RLS (CI runs as NOSUPERUSER; local dev may be superuser).
    const roleRows = await runner.query(
      `SELECT rolsuper OR rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`,
    );
    const tenantOne = randomUUID();
    const tenantTwo = randomUUID();
    await seedTenant(runner, tenantOne, 'rls-one');
    await seedTenant(runner, tenantTwo, 'rls-two');

    await setCurrentTenant(runner, tenantOne);
    const taskId = await seedTask(runner, tenantOne, 9601, 'Tâche isolée RLS', null);
    assert.ok(await fetchIndexRow(runner, tenantOne, 'tasks', taskId));

    if (!roleRows[0]?.bypass) {
      await setCurrentTenant(runner, tenantTwo);
      const crossTenantRows = await runner.query(
        `SELECT entity_id FROM search_index WHERE entity_id = $1`,
        [taskId],
      );
      assert.equal(crossTenantRows.length, 0, 'cross-tenant read must return nothing');
      await setCurrentTenant(runner, tenantOne);
    }
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testConfidentialIncidentReaderVsAdmin() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await seedTenant(runner, tenantId, 'inc-acl');
    await setCurrentTenant(runner, tenantId);

    const adminRoleId = await seedRole(runner, tenantId, 'Administrator');
    const memberRoleId = await seedRole(runner, tenantId, 'Member');
    const adminId = await seedUser(runner, tenantId, adminRoleId, 'Admin', 'Viewer');
    const readerId = await seedUser(runner, tenantId, memberRoleId, 'Reader', 'Viewer');

    const secretTitle = 'ZXQCONFIDENTIAL mail outage';
    const incidentId = await seedIncident(runner, tenantId, { title: secretTitle });
    const taskId = await seedTask(
      runner,
      tenantId,
      4104,
      'Diagnose mail',
      null,
      null,
      { type: 'incident', id: incidentId },
    );

    let taskRow = await fetchIndexRow(runner, tenantId, 'tasks', taskId);
    assert.equal(
      String(taskRow.search_vector).includes('zxqconfidential'),
      true,
      'public related title is indexed on the task',
    );

    await runner.query(
      `UPDATE incidents SET confidential = true, reporter_user_id = $2, owner_user_id = $2 WHERE id = $1 AND tenant_id = $3`,
      [incidentId, adminId, tenantId],
    );

    taskRow = await fetchIndexRow(runner, tenantId, 'tasks', taskId);
    assert.equal(
      String(taskRow.search_vector).includes('zxqconfidential'),
      true,
      'flipping confidential does not refresh the task index by itself',
    );

    await runner.query(
      `SELECT search_index_refresh_tasks(
         $1,
         ARRAY(SELECT id FROM tasks WHERE tenant_id = $1 AND related_object_type = 'incident' AND related_object_id = $2)
       )`,
      [tenantId, incidentId],
    );
    taskRow = await fetchIndexRow(runner, tenantId, 'tasks', taskId);
    assert.equal(
      String(taskRow.search_vector).includes('zxqconfidential'),
      false,
      'refresh after the flag drop must omit the confidential title',
    );

    const service = createEntityService();
    const readerSearch = await service.searchAll(createContext(runner, tenantId, readerId) as any, {
      query: 'ZXQCONFIDENTIAL',
      entity_types: ['incidents'],
      limit: 10,
    });
    assert.equal(
      readerSearch.items.some((item: any) => item.id === incidentId),
      false,
      'a reader must not see a confidential incident',
    );

    const adminSearch = await service.searchAll(createContext(runner, tenantId, adminId) as any, {
      query: 'ZXQCONFIDENTIAL',
      entity_types: ['incidents'],
      limit: 10,
    });
    assert.equal(
      adminSearch.items.some((item: any) => item.id === incidentId),
      true,
      'an administrator still sees the confidential incident',
    );
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function run() {
  await dataSource.initialize();
  try {
    await testTriggersKeepIndexInSync();
    await testRelatedRenameGoesStaleUntilReindex();
    await testTaskIndexesRelatedIncidentTitle();
    await testSearchAllIndexedBehavior();
    await testBudgetLineRefMatchesAndIsReturned();
    await testParticipationScopeOnIndexedPath();
    await testDocumentLibraryAclOnIndexedPath();
    await testRlsIsolatesSearchIndex();
    await testConfidentialIncidentReaderVsAdmin();
  } finally {
    await dataSource.destroy();
  }
}

void run();
