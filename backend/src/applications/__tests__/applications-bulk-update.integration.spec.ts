import 'dotenv/config';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { BULK_MAX_ROWS } from '../../common/bulk-edit/bulk-edit';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { Location } from '../../locations/location.entity';
import { Tenant } from '../../tenants/tenant.entity';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { Application } from '../application.entity';
import { bulkUpdateApplications } from '../application-bulk-edit';
import { ApplicationsCrudService } from '../services/applications-crud.service';
import { ApplicationsListService } from '../services/applications-list.service';
import { ApplicationsOwnersService } from '../services/applications-owners.service';
import { ApplicationsService } from '../services/applications.service';

/**
 * POST /applications/bulk-update (lot F2 of 26.11.8): one change applied to many applications, each
 * through the update of one application, in the request's transaction. The dry run counts the
 * applications that would change and the refused ones per code; the write changes the others. Every
 * case runs in a rolled-back transaction, in a tenant of its own.
 */

type Ctx = {
  runner: QueryRunner;
  tenantId: string;
  svc: ApplicationsService;
  list: ApplicationsListService;
  crud: ApplicationsCrudService;
  people: Record<'ana' | 'ben' | 'cleo', string>;
  apps: string[];
};

async function inTenant(fn: (ctx: Ctx) => Promise<void>, count = 5) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'apps-bulk');
    const manager = runner.manager;
    const audit = new AuditService(manager.getRepository(AuditLog));
    const settings = new ItOpsSettingsService(manager.getRepository(Tenant), manager.getRepository(Location), audit);
    const repo = manager.getRepository(Application);
    const list = new ApplicationsListService(repo);
    const crud = new ApplicationsCrudService(repo, audit, null as any, settings, null as any);
    const owners = new ApplicationsOwnersService(repo, audit);
    const svc = new ApplicationsService(list, crud, owners, null as any, null as any, null as any, null as any);
    const roleId = randomUUID();
    await runner.query(
      `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
       VALUES ($1, $2, 'F2', 'F2', false, false, now(), now())`,
      [roleId, tenantId],
    );
    const people = {} as Ctx['people'];
    for (const name of ['ana', 'ben', 'cleo'] as const) {
      const id = randomUUID();
      await runner.query(
        `INSERT INTO users (id, tenant_id, first_name, last_name, email, password_hash, role_id, mfa_enabled, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Zqowner', $4, null, $5, false, 'enabled', now(), now())`,
        [id, tenantId, name, `${name}-${tenantId.slice(0, 8)}@example.com`, roleId],
      );
      people[name] = id;
    }
    const apps: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const app = await crud.create({ name: `Bulk app ${String(i).padStart(4, '0')}`, lifecycle: 'active' } as any, null, { manager });
      apps.push(app.id);
    }
    // Ana owns the first application (business), Ben runs it (IT); Ben owns the second.
    await owners.bulkReplaceOwners(apps[0], [{ user_id: people.ana, owner_type: 'business' }, { user_id: people.ben, owner_type: 'it' }], null, { manager });
    if (count > 1) await owners.bulkReplaceOwners(apps[1], [{ user_id: people.ben, owner_type: 'business' }], null, { manager });
    await runner.query(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);
    await fn({ runner, tenantId, svc, list, crud, people, apps });
  });
}

const opts = (ctx: Ctx, accessScope?: { userId: string }) => ({ manager: ctx.runner.manager, tenantId: ctx.tenantId, accessScope });

async function column(ctx: Ctx, id: string, name: 'lifecycle' | 'criticality' | 'classification_revision'): Promise<string | null> {
  const [row] = await ctx.runner.query(`SELECT ${name}::text AS value FROM applications WHERE id = $1`, [id]);
  return row?.value ?? null;
}

async function ownersOf(ctx: Ctx, id: string, type: 'business' | 'it'): Promise<string[]> {
  const rows = await ctx.runner.query(`SELECT user_id::text AS id FROM application_owners WHERE application_id = $1 AND owner_type = $2 ORDER BY user_id`, [id, type]);
  return rows.map((row: { id: string }) => row.id);
}

/** The audit rows of the applications and their owners, per record. */
async function auditRows(ctx: Ctx, table: 'applications' | 'application_owners', ids: string[]): Promise<number> {
  const [row] = await ctx.runner.query(
    `SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND table_name = $2 AND action = 'update' AND record_id = ANY($3::uuid[])`,
    [ctx.tenantId, table, ids],
  );
  return row.n;
}

const sorted = (ids: string[]) => [...ids].sort();

const tests: Array<[string, () => Promise<void>]> = [
  ['three chosen applications: the dry run counts and writes nothing; the write changes them with one audit row each', () => inTenant(async (ctx) => {
    const chosen = ctx.apps.slice(0, 3);
    const body = { ids: chosen, changes: { lifecycle: 'deprecated' } };
    const dry = await ctx.svc.bulkUpdate({ ...body, dry_run: true }, null, opts(ctx));
    assert.deepEqual({ rows: dry.rows, changes: dry.changes, unchanged: dry.unchanged, refused: dry.refused }, { rows: 3, changes: 3, unchanged: 0, refused: {} });
    assert.match(String(dry.fingerprint), /^[0-9a-f]{64}$/);
    for (const id of chosen) assert.equal(await column(ctx, id, 'lifecycle'), 'active', 'the dry run wrote nothing');
    assert.equal(await auditRows(ctx, 'applications', chosen), 0, 'the dry run left no audit row');

    const done = await ctx.svc.bulkUpdate({ ...body, as_of: dry.as_of, expected_rows: dry.rows, fingerprint: dry.fingerprint }, null, opts(ctx));
    assert.deepEqual({ rows: done.rows, changed: done.changed, unchanged: done.unchanged, refused: done.refused }, { rows: 3, changed: 3, unchanged: 0, refused: {} });
    for (const id of chosen) assert.equal(await column(ctx, id, 'lifecycle'), 'deprecated');
    for (const id of ctx.apps.slice(3)) assert.equal(await column(ctx, id, 'lifecycle'), 'active', 'an application not chosen is untouched');
    assert.equal(await auditRows(ctx, 'applications', chosen), 3, 'one audit row per changed application');
    const [row] = await ctx.runner.query(
      `SELECT before_json->>'lifecycle' AS before, after_json->>'lifecycle' AS after FROM audit_log WHERE tenant_id = $1 AND table_name = 'applications' AND record_id = $2`,
      [ctx.tenantId, chosen[0]],
    );
    assert.deepEqual(row, { before: 'active', after: 'deprecated' }, 'the history reads the change');

    const again = await ctx.svc.bulkUpdate({ ...body, dry_run: true }, null, opts(ctx));
    assert.equal(again.changes, 0);
    assert.equal(again.unchanged, 3, 'applications that already hold the value are unchanged');
    const write = await ctx.svc.bulkUpdate(body, null, opts(ctx));
    assert.equal(write.unchanged, 3);
    assert.equal(await auditRows(ctx, 'applications', chosen), 3, 'no audit row for an unchanged application');
  })],

  ['every application of the filter but the excluded ones: exactly the rows the list shows', () => inTenant(async (ctx) => {
    // The list hides retired applications by default; the quick search narrows on the name.
    await ctx.runner.query(`UPDATE applications SET lifecycle = 'retired' WHERE id = $1`, [ctx.apps[4]]);
    await ctx.runner.query(`UPDATE applications SET name = 'Other name' WHERE id = $1`, [ctx.apps[3]]);
    const filters = { q: 'bulk app', include: 'owners,structure' };
    const shown = await ctx.list.list({ ...filters, page: '1', limit: '100' }, opts(ctx));
    const shownIds = shown.items.map((item: any) => item.id as string);
    assert.deepEqual(sorted(shownIds), sorted(ctx.apps.slice(0, 3)), 'harness: the list shows three applications');
    const body = { all: true, filters, exclude_ids: [ctx.apps[1]], changes: { criticality: 'high' } };
    const dry = await ctx.svc.bulkUpdate({ ...body, dry_run: true }, null, opts(ctx));
    assert.equal(dry.rows, 2);
    const done = await ctx.svc.bulkUpdate({ ...body, as_of: dry.as_of, expected_rows: dry.rows, fingerprint: dry.fingerprint }, null, opts(ctx));
    assert.equal(done.changed, 2);
    for (const id of [ctx.apps[0], ctx.apps[2]]) assert.equal(await column(ctx, id, 'criticality'), 'high');
    for (const id of [ctx.apps[1], ctx.apps[3], ctx.apps[4]]) assert.equal(await column(ctx, id, 'criticality'), null, 'excluded, or not in the list');
    // The scope of the list (My applications) is a filter too.
    const mine = await ctx.svc.bulkUpdate({ all: true, filters: { ownerUserId: ctx.people.ana }, changes: { lifecycle: 'proposed' }, dry_run: true }, null, opts(ctx));
    assert.equal(mine.rows, 1, 'only the application Ana owns');
  })],

  ['each field: business owners and IT owners replaced role by role, lifecycle, criticality with its classification revision', () => inTenant(async (ctx) => {
    const [first, second] = ctx.apps;
    const owners = await ctx.svc.bulkUpdate({ ids: [first, second], changes: { owners_business: [ctx.people.cleo, ctx.people.ana] } }, null, opts(ctx));
    assert.equal(owners.changed, 2);
    assert.deepEqual(await ownersOf(ctx, first, 'business'), sorted([ctx.people.cleo, ctx.people.ana]));
    assert.deepEqual(await ownersOf(ctx, second, 'business'), sorted([ctx.people.cleo, ctx.people.ana]));
    assert.deepEqual(await ownersOf(ctx, first, 'it'), [ctx.people.ben], 'the IT owners stay');
    assert.equal(await auditRows(ctx, 'application_owners', [first, second]), 2, 'one audit row per application');
    const it = await ctx.svc.bulkUpdate({ ids: [first, second], changes: { owners_it: [ctx.people.cleo] } }, null, opts(ctx));
    assert.equal(it.changed, 2);
    assert.deepEqual(await ownersOf(ctx, first, 'it'), [ctx.people.cleo]);
    assert.deepEqual(await ownersOf(ctx, first, 'business'), sorted([ctx.people.cleo, ctx.people.ana]), 'the business owners stay');
    const sameOrder = await ctx.svc.bulkUpdate({ ids: [first], changes: { owners_business: [ctx.people.ana, ctx.people.cleo] }, dry_run: true }, null, opts(ctx));
    assert.equal(sameOrder.unchanged, 1, 'the same people in another order: unchanged');

    const revision = Number(await column(ctx, first, 'classification_revision'));
    const criticality = await ctx.svc.bulkUpdate({ ids: [first], changes: { criticality: 'business_critical' } }, null, opts(ctx));
    assert.equal(criticality.changed, 1);
    assert.equal(await column(ctx, first, 'criticality'), 'business_critical');
    assert.equal(Number(await column(ctx, first, 'classification_revision')), revision + 1, 'the classification changed: its review is due again');
  })],

  ['an optional field emptied: the criticality, the business owners', () => inTenant(async (ctx) => {
    const [first, second] = ctx.apps;
    await ctx.svc.bulkUpdate({ ids: [first, second], changes: { criticality: 'low' } }, null, opts(ctx));
    const cleared = await ctx.svc.bulkUpdate({ ids: [first, second], changes: { criticality: null } }, null, opts(ctx));
    assert.equal(cleared.changed, 2);
    assert.equal(await column(ctx, first, 'criticality'), null);
    const nobody = await ctx.svc.bulkUpdate({ ids: [first, second, ctx.apps[2]], changes: { owners_business: [] } }, null, opts(ctx));
    assert.deepEqual({ changed: nobody.changed, unchanged: nobody.unchanged }, { changed: 2, unchanged: 1 });
    assert.deepEqual(await ownersOf(ctx, first, 'business'), []);
    assert.deepEqual(await ownersOf(ctx, first, 'it'), [ctx.people.ben], 'the IT owner stays');
    const asNull = await ctx.svc.bulkUpdate({ ids: [first], changes: { owners_it: null } }, null, opts(ctx));
    assert.equal(asNull.changed, 1);
    assert.deepEqual(await ownersOf(ctx, first, 'it'), []);
  })],

  ['a refused value fails the whole change, nothing written', () => inTenant(async (ctx) => {
    const ids = ctx.apps.slice(0, 2);
    await assert.rejects(ctx.svc.bulkUpdate({ ids, changes: { lifecycle: 'bogus' }, dry_run: true }, null, opts(ctx)), (err: any) => err.status === 400 && /lifecycle must be one of/.test(err.message));
    await assert.rejects(ctx.svc.bulkUpdate({ ids, changes: { lifecycle: null } }, null, opts(ctx)), /lifecycle cannot be emptied/);
    await assert.rejects(ctx.svc.bulkUpdate({ ids, changes: { criticality: 'bogus' } }, null, opts(ctx)), /criticality must be one of/);
    await assert.rejects(ctx.svc.bulkUpdate({ ids, changes: { name: 'x' } }, null, opts(ctx)), /cannot be changed in bulk/);
    // A person that is not of the workspace: the owners' update refuses it, for every application.
    await assert.rejects(ctx.svc.bulkUpdate({ ids, changes: { owners_business: [randomUUID()] } }, null, opts(ctx)), (err: any) => err.status === 400 && /owners not found/.test(err.message));
    assert.deepEqual(await ownersOf(ctx, ctx.apps[0], 'business'), [ctx.people.ana], 'nothing written');
    // A level no longer offered is never newly assigned.
    await ctx.runner.query(
      `UPDATE tenants SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{it_ops}', COALESCE(metadata->'it_ops', '{}'::jsonb) || $2::jsonb) WHERE id = $1`,
      [ctx.tenantId, JSON.stringify({ business_criticality_levels: [
        { code: 'high', label: 'High', rank: 2 },
        { code: 'legacy', label: 'Legacy', rank: 1, deprecated: true },
      ] })],
    );
    await assert.rejects(ctx.svc.bulkUpdate({ ids, changes: { criticality: 'legacy' } }, null, opts(ctx)), /criticality must be one of high or null/);
  })],

  ['a Business Contributor: the applications they own only; the others are refused as an unknown id, nothing leaks', () => inTenant(async (ctx) => {
    const scope = { userId: ctx.people.ana };
    const ids = [ctx.apps[0], ctx.apps[1], randomUUID()];
    const dry = await ctx.svc.bulkUpdate({ ids, changes: { lifecycle: 'deprecated' }, dry_run: true }, null, opts(ctx, scope));
    assert.deepEqual({ rows: dry.rows, changes: dry.changes, refused: dry.refused }, { rows: 3, changes: 1, refused: { not_found: 2 } }, 'an application outside their scope counts as an unknown id');
    const done = await ctx.svc.bulkUpdate({ ids, changes: { lifecycle: 'deprecated' } }, null, opts(ctx, scope));
    assert.equal(done.changed, 1);
    assert.equal(await column(ctx, ctx.apps[1], 'lifecycle'), 'active', 'nothing written outside the scope');
    const all = await ctx.svc.bulkUpdate({ all: true, filters: {}, changes: { lifecycle: 'proposed' }, dry_run: true }, null, opts(ctx, scope));
    assert.deepEqual({ rows: all.rows, changes: all.changes, unchanged: all.unchanged, refused: all.refused }, { rows: 1, changes: 1, unchanged: 0, refused: {} }, 'the filter reaches their applications only');
  })],

  ['the list changes between the count and the write: 409, a swap included, nothing written', () => inTenant(async (ctx) => {
    await ctx.runner.query(`UPDATE applications SET name = 'Elsewhere' WHERE id = $1`, [ctx.apps[4]]);
    const body = { all: true, filters: { q: 'bulk app' }, changes: { lifecycle: 'deprecated' } };
    const dry = await ctx.svc.bulkUpdate({ ...body, dry_run: true }, null, opts(ctx));
    assert.equal(dry.rows, 4);
    const confirm = { ...body, as_of: dry.as_of, expected_rows: dry.rows, fingerprint: dry.fingerprint };
    const changed = (err: any) => err.status === 409 && err.getResponse().code === 'bulk_list_changed';
    // One enters the filter, another leaves it: as many applications, not the same ones.
    await ctx.runner.query(`UPDATE applications SET name = 'Bulk app back' WHERE id = $1`, [ctx.apps[4]]);
    await ctx.runner.query(`UPDATE applications SET name = 'Gone' WHERE id = $1`, [ctx.apps[0]]);
    await assert.rejects(ctx.svc.bulkUpdate(confirm, null, opts(ctx)), changed);
    // One more than counted.
    await ctx.runner.query(`UPDATE applications SET name = 'Bulk app again' WHERE id = $1`, [ctx.apps[0]]);
    await assert.rejects(ctx.svc.bulkUpdate(confirm, null, opts(ctx)), changed);
    for (const id of ctx.apps) assert.equal(await column(ctx, id, 'lifecycle'), 'active', 'nothing written');
    // Back to the counted applications, plus one created after the count: it stays out, without a 409.
    await ctx.runner.query(`UPDATE applications SET name = 'Elsewhere' WHERE id = $1`, [ctx.apps[4]]);
    const late = await ctx.crud.create({ name: 'Bulk app late' } as any, null, { manager: ctx.runner.manager });
    await ctx.runner.query(`UPDATE applications SET created_at = clock_timestamp() + interval '1 minute' WHERE id = $1`, [late.id]);
    const done = await ctx.svc.bulkUpdate(confirm, null, opts(ctx));
    assert.equal(done.changed, 4, 'the counted applications, and only them');
    assert.equal(await column(ctx, late.id, 'lifecycle'), 'active', 'the new application stays as it is');
  })],

  ['the cap counts the applications left once the unticked ones are out, as the budget lines do', () => inTenant(async (ctx) => {
    // A filter that reaches 5,001 ids (none of them an application of the tenant: nothing is written).
    const many = Array.from({ length: BULK_MAX_ROWS + 1 }, () => randomUUID());
    const deps = {
      manager: ctx.runner.manager,
      tenantId: ctx.tenantId,
      values: async () => ({ lifecycle: ['active'], criticality: [] }),
      listIds: async (query: Record<string, unknown>) => ({ ids: many.slice(0, Number(query.limit)), total: many.length }),
      update: async () => undefined,
      replaceOwners: async () => undefined,
    };
    const body = { all: true, filters: {}, changes: { lifecycle: 'active' }, dry_run: true };
    const tooMany = (err: any) => err.status === 400 && err.getResponse().code === 'bulk_too_many';
    const dry = await bulkUpdateApplications({ ...body, exclude_ids: [many[BULK_MAX_ROWS]] }, deps);
    assert.equal(dry.rows, 0, '5,001 less one unticked: counted');
    await assert.rejects(bulkUpdateApplications(body, deps), tooMany);
    await assert.rejects(bulkUpdateApplications({ ...body, exclude_ids: [randomUUID()] }, deps), tooMany, 'an unticked id the filter does not reach leaves 5,001');
  })],

  ['more than 5,000 applications: 400 bulk_too_many; with all, as_of, expected_rows and fingerprint are required', () => inTenant(async (ctx) => {
    const many = Array.from({ length: BULK_MAX_ROWS + 1 }, () => randomUUID());
    await assert.rejects(
      ctx.svc.bulkUpdate({ ids: many, changes: { lifecycle: 'active' }, dry_run: true }, null, opts(ctx)),
      (err: any) => err.status === 400 && err.getResponse().code === 'bulk_too_many',
    );
    const all = { all: true, filters: {}, changes: { lifecycle: 'active' } };
    await assert.rejects(ctx.svc.bulkUpdate({ ...all, expected_rows: 5 }, null, opts(ctx)), /as_of is required/);
    await assert.rejects(ctx.svc.bulkUpdate({ ...all, as_of: new Date().toISOString() }, null, opts(ctx)), /expected_rows is required/);
    await assert.rejects(ctx.svc.bulkUpdate({ ...all, as_of: new Date().toISOString(), expected_rows: 5 }, null, opts(ctx)), /fingerprint is required/);
    await assert.rejects(ctx.svc.bulkUpdate({ ids: [ctx.apps[0]], changes: { lifecycle: 'active' }, dry_run: 'true' }, null, opts(ctx)), /dry_run must be true or false/);
  })],

  ['the search index follows the change', () => inTenant(async (ctx) => {
    const ids = ctx.apps.slice(0, 2);
    await ctx.svc.bulkUpdate({ ids, changes: { lifecycle: 'deprecated' } }, null, opts(ctx));
    await ctx.svc.bulkUpdate({ ids, changes: { owners_business: [ctx.people.cleo] } }, null, opts(ctx));
    for (const id of ids) {
      const [row] = await ctx.runner.query(
        `SELECT extra_json->>'lifecycle' AS lifecycle, extra_json->>'business_owner' AS owner FROM search_index WHERE tenant_id = $1 AND entity_type = 'applications' AND entity_id = $2`,
        [ctx.tenantId, id],
      );
      assert.deepEqual(row, { lifecycle: 'deprecated', owner: 'cleo Zqowner' });
    }
  })],

  ['1,000 applications: the time of the count and of the write', () => inTenant(async (ctx) => {
    const body = { all: true, filters: {}, changes: { lifecycle: 'deprecated' } };
    let started = Date.now();
    const dry = await ctx.svc.bulkUpdate({ ...body, dry_run: true }, null, opts(ctx));
    const countMs = Date.now() - started;
    assert.equal(dry.rows, 1000);
    started = Date.now();
    const done = await ctx.svc.bulkUpdate({ ...body, as_of: dry.as_of, expected_rows: dry.rows, fingerprint: dry.fingerprint }, null, opts(ctx));
    const writeMs = Date.now() - started;
    assert.equal(done.changed, 1000);
    started = Date.now();
    const owners = await ctx.svc.bulkUpdate({ all: true, filters: {}, changes: { owners_it: [ctx.people.cleo] }, dry_run: true }, null, opts(ctx));
    const ownersMs = Date.now() - started;
    assert.equal(owners.changes, 1000);
    console.log(`applications bulk: 1000 applications, lifecycle count ${countMs} ms, write ${writeMs} ms; IT owners count ${ownersMs} ms`);
  }, 1000)],
];

void runSpecs('applications-bulk-update', tests);
