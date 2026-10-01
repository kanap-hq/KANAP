import 'reflect-metadata';
import 'dotenv/config';
import { BadRequestException } from '@nestjs/common';
import { QueryRunner, Repository } from 'typeorm';
import dataSource from '../../data-source';
import { Tenant, TenantStatus } from '../tenant.entity';
import { TenantsService } from '../tenants.service';
import { BudgetColumnsService } from '../../budget-columns/budget-columns.service';
import { AdminTenantsService } from '../../admin/tenants/admin-tenants.service';
import { BillingService } from '../../billing/billing.service';
import { StripeWebhookService } from '../../billing/stripe-webhook.service';
import { AdminBrandingController } from '../../admin/branding/admin-branding.controller';
import { EntraDirectorySyncService } from '../../auth/entra-directory-sync.service';
import {
  assert,
  captureAudit,
  inRolledBackTransaction,
  runSpecs,
  seedTenant,
} from '../../spend/__tests__/round-inputs.fixtures';

// A tenant row carries several jsonb columns written by different features
// (metadata: budget columns, currency, IT landscape; branding; entra_metadata).
// A writer that loaded the tenant earlier must change only its own columns or
// keys: a setting saved between its load and its write survives.

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=',
  'base64',
);

// The raw stored row (jsonb columns as parsed by the driver).
type Row = Record<string, any>;

async function row(runner: QueryRunner, tenantId: string): Promise<Row> {
  const [found] = await runner.query(`SELECT * FROM tenants WHERE id = $1`, [tenantId]);
  return found;
}

/**
 * What another request saves meanwhile: a budget column name through the
 * settings service, a branding colour and an Entra display name.
 */
async function writeConcurrently(runner: QueryRunner, tenantId: string) {
  await new BudgetColumnsService(runner.manager.getRepository(Tenant), captureAudit() as any)
    .update(tenantId, { labels: { planned: 'A0' } }, null, runner.manager);
  await runner.query(
    `UPDATE tenants
     SET branding = branding || '{"primary_color_dark":"#112233"}'::jsonb,
         entra_metadata = COALESCE(entra_metadata, '{}'::jsonb) || '{"display_name":"Concurrent"}'::jsonb
     WHERE id = $1`,
    [tenantId],
  );
}

async function assertConcurrentKept(
  runner: QueryRunner,
  tenantId: string,
  label: string,
  keep: { branding?: boolean; entra?: boolean } = { branding: true, entra: true },
) {
  const stored = await row(runner, tenantId);
  assert.equal(stored.metadata?.budget_columns?.labels?.planned, 'A0', `${label}: the budget column saved meanwhile is kept`);
  if (keep.branding !== false) {
    assert.equal(stored.branding?.primary_color_dark, '#112233', `${label}: the branding colour saved meanwhile is kept`);
  }
  if (keep.entra !== false) {
    assert.equal(stored.entra_metadata?.display_name, 'Concurrent', `${label}: the Entra key saved meanwhile is kept`);
  }
  return stored;
}

/** A repository whose first `findOne` returns the row read before `afterLoad` ran. */
function staleOnFirstLoad(repo: Repository<Tenant>, afterLoad: () => Promise<void>): Repository<Tenant> {
  const hooked = Object.create(repo) as Repository<Tenant>;
  let fired = false;
  (hooked as any).findOne = async (...args: any[]) => {
    const found = await (repo.findOne as any)(...args);
    if (!fired) {
      fired = true;
      await afterLoad();
    }
    return found;
  };
  return hooked;
}

function billingService(repo: Repository<Tenant>, client: unknown) {
  const svc = new BillingService(
    undefined as any,
    undefined as any,
    repo,
    { getClient: () => client } as any,
    undefined as any,
    undefined as any,
    captureAudit() as any,
  );
  (svc as any).logger = { warn: () => undefined, log: () => undefined };
  return svc;
}

/** Freeze, unfreeze and the delete flow write their status columns only. */
async function testAdminTenantLifecycle() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'f3-freeze');
    const repo = runner.manager.getRepository(Tenant);
    const svc = new AdminTenantsService(
      undefined as any,
      { delete: async () => undefined } as any,
      undefined as any,
      undefined as any,
      undefined as any,
      captureAudit() as any,
      undefined as any,
    );
    // The audit rows: the copy kept in memory must carry the written columns.
    const logged: Array<{ action: string; before: any; after: any }> = [];
    (svc as any).tenants = repo;
    (svc as any).logTenantAction = async (_id: string, _actor: string | null, action: string, before: any, after: any) => {
      logged.push({ action, before, after });
    };
    const lastLog = () => logged[logged.length - 1];
    const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : value ?? null);
    (svc as any).getTenantDetail = async (id: string) => ({ id });
    const load = async (id: string) => {
      const tenant = await repo.findOne({ where: { id } });
      await writeConcurrently(runner, id);
      return tenant;
    };

    (svc as any).findTenantOrFail = load;
    await svc.freezeTenant(tenantId, null, { reason: 'Unpaid' } as any);
    let stored = await assertConcurrentKept(runner, tenantId, 'freeze');
    assert.equal(stored.status, TenantStatus.FROZEN);
    assert.equal(stored.notes, 'Unpaid');
    assert.ok(stored.frozen_at, 'frozen_at is written');
    assert.deepEqual(
      [lastLog().action, lastLog().before.status, lastLog().after.status, lastLog().after.notes, lastLog().after.frozen_at],
      ['freeze', TenantStatus.ACTIVE, TenantStatus.FROZEN, 'Unpaid', iso(stored.frozen_at)],
    );

    await runner.query(`UPDATE tenants SET metadata = '{}'::jsonb WHERE id = $1`, [tenantId]);
    await svc.unfreezeTenant(tenantId, null);
    stored = await assertConcurrentKept(runner, tenantId, 'unfreeze');
    assert.equal(stored.status, TenantStatus.ACTIVE);
    assert.equal(stored.frozen_at, null);
    assert.deepEqual(
      [lastLog().action, lastLog().before.status, lastLog().after.status, lastLog().after.frozen_at, lastLog().after.frozen_by],
      ['unfreeze', TenantStatus.FROZEN, TenantStatus.ACTIVE, null, null],
    );

    // Delete: the purge runs between the request write and the completion write.
    await runner.query(`UPDATE tenants SET metadata = '{}'::jsonb WHERE id = $1`, [tenantId]);
    (svc as any).findTenantOrFail = (id: string) => repo.findOne({ where: { id } });
    (svc as any).purgeTenantData = async () => {
      await writeConcurrently(runner, tenantId);
      return [];
    };
    const slug = (await row(runner, tenantId)).slug;
    await svc.deleteTenant(tenantId, null, { confirmSlug: slug, reason: 'Closed' } as any);
    stored = await assertConcurrentKept(runner, tenantId, 'delete');
    assert.equal(stored.status, TenantStatus.DELETED);
    assert.equal(stored.deletion_reason, 'Closed');
    assert.ok(stored.deleted_at, 'deleted_at is written');
    assert.ok(String(stored.slug).startsWith(`deleted-${slug}-`), 'the slug is released');
    const [request, complete] = logged.slice(-2);
    assert.deepEqual(
      [request.action, request.before.status, request.after.status, request.after.deletion_reason, request.after.deletion_requested_at],
      ['delete-request', TenantStatus.ACTIVE, TenantStatus.DELETING, 'Closed', iso(stored.deletion_requested_at)],
    );
    assert.deepEqual(
      [complete.action, complete.before.status, complete.before.slug, complete.after.status, complete.after.slug, complete.after.deleted_at, complete.after.notes],
      ['delete-complete', TenantStatus.DELETING, slug, TenantStatus.DELETED, stored.slug, iso(stored.deleted_at), null],
    );

    // A failed purge sets the tenant back to frozen and keeps the rest.
    const otherId = await seedTenant(runner, 'f3-delfail');
    const otherSlug = (await row(runner, otherId)).slug;
    (svc as any).purgeTenantData = async () => {
      await writeConcurrently(runner, otherId);
      throw new Error('purge failed');
    };
    await assert.rejects(() => svc.deleteTenant(otherId, null, { confirmSlug: otherSlug } as any), /purge failed/);
    stored = await assertConcurrentKept(runner, otherId, 'delete failed');
    assert.equal(stored.status, TenantStatus.FROZEN);
    assert.equal(stored.slug, otherSlug);
    assert.deepEqual(
      [lastLog().action, lastLog().before.status, lastLog().after.status, lastLog().after.slug],
      ['delete-failed', TenantStatus.DELETING, TenantStatus.FROZEN, otherSlug],
    );
    assert.deepEqual(
      logged.map((entry) => entry.action),
      ['freeze', 'unfreeze', 'delete-request', 'delete-complete', 'delete-request', 'delete-failed'],
    );
  });
}

/** The billing profile writes the billing columns only. */
async function testUpdateBillingProfile() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'f3-billing');
    const svc = billingService(runner.manager.getRepository(Tenant), null);
    const requireTenant = (svc as any).requireTenant.bind(svc);
    (svc as any).requireTenant = async (id: string, manager?: any) => {
      const tenant = await requireTenant(id, manager);
      await writeConcurrently(runner, id);
      return tenant;
    };
    const result = await svc.updateBillingProfile({
      tenantId,
      manager: runner.manager,
      invoice: { company: 'Fromage SA', email: 'billing@example.com', vatNumber: 'FR123' } as any,
    });
    assert.equal(result.invoice.company, 'Fromage SA');
    const stored = await assertConcurrentKept(runner, tenantId, 'billing profile');
    assert.equal(stored.billing_email, 'billing@example.com');
    assert.equal(stored.billing_company_name, 'Fromage SA');
    assert.equal(stored.billing_tax_id, 'FR123');
    assert.equal(stored.billing_invoice_info?.company, 'Fromage SA');
  });
}

/**
 * The tenant is loaded by the checkout caller, then Stripe creates the
 * customer: a settings save during that call survives the id write.
 */
async function testEnsureStripeCustomer() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'f3-stripe');
    const repo = runner.manager.getRepository(Tenant);
    const client = {
      customers: {
        create: async () => {
          await writeConcurrently(runner, tenantId);
          return { id: 'cus_f3_new' };
        },
      },
    };
    const svc = billingService(repo, client);
    const tenant = await repo.findOne({ where: { id: tenantId } });
    const customerId = await (svc as any).ensureStripeCustomerForTenant(tenant, { manager: runner.manager });
    assert.equal(customerId, 'cus_f3_new');
    const stored = await assertConcurrentKept(runner, tenantId, 'stripe customer');
    assert.equal(stored.stripe_customer_id, 'cus_f3_new');
    const [sub] = await runner.query(`SELECT stripe_customer_id FROM subscriptions WHERE tenant_id = $1`, [tenantId]);
    assert.equal(sub?.stripe_customer_id, 'cus_f3_new', 'the subscription points at the customer');
  });
}

/** A Stripe webhook records the customer id only. */
async function testWebhookCustomerId() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'f3-webhook');
    const repo = staleOnFirstLoad(runner.manager.getRepository(Tenant), () => writeConcurrently(runner, tenantId));
    const svc = new StripeWebhookService(undefined as any, undefined as any, { getRepository: () => repo } as any, undefined as any);
    await (svc as any).updateTenantStripeCustomer(tenantId, 'cus_f3_hook');
    const stored = await assertConcurrentKept(runner, tenantId, 'webhook');
    assert.equal(stored.stripe_customer_id, 'cus_f3_hook');
  });
}

/** `updateTenant` writes the patch's columns and returns the fresh row. */
async function testUpdateTenantWritesThePatchOnly() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'f3-update');
    // A value the patch leaves undefined is not touched (not set to NULL).
    await runner.query(`UPDATE tenants SET notes = 'keep' WHERE id = $1`, [tenantId]);
    const repo = staleOnFirstLoad(runner.manager.getRepository(Tenant), () => writeConcurrently(runner, tenantId));
    const tenants = new TenantsService(repo, undefined as any, undefined as any);
    const updated = await tenants.updateTenant(tenantId, { name: 'Renamed', notes: undefined });
    assert.ok(updated instanceof Tenant, 'a Tenant entity is returned');
    assert.equal(updated.name, 'Renamed');
    assert.equal(updated.metadata?.budget_columns?.labels?.planned, 'A0', 'the returned row is the fresh one');
    assert.equal((await assertConcurrentKept(runner, tenantId, 'updateTenant(name)')).notes, 'keep', 'an undefined value is skipped');
    assert.equal((await tenants.updateTenant(tenantId, { notes: null })).notes, null, 'a null value is written');

    // A whole-column replace (SSO disconnect, Entra setup) touches that column only.
    await runner.query(`UPDATE tenants SET metadata = '{}'::jsonb WHERE id = $1`, [tenantId]);
    const replacing = new TenantsService(
      staleOnFirstLoad(runner.manager.getRepository(Tenant), () => writeConcurrently(runner, tenantId)),
      undefined as any,
      undefined as any,
    );
    await replacing.updateTenant(tenantId, { sso_provider: 'none', sso_enabled: false, entra_tenant_id: null, entra_metadata: null });
    const stored = await assertConcurrentKept(runner, tenantId, 'updateTenant(disconnect)', { branding: true, entra: false });
    assert.equal(stored.entra_metadata, null, 'the replaced column is written');

    await assert.rejects(() => tenants.updateTenant('00000000-0000-4000-8000-000000000000', { name: 'x' }), /Tenant not found/);

    // A key that is not a tenant column is a 400 and writes nothing.
    await assert.rejects(
      () => tenants.updateTenant(tenantId, { name: 'Typo', brandng: {} } as any),
      (err: any) => err instanceof BadRequestException && err.message === 'Unknown tenant field: brandng',
    );
    assert.equal((await row(runner, tenantId)).name, 'Renamed');
  });
}

/** Branding endpoints merge their own keys after the storage call. */
async function testBrandingKeyMerge() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'f3-branding');
    const repo = runner.manager.getRepository(Tenant);
    const tenants = new TenantsService(repo, undefined as any, undefined as any);
    const objects: string[] = [];
    const storage = {
      putObject: async ({ key }: { key: string }) => {
        objects.push(`put ${key}`);
        await writeConcurrently(runner, tenantId);
      },
      // Deleting the old logo also lets another request save meanwhile.
      deleteObject: async (key: string) => {
        objects.push(`delete ${key}`);
        await writeConcurrently(runner, tenantId);
        await runner.query(`UPDATE tenants SET branding = branding || '{"use_logo_in_dark":false}'::jsonb WHERE id = $1`, [tenantId]);
      },
    };
    const controller = new AdminBrandingController(tenants, storage as any);
    const req = { tenant: { id: tenantId }, queryRunner: { manager: runner.manager } };

    const uploaded = await controller.uploadLogo(
      { buffer: PNG_1X1, originalname: 'logo.png', mimetype: 'image/png', size: PNG_1X1.length } as any,
      req,
    );
    assert.deepEqual(uploaded, { ok: true, has_logo: true, logo_version: 1, use_logo_in_dark: true });
    let stored = await assertConcurrentKept(runner, tenantId, 'upload logo');
    assert.equal(stored.branding.logo_storage_path, `files/${tenantId}/branding/logo.png`);
    assert.equal(stored.branding.logo_version, 1);

    // Settings: only the keys sent are written.
    await runner.query(`UPDATE tenants SET branding = branding || '{"primary_color_dark":"#445566"}'::jsonb WHERE id = $1`, [tenantId]);
    const settings = await controller.updateSettings({ primary_color_light: '#abcdef' }, req);
    assert.equal(settings.primary_color_light, '#ABCDEF');
    assert.equal(settings.primary_color_dark, '#445566', 'the response reflects the stored row');
    assert.equal(settings.has_logo, true);
    stored = await row(runner, tenantId);
    assert.equal(stored.branding.primary_color_dark, '#445566');

    // Delete: the version bumps from the stored value, the logo key goes, and
    // what was saved during the storage call (a colour, the dark-mode flag) stays.
    await runner.query(`UPDATE tenants SET metadata = '{}'::jsonb, branding = branding || '{"logo_version":7}'::jsonb WHERE id = $1`, [tenantId]);
    const deleted = await controller.deleteLogo(req);
    assert.deepEqual(deleted, { ok: true, has_logo: false, logo_version: 8, use_logo_in_dark: false });
    stored = await assertConcurrentKept(runner, tenantId, 'delete logo');
    assert.equal('logo_storage_path' in stored.branding, false);
    assert.deepEqual([stored.branding.primary_color_light, stored.branding.use_logo_in_dark], ['#ABCDEF', false]);

    // Reset: colours, flag and logo go even when saved during the storage call;
    // the version keeps counting up and the other columns are kept.
    await runner.query(
      `UPDATE tenants SET metadata = '{}'::jsonb, branding = branding || '{"logo_storage_path":"files/old/logo.webp"}'::jsonb WHERE id = $1`,
      [tenantId],
    );
    const reset = await controller.reset(req);
    assert.equal(reset.logo_version, 9);
    stored = await assertConcurrentKept(runner, tenantId, 'reset', { branding: false, entra: true });
    assert.deepEqual(stored.branding, { logo_version: 9, use_logo_in_dark: true, primary_color_light: null, primary_color_dark: null });
    assert.deepEqual(objects, [
      `put files/${tenantId}/branding/logo.png`,
      `delete files/${tenantId}/branding/logo.png`,
      'delete files/old/logo.webp',
    ]);

    // The stored version is read like Number(): any finite number >= 0, floored;
    // a digit string; anything else (non-numeric, negative, out of range) is 0.
    for (const [value, next] of [['5.0', 6], ['5.7', 6], ['"5"', 6], ['"x"', 1], ['true', 1], ['-1', 1], ['1e20', 1], ['null', 1]] as const) {
      await runner.query(`UPDATE tenants SET branding = jsonb_build_object('logo_version', $2::jsonb) WHERE id = $1`, [tenantId, value]);
      assert.equal((await controller.deleteLogo(req)).logo_version, next, `logo_version ${value} becomes ${next}`);
    }
  });
}

/** The directory sync writes its own `directory_sync` key only. */
async function testDirectorySyncStatus() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'f3-entra');
    await runner.query(
      `UPDATE tenants SET sso_provider = 'entra', entra_tenant_id = 'dir-a', entra_metadata = '{"display_name":"Old","directory_sync":{"last_success_at":"2026-01-01T00:00:00.000Z"}}'::jsonb WHERE id = $1`,
      [tenantId],
    );
    const repo = runner.manager.getRepository(Tenant);
    const tenants = new TenantsService(repo, undefined as any, undefined as any);
    const sync = new EntraDirectorySyncService(undefined as any, undefined as any, undefined as any, tenants, undefined as any, undefined as any);
    (sync as any).logger = { warn: (msg: string) => { throw new Error(msg); }, log: () => undefined };

    // The sync loaded the tenant at its start; settings were saved since.
    const loadedAtStart = await repo.findOne({ where: { id: tenantId } });
    await writeConcurrently(runner, tenantId);
    await (sync as any).recordStatus(loadedAtStart, { status: 'error', message: 'Graph refused' });
    let stored = await assertConcurrentKept(runner, tenantId, 'directory sync');
    assert.equal(stored.entra_metadata.directory_sync.status, 'error');
    assert.equal(stored.entra_metadata.directory_sync.message, 'Graph refused');
    assert.equal(stored.entra_metadata.directory_sync.last_success_at, '2026-01-01T00:00:00.000Z', 'the last success is kept on error');

    await (sync as any).recordStatus(loadedAtStart, {
      status: 'ok', synced: 3, disabled: 1, removed: 0, managers_updated: 2, managers_unresolved: 0,
    });
    stored = await assertConcurrentKept(runner, tenantId, 'directory sync ok');
    assert.equal(stored.entra_metadata.directory_sync.synced, 3);
    assert.notEqual(stored.entra_metadata.directory_sync.last_success_at, '2026-01-01T00:00:00.000Z');

    // A tenant without Entra metadata gets the key in a new object.
    await runner.query(`UPDATE tenants SET entra_metadata = NULL WHERE id = $1`, [tenantId]);
    await (sync as any).recordStatus(loadedAtStart, { status: 'consent_required', message: 'no consent' });
    stored = await row(runner, tenantId);
    assert.deepEqual(Object.keys(stored.entra_metadata), ['directory_sync']);
    assert.equal(stored.entra_metadata.directory_sync.status, 'consent_required');

    // SSO disconnected while the sync ran: nothing is written.
    await runner.query(
      `UPDATE tenants SET sso_provider = 'none', entra_tenant_id = NULL, entra_metadata = NULL WHERE id = $1`,
      [tenantId],
    );
    await (sync as any).recordStatus(loadedAtStart, { status: 'error', message: 'late result' });
    assert.equal((await row(runner, tenantId)).entra_metadata, null, 'a disconnected tenant gets no status');

    // Reconnected to another directory while the sync ran: nothing is written.
    const reconnected = { display_name: 'Directory B', connected_at: '2026-10-01T00:00:00.000Z' };
    await runner.query(
      `UPDATE tenants SET sso_provider = 'entra', entra_tenant_id = 'dir-b', entra_metadata = $2::jsonb WHERE id = $1`,
      [tenantId, JSON.stringify(reconnected)],
    );
    await (sync as any).recordStatus(loadedAtStart, {
      status: 'ok', synced: 9, disabled: 0, removed: 0, managers_updated: 0, managers_unresolved: 0,
    });
    assert.deepEqual((await row(runner, tenantId)).entra_metadata, reconnected, 'directory A results never land on directory B');
  });
}

void runSpecs('tenant-metadata-preserved.integration.spec', [
  ['testAdminTenantLifecycle', testAdminTenantLifecycle],
  ['testUpdateBillingProfile', testUpdateBillingProfile],
  ['testEnsureStripeCustomer', testEnsureStripeCustomer],
  ['testWebhookCustomerId', testWebhookCustomerId],
  ['testUpdateTenantWritesThePatchOnly', testUpdateTenantWritesThePatchOnly],
  ['testBrandingKeyMerge', testBrandingKeyMerge],
  ['testDirectorySyncStatus', testDirectorySyncStatus],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
