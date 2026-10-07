import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import dataSource from '../../../data-source';
import { AuditLog } from '../../../audit/audit.entity';
import { AuditService } from '../../../audit/audit.service';
import { TENANT_SCOPED_TABLES } from '../../../common/tenant-isolation.inventory';
import { Features } from '../../../config/features';
import { catalogToMetadata, DEFAULT_CLASSIFICATION_CATALOG } from '../../../it-ops-settings/classification-catalog';
import { TENANT_RESET_AUDIT_SOURCE_REF, TENANT_RESET_RUNNING_CODE } from '../tenant-reset.service';
import {
  ActivatedTenant,
  addAiSettings,
  addRealUser,
  baselineSnapshot,
  buildServices,
  cleanupTenants,
  countDifferences,
  countTenantRows,
  createActivatedTenant,
  inTenant,
  loadDemoSet,
  RecordingStorage,
  refusal,
  runSpecs,
  Services,
  setCurrentTenant,
} from './tenant-reset-test-helpers';

// The reset to the post-activation state (TenantResetService) against a real database, on the
// non-superuser role: equivalence with a freshly activated tenant, round trip of the sample data,
// isolation, concurrency, rollback, refusals, and the full tenant purge (deleteTenant) that shares
// its purge loop. Tenants are committed (the services open their own connections) and removed
// at the end of each spec.

const DEFAULT_METADATA = { it_ops: catalogToMetadata(DEFAULT_CLASSIFICATION_CATALOG) };

async function tenantRow(tenantId: string) {
  const [row] = await dataSource.query(
    `SELECT name, slug, status, metadata, branding, sso_provider, sso_enabled, entra_tenant_id, entra_metadata,
            billing_email, is_system_tenant
       FROM tenants WHERE id = $1`,
    [tenantId],
  );
  return row;
}

async function auditRows(tenantId: string): Promise<Array<{ id: string; table_name: string; action: string; source_ref: string | null; user_id: string | null; record_id: string | null; after_json: any }>> {
  return inTenant(tenantId, (manager) => manager.query(
    `SELECT id, table_name, action, source_ref, user_id, record_id, after_json FROM audit_log WHERE tenant_id = $1`,
    [tenantId],
  ));
}

function auditSignature(rows: Array<{ table_name: string; action: string; source_ref: string | null }>): string[] {
  return rows.map((row) => `${row.table_name}/${row.action}/${row.source_ref ?? ''}`).sort();
}

async function rowsOf(tenantId: string, sql: string, params: unknown[] = []) {
  return inTenant(tenantId, (manager) => manager.query(sql, [tenantId, ...params]));
}

async function exampleUsers(tenantId: string): Promise<string[]> {
  const rows = await rowsOf(tenantId, `SELECT email FROM users WHERE tenant_id = $1 AND lower(email) LIKE '%.example' ORDER BY email`);
  return rows.map((row: { email: string }) => row.email);
}

/** An activated tenant with a second real user and AI settings (the "real" content a reset keeps). */
async function activatedWithRealContent(svc: Services, tag: string, opts: { orgName: string; countryIso?: string; signup?: boolean }) {
  const tenant = await createActivatedTenant(svc, { tag, ...opts });
  const realUserId = await addRealUser(svc, tenant.tenantId);
  await addAiSettings(tenant.tenantId, realUserId);
  return { ...tenant, realUserId };
}

// Spec 2: a tenant loaded with sample data then reset equals a tenant just activated.
async function testResetMatchesActivatedTenant() {
  const svc = buildServices();
  const storage = svc.storage as RecordingStorage;
  let a: ActivatedTenant | undefined;
  let b: (ActivatedTenant & { realUserId: string }) | undefined;
  try {
    a = await activatedWithRealContent(svc, 'eq-a', { orgName: 'Fromage Reset Org', countryIso: 'DE' });
    b = await activatedWithRealContent(svc, 'eq-b', { orgName: 'Fromage Reset Org', countryIso: 'DE', signup: true });
    const demo = await loadDemoSet(b.tenantId, { realUserId: b.realUserId });

    // Tenant settings the reset must leave alone, a renamed tenant (the starting company comes
    // from the trial sign-up, as at activation), and metadata with a sample data status.
    const logoPath = `reset-spec/${b.tenantId}/logo/logo.png`;
    await dataSource.query(
      `UPDATE tenants
          SET name = 'Renamed workspace',
              branding = jsonb_build_object('logo_storage_path', $2::text, 'logo_version', 3, 'use_logo_in_dark', false, 'primary_color_light', '#123456'),
              sso_provider = 'entra', sso_enabled = true, entra_tenant_id = 'entra-spec-tenant',
              entra_metadata = '{"last_sync":"2026-10-01"}'::jsonb,
              billing_email = 'billing@reset-spec.test',
              metadata = metadata || '{"demo":{"status":"loaded","loaded_at":"2026-10-07"},"onboarding":{"done":true}}'::jsonb
        WHERE id = $1`,
      [b.tenantId, logoPath],
    );
    const tenantBefore = await tenantRow(b.tenantId);
    const auditBefore = await auditRows(b.tenantId);
    const aiRowsBefore = {
      settings: await rowsOf(b.tenantId, `SELECT * FROM ai_settings WHERE tenant_id = $1 ORDER BY id`),
      keys: await rowsOf(b.tenantId, `SELECT * FROM ai_api_keys WHERE tenant_id = $1 AND user_id = $2 ORDER BY id`, [b.realUserId]),
      models: await rowsOf(b.tenantId, `SELECT * FROM ai_model_configs WHERE tenant_id = $1 ORDER BY id`),
    };
    const realUserBefore = (await rowsOf(b.tenantId, `SELECT * FROM users WHERE tenant_id = $1 AND id = $2`, [b.realUserId]))[0];
    const realUserSettingsBefore = await rowsOf(b.tenantId,
      `SELECT 'prefs' AS kind, to_jsonb(p) AS row FROM user_notification_preferences p WHERE tenant_id = $1 AND user_id = $2
       UNION ALL SELECT 'dashboard', to_jsonb(d) FROM user_dashboard_config d WHERE tenant_id = $1 AND user_id = $2
       UNION ALL SELECT 'session', to_jsonb(r) FROM refresh_tokens r WHERE tenant_id = $1 AND user_id = $2
       UNION ALL SELECT 'role', to_jsonb(ur) FROM user_roles ur WHERE tenant_id = $1 AND user_id = $2
       ORDER BY 1`,
      [b.realUserId]);
    assert.ok(realUserBefore.company_id && realUserBefore.department_id, 'the real user belongs to a sample company and department');
    assert.equal((await exampleUsers(b.tenantId)).length, 3);

    const result = await svc.reset.reset(b.tenantId, b.ownerId);

    // Every tenant table holds as many rows as in the activated tenant; the history is kept.
    const countsA = await countTenantRows(a.tenantId);
    const countsB = await countTenantRows(b.tenantId);
    assert.deepEqual(countDifferences(countsA, countsB, ['audit_log']), [], 'row counts per table, A vs reset B');
    assert.equal(Object.keys(countsB).length, TENANT_SCOPED_TABLES.length);

    // The history: every entry from before the reset, plus the reset's own entry and the entries
    // of the starting state it created again (chart of accounts, accounts, company, calendar:
    // the same ones activation writes, apart from the users it creates).
    const auditAfter = await auditRows(b.tenantId);
    const afterIds = new Set(auditAfter.map((row) => row.id));
    assert.deepEqual(auditBefore.filter((row) => !afterIds.has(row.id)), [], 'no history entry is removed');
    const beforeIds = new Set(auditBefore.map((row) => row.id));
    const added = auditAfter.filter((row) => !beforeIds.has(row.id));
    const expectedAdded = [
      ...auditSignature((await auditRows(a.tenantId)).filter((row) => row.table_name !== 'users')),
      `tenants_admin/update/${TENANT_RESET_AUDIT_SOURCE_REF}`,
    ].sort();
    assert.deepEqual(auditSignature(added), expectedAdded, 'entries added by the reset');
    const resetEntries = added.filter((row) => row.source_ref === TENANT_RESET_AUDIT_SOURCE_REF);
    assert.equal(resetEntries.length, 1);
    assert.equal(resetEntries[0].user_id, b.ownerId);
    assert.equal(resetEntries[0].record_id, b.tenantId);
    assert.equal(resetEntries[0].after_json.demo_users_removed, 3);
    assert.equal(resetEntries[0].after_json.storage_objects, 3);
    assert.equal(resetEntries[0].after_json.chart_of_accounts, 'provisioned');
    assert.equal(result.chartOfAccounts, 'provisioned');

    // The starting state, without ids or timestamps.
    assert.deepEqual(await baselineSnapshot(b.tenantId), await baselineSnapshot(a.tenantId));
    const [company] = await rowsOf(b.tenantId, `SELECT name, country_iso FROM companies WHERE tenant_id = $1`);
    assert.deepEqual({ ...company }, { name: 'Fromage Reset Org', country_iso: 'DE' });

    // Kept: AI settings, the real user (detached from the sample company), its settings.
    assert.deepEqual({
      settings: await rowsOf(b.tenantId, `SELECT * FROM ai_settings WHERE tenant_id = $1 ORDER BY id`),
      keys: await rowsOf(b.tenantId, `SELECT * FROM ai_api_keys WHERE tenant_id = $1 AND user_id = $2 ORDER BY id`, [b.realUserId]),
      models: await rowsOf(b.tenantId, `SELECT * FROM ai_model_configs WHERE tenant_id = $1 ORDER BY id`),
    }, aiRowsBefore);
    const realUserAfter = (await rowsOf(b.tenantId, `SELECT * FROM users WHERE tenant_id = $1 AND id = $2`, [b.realUserId]))[0];
    assert.equal(realUserAfter.company_id, null);
    assert.equal(realUserAfter.department_id, null);
    const strip = ({ company_id, department_id, updated_at, ...rest }: any) => rest;
    assert.deepEqual(strip(realUserAfter), strip(realUserBefore));
    assert.deepEqual(await rowsOf(b.tenantId,
      `SELECT 'prefs' AS kind, to_jsonb(p) AS row FROM user_notification_preferences p WHERE tenant_id = $1 AND user_id = $2
       UNION ALL SELECT 'dashboard', to_jsonb(d) FROM user_dashboard_config d WHERE tenant_id = $1 AND user_id = $2
       UNION ALL SELECT 'session', to_jsonb(r) FROM refresh_tokens r WHERE tenant_id = $1 AND user_id = $2
       UNION ALL SELECT 'role', to_jsonb(ur) FROM user_roles ur WHERE tenant_id = $1 AND user_id = $2
       ORDER BY 1`,
      [b.realUserId]), realUserSettingsBefore);
    assert.deepEqual(await exampleUsers(b.tenantId), []);
    assert.equal(result.demoUsersRemoved, 3);

    // The tenant row: metadata back to its defaults with the sample data status kept, the rest unchanged.
    const tenantAfter = await tenantRow(b.tenantId);
    assert.deepEqual((await tenantRow(a.tenantId)).metadata, DEFAULT_METADATA);
    assert.deepEqual(tenantAfter.metadata, { ...DEFAULT_METADATA, demo: { status: 'loaded', loaded_at: '2026-10-07' } });
    const { metadata: _before, ...restBefore } = tenantBefore;
    const { metadata: _after, ...restAfter } = tenantAfter;
    assert.deepEqual(restAfter, restBefore);

    // Storage: the sample attachments' objects only, deleted after the commit; the logo stays.
    assert.deepEqual([...storage.deleted].sort(), [...demo.storagePaths].sort());
    assert.deepEqual(storage.deletedBeforeCommit, [], 'no object deleted before the commit');
    assert.equal(result.storageObjectsDeleted, 3);
    assert.equal(result.storageObjectsFailed, 0);
    assert.ok(result.purged.some((entry) => entry.table === 'tasks' && entry.deleted === 2));
    assert.ok(!result.purged.some((entry) => entry.table === 'audit_log' || entry.table === 'users'));
  } finally {
    await cleanupTenants([a?.tenantId, b?.tenantId]);
  }
}

// Spec 3: sample data, reset, the same sample data, reset: same references both times, and the
// end state is the starting state.
async function testRoundTrip() {
  const svc = buildServices();
  let b: ActivatedTenant | undefined;
  try {
    // No trial sign-up row: the starting company falls back to the tenant name, in France.
    b = await createActivatedTenant(svc, { tag: 'rt', orgName: 'Round Trip Org' });
    const initialCounts = await countTenantRows(b.tenantId);
    const initialSnapshot = await baselineSnapshot(b.tenantId);

    const first = await loadDemoSet(b.tenantId);
    await svc.reset.reset(b.tenantId, b.ownerId);
    const second = await loadDemoSet(b.tenantId);
    await svc.reset.reset(b.tenantId, b.ownerId);

    assert.deepEqual(second.refs, first.refs, 'the second load gets the same references');
    for (const ref of ['T-1', 'T-2', 'PRJ-1', 'APP-1', 'INT-1', 'CONN-1', 'OPEX-1']) {
      assert.ok(first.refs.includes(ref), `${ref} is allocated from 1`);
    }
    assert.ok(first.refs.some((ref) => /^DOC-\d+$/.test(ref)));

    assert.deepEqual(countDifferences(initialCounts, await countTenantRows(b.tenantId), ['audit_log']), []);
    assert.deepEqual(await baselineSnapshot(b.tenantId), initialSnapshot);
    const [company] = await rowsOf(b.tenantId, `SELECT name, country_iso FROM companies WHERE tenant_id = $1`);
    assert.deepEqual({ ...company }, { name: 'Round Trip Org', country_iso: 'FR' });
  } finally {
    await cleanupTenants([b?.tenantId]);
  }
}

// Security note: the user who runs the reset is never removed, even with a sample data e-mail.
async function testActingSampleUserIsKept() {
  const svc = buildServices();
  let b: ActivatedTenant | undefined;
  try {
    b = await createActivatedTenant(svc, { tag: 'actor', orgName: 'Actor Org' });
    const demo = await loadDemoSet(b.tenantId);
    const [actorId] = demo.demoUserIds;
    const result = await svc.reset.reset(b.tenantId, actorId);
    assert.equal(result.demoUsersRemoved, 2);
    assert.deepEqual(await exampleUsers(b.tenantId), ['claire.dupont@fromage-co.example']);
    const [roles] = await rowsOf(b.tenantId, `SELECT count(*)::int AS n FROM user_roles WHERE tenant_id = $1 AND user_id = $2`, [actorId]);
    assert.equal(roles.n, 2, 'the acting user keeps its roles');
  } finally {
    await cleanupTenants([b?.tenantId]);
  }
}

// Spec 4: the reset of B leaves a neighbour tenant exactly as it was.
async function testNeighbourTenantUntouched() {
  const svc = buildServices();
  const storage = svc.storage as RecordingStorage;
  let b: ActivatedTenant | undefined;
  let c: ActivatedTenant | undefined;
  try {
    b = await createActivatedTenant(svc, { tag: 'iso-b', orgName: 'Isolation B' });
    c = await createActivatedTenant(svc, { tag: 'iso-c', orgName: 'Isolation C' });
    const realUserC = await addRealUser(svc, c.tenantId);
    await addAiSettings(c.tenantId, realUserC);
    const demoB = await loadDemoSet(b.tenantId);
    const demoC = await loadDemoSet(c.tenantId, { realUserId: realUserC });
    // Metadata of its own, which a reset of another tenant must not touch (tenants has no RLS).
    await dataSource.query(
      `UPDATE tenants SET metadata = metadata || '{"demo":{"status":"loaded"},"onboarding":{"done":true}}'::jsonb WHERE id = $1`,
      [c.tenantId],
    );
    const countsC = await countTenantRows(c.tenantId);
    const snapshotC = await baselineSnapshot(c.tenantId);
    const tenantC = await tenantRow(c.tenantId);

    await svc.reset.reset(b.tenantId, b.ownerId);

    assert.deepEqual(countDifferences(countsC, await countTenantRows(c.tenantId)), [], 'tenant C row counts');
    assert.deepEqual(await baselineSnapshot(c.tenantId), snapshotC);
    assert.deepEqual(await tenantRow(c.tenantId), tenantC);
    assert.equal((await exampleUsers(c.tenantId)).length, 3);
    assert.deepEqual([...storage.deleted].sort(), [...demoB.storagePaths].sort());
    assert.ok(demoC.storagePaths.every((path) => !storage.deleted.includes(path)));
  } finally {
    await cleanupTenants([b?.tenantId, c?.tenantId]);
  }
}

// Spec 5: two resets of the same tenant at once: one runs, the other gets a 409 at once.
async function testConcurrentResetIsRefused() {
  const svc = buildServices();
  let b: ActivatedTenant | undefined;
  const runner = dataSource.createQueryRunner();
  try {
    b = await createActivatedTenant(svc, { tag: 'lock', orgName: 'Lock Org' });
    await loadDemoSet(b.tenantId);

    await runner.connect();
    await runner.startTransaction();
    await setCurrentTenant(runner.manager, b.tenantId);
    await svc.reset.resetWithManager(runner.manager, b.tenantId, b.ownerId);

    // The first reset holds its transaction open: the second one must be refused without waiting.
    let timer: NodeJS.Timeout | undefined;
    const second = svc.reset.reset(b.tenantId, b.ownerId).then(
      () => 'completed',
      (error) => error,
    );
    const outcome = await Promise.race([
      second,
      new Promise((resolve) => { timer = setTimeout(() => resolve('still waiting'), 5000); }),
    ]);
    clearTimeout(timer);
    await runner.commitTransaction();
    const settled = await second;
    assert.ok(outcome instanceof ConflictException, `the second reset is refused at once (got ${String(outcome)})`);
    assert.equal(settled, outcome);
    assert.equal((outcome.getResponse() as any).code, TENANT_RESET_RUNNING_CODE);

    const resets = (await auditRows(b.tenantId)).filter((row) => row.source_ref === TENANT_RESET_AUDIT_SOURCE_REF);
    assert.equal(resets.length, 1, 'one reset ran');
    assert.deepEqual(await exampleUsers(b.tenantId), []);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
    await runner.release().catch(() => undefined);
    await cleanupTenants([b?.tenantId]);
  }
}

// Spec 6: a failure after the purge rolls the whole reset back, and no storage object is deleted.
async function testFailureRollsEverythingBack() {
  class FailingResetAudit extends AuditService {
    async log(params: Parameters<AuditService['log']>[0], opts?: Parameters<AuditService['log']>[1]) {
      if (params.sourceRef === TENANT_RESET_AUDIT_SOURCE_REF) throw new Error('injected audit failure');
      return super.log(params, opts);
    }
  }
  const storage = new RecordingStorage();
  const svc = buildServices({ storage, resetAudit: new FailingResetAudit(dataSource.getRepository(AuditLog)) });
  let b: ActivatedTenant | undefined;
  try {
    b = await createActivatedTenant(svc, { tag: 'fail', orgName: 'Failure Org' });
    const realUserId = await addRealUser(svc, b.tenantId);
    await loadDemoSet(b.tenantId, { realUserId });
    await dataSource.query(`UPDATE tenants SET metadata = metadata || '{"onboarding":{"done":true}}'::jsonb WHERE id = $1`, [b.tenantId]);
    const counts = await countTenantRows(b.tenantId);
    const snapshot = await baselineSnapshot(b.tenantId);
    const tenant = await tenantRow(b.tenantId);

    const error = await refusal(() => svc.reset.reset(b!.tenantId, b!.ownerId));
    assert.match(String(error?.message), /injected audit failure/);

    assert.deepEqual(countDifferences(counts, await countTenantRows(b.tenantId)), [], 'every table as before');
    assert.deepEqual(await baselineSnapshot(b.tenantId), snapshot);
    assert.deepEqual(await tenantRow(b.tenantId), tenant);
    assert.equal((await exampleUsers(b.tenantId)).length, 3);
    const [realUser] = await rowsOf(b.tenantId, `SELECT company_id FROM users WHERE tenant_id = $1 AND id = $2`, [realUserId]);
    assert.ok(realUser.company_id, 'the real user keeps its company');
    assert.deepEqual(storage.deleted, [], 'no storage object deleted');
  } finally {
    await cleanupTenants([b?.tenantId]);
  }
}

// Spec 7: the system tenant, a deleted or deleting tenant and a single-tenant installation are
// refused, nothing written.
async function testRefusals() {
  const svc = buildServices();
  const storage = svc.storage as RecordingStorage;
  let system: ActivatedTenant | undefined;
  let b: ActivatedTenant | undefined;
  let gone: ActivatedTenant | undefined;
  try {
    system = await createActivatedTenant(svc, { tag: 'sys', orgName: 'System Org' });
    await loadDemoSet(system.tenantId);
    await dataSource.query(`UPDATE tenants SET is_system_tenant = true WHERE id = $1`, [system.tenantId]);
    const systemCounts = await countTenantRows(system.tenantId);
    const systemError = await refusal(() => svc.reset.reset(system!.tenantId, system!.ownerId));
    assert.ok(systemError instanceof BadRequestException, String(systemError));
    assert.match(systemError.message, /System tenants cannot be modified/);
    assert.deepEqual(countDifferences(systemCounts, await countTenantRows(system.tenantId)), []);

    gone = await createActivatedTenant(svc, { tag: 'gone', orgName: 'Gone Org' });
    await loadDemoSet(gone.tenantId);
    const goneCounts = await countTenantRows(gone.tenantId);
    for (const status of ['deleting', 'deleted']) {
      await dataSource.query(`UPDATE tenants SET status = $2 WHERE id = $1`, [gone.tenantId, status]);
      const goneError = await refusal(() => svc.reset.reset(gone!.tenantId, gone!.ownerId));
      assert.ok(goneError instanceof BadRequestException, `${status}: ${String(goneError)}`);
      assert.match(goneError.message, /Tenant already deleted/);
      assert.deepEqual(countDifferences(goneCounts, await countTenantRows(gone.tenantId)), [], `${status}: nothing written`);
    }

    b = await createActivatedTenant(svc, { tag: 'mode', orgName: 'Mode Org' });
    await loadDemoSet(b.tenantId);
    const counts = await countTenantRows(b.tenantId);
    const saved = Features.SINGLE_TENANT;
    (Features as any).SINGLE_TENANT = true;
    let modeError: any;
    try {
      modeError = await refusal(() => svc.reset.reset(b!.tenantId, b!.ownerId));
    } finally {
      (Features as any).SINGLE_TENANT = saved;
    }
    assert.ok(modeError instanceof NotFoundException, String(modeError));
    assert.deepEqual(countDifferences(counts, await countTenantRows(b.tenantId)), []);
    assert.deepEqual(storage.deleted, []);
  } finally {
    await cleanupTenants([system?.tenantId, b?.tenantId, gone?.tenantId]);
  }
}

// Spec 8: deleteTenant on a populated tenant leaves no row in any tenant table (but the entry
// that records the deletion), deletes the storage objects after the commit, and leaves the
// neighbour tenant intact. The first spec of TENANT_PURGE_TABLES's order on a real database.
async function testDeleteTenantPurgesEveryTable() {
  const svc = buildServices();
  const storage = svc.storage as RecordingStorage;
  let d: (ActivatedTenant & { realUserId: string }) | undefined;
  let c: ActivatedTenant | undefined;
  try {
    d = await activatedWithRealContent(svc, 'del-d', { orgName: 'Deleted Org', signup: true });
    c = await createActivatedTenant(svc, { tag: 'del-c', orgName: 'Neighbour Org' });
    const demoD = await loadDemoSet(d.tenantId, { realUserId: d.realUserId });
    await loadDemoSet(c.tenantId);
    const logoPath = `reset-spec/${d.tenantId}/logo/logo.png`;
    await dataSource.query(
      `UPDATE tenants SET branding = branding || jsonb_build_object('logo_storage_path', $2::text) WHERE id = $1`,
      [d.tenantId, logoPath],
    );
    const countsD = await countTenantRows(d.tenantId);
    assert.ok(Object.values(countsD).filter((n) => n > 0).length > 40, 'the tenant is populated');
    const countsC = await countTenantRows(c.tenantId);

    const { purgeReport } = await svc.admin.deleteTenant(d.tenantId, null, { confirmSlug: d.slug, reason: 'spec' } as any);

    const after = await countTenantRows(d.tenantId);
    const left = Object.entries(after).filter(([table, n]) => n > 0 && table !== 'audit_log');
    assert.deepEqual(left, [], 'no row left in any tenant table');
    const audit = await auditRows(d.tenantId);
    assert.equal(audit.length, 1, 'only the entry recording the deletion');
    assert.equal(audit[0].after_json.status, 'deleted');
    assert.deepEqual(purgeReport[0], { table: 'tenant_branding_logo', deleted: 1 });

    assert.deepEqual(countDifferences(countsC, await countTenantRows(c.tenantId)), [], 'neighbour row counts');
    assert.deepEqual([...storage.deleted].sort(), [...demoD.storagePaths, logoPath].sort());
    assert.deepEqual(storage.deletedBeforeCommit, [], 'no object deleted before the commit');
  } finally {
    await cleanupTenants([d?.tenantId, c?.tenantId]);
  }
}

runSpecs('tenant-reset.integration.spec', [
  testResetMatchesActivatedTenant,
  testRoundTrip,
  testActingSampleUserIsKept,
  testNeighbourTenantUntouched,
  testConcurrentResetIsRefused,
  testFailureRollsEverythingBack,
  testRefusals,
  testDeleteTenantPurgesEveryTable,
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
