import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';
import dataSource from '../../../data-source';
import { Account } from '../../../accounts/account.entity';
import { AccountsService } from '../../../accounts/accounts.service';
import { ChartOfAccounts } from '../../../accounts/chart-of-accounts.entity';
import { ChartOfAccountsService } from '../../../accounts/chart-of-accounts.service';
import { AuditLog } from '../../../audit/audit.entity';
import { AuditService } from '../../../audit/audit.service';
import { PasswordResetToken } from '../../../auth/password-reset-token.entity';
import { RefreshToken } from '../../../auth/refresh-token.entity';
import { AuthService } from '../../../auth/auth.service';
import { Subscription, SubscriptionStatus } from '../../../billing/subscription.entity';
import { TRIAL_PERIOD_DAYS } from '../../../billing/plans.config';
import { allocateItemNumbers } from '../../../common/item-number.service';
import { TENANT_SCOPED_TABLES } from '../../../common/tenant-isolation.inventory';
import { Company } from '../../../companies/company.entity';
import { CompaniesService } from '../../../companies/companies.service';
import { Department } from '../../../departments/department.entity';
import { RolePermission } from '../../../permissions/role-permission.entity';
import { PermissionsService } from '../../../permissions/permissions.service';
import { UserPageRole } from '../../../permissions/user-page-role.entity';
import { TrialSignup } from '../../../public/trial-signup.entity';
import { Role } from '../../../roles/role.entity';
import { RolesService } from '../../../roles/roles.service';
import { buildStartingCompanyName, TenantBaselineService } from '../../../tenants/tenant-baseline.service';
import { Tenant } from '../../../tenants/tenant.entity';
import { TenantsService } from '../../../tenants/tenants.service';
import { User } from '../../../users/user.entity';
import { UsersService } from '../../../users/users.service';
import { AdminTenantsService } from '../admin-tenants.service';
import { purgeTenantTables } from '../tenant-data-purge';
import { TENANT_PURGE_ATTACHMENT_TABLES, TENANT_PURGE_TABLES } from '../tenant-purge.inventory';
import { TenantResetService } from '../tenant-reset.service';
import { TenantStatsService } from '../tenant-stats.service';

// Shared by the tenant reset and tenant purge specs (not a spec itself: the runner only picks up
// *.spec.ts files). The services under test open their own connections, so the tenants are
// committed and removed explicitly at the end of each spec (cleanupTenants).

// Password reset links are signed: a key for the specs when none is configured.
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'tenant-reset-spec-signing-key';

export async function setCurrentTenant(executor: EntityManager, tenantId: string) {
  await executor.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

/** Runs `fn` in a committed transaction scoped to the tenant. */
export async function inTenant<T>(tenantId: string, fn: (manager: EntityManager) => Promise<T>): Promise<T> {
  return dataSource.transaction(async (manager) => {
    await setCurrentTenant(manager, tenantId);
    return fn(manager);
  });
}

/** The tenant of a storage path written by these helpers: `reset-spec/<tenant id>/...`. */
function tenantOfPath(path: string): string | null {
  const match = /^reset-spec\/([0-9a-f-]{36})\//.exec(path);
  return match ? match[1] : null;
}

/** True when a committed attachment row still holds the path (read from another connection). */
async function pathStillReferenced(path: string): Promise<boolean> {
  const tenantId = tenantOfPath(path);
  if (!tenantId) return false;
  return inTenant(tenantId, async (manager) => {
    for (const table of TENANT_PURGE_ATTACHMENT_TABLES) {
      const [row] = await manager.query(`SELECT count(*)::int AS n FROM ${table} WHERE storage_path = $1`, [path]);
      if (row.n > 0) return true;
    }
    return false;
  });
}

/**
 * Storage double: records every deletion, and the ones made while a committed attachment row
 * still held the path (a deletion before the commit of the purge).
 */
export class RecordingStorage {
  deleted: string[] = [];
  deletedBeforeCommit: string[] = [];
  failing = new Set<string>();

  async deleteObject(key: string): Promise<void> {
    if (await pathStillReferenced(key)) this.deletedBeforeCommit.push(key);
    if (this.failing.has(key)) throw new Error(`storage double: ${key} cannot be deleted`);
    this.deleted.push(key);
  }

  async putObject(): Promise<void> { throw new Error('storage double: putObject not expected'); }
  async getObjectStream(): Promise<never> { throw new Error('storage double: getObjectStream not expected'); }
  async headObject(): Promise<null> { return null; }
  async getPresignedUrl(): Promise<string> { throw new Error('storage double: getPresignedUrl not expected'); }
  async *listObjects(): AsyncGenerator<{ key: string; lastModified: Date | null; size: number }> { /* empty */ }
}

export type Services = ReturnType<typeof buildServices>;

/** The real services on the spec data source; storage is the recording double. */
export function buildServices(opts: { storage?: RecordingStorage; resetAudit?: AuditService } = {}) {
  const repo = dataSource.getRepository.bind(dataSource);
  const audit = new AuditService(repo(AuditLog));
  const roles = new RolesService(repo(Role), repo(RolePermission));
  const permissions = new PermissionsService(repo(UserPageRole), repo(RolePermission));
  const tenants = new TenantsService(repo(Tenant), roles, permissions);
  const accounts = new AccountsService(repo(Account), audit);
  const coas = new ChartOfAccountsService(repo(ChartOfAccounts), repo(Company), repo(Account), audit, accounts);
  const companies = new CompaniesService(repo(Company), audit, {} as any);
  const users = new UsersService(
    repo(User), repo(Company), repo(Department), roles, {} as any, {} as any, audit, repo(PasswordResetToken),
  );
  const auth = new AuthService(users, repo(RefreshToken), repo(PasswordResetToken));
  const baseline = new TenantBaselineService(tenants, coas, companies);
  const storage = opts.storage ?? new RecordingStorage();
  const reset = new TenantResetService(dataSource, baseline, opts.resetAudit ?? audit, storage as any);
  const admin = new AdminTenantsService(
    repo(Tenant),
    repo(TrialSignup),
    dataSource,
    new TenantStatsService(dataSource),
    { getSubscriptionSummary: async () => null } as any,
    audit,
    storage as any,
  );
  return { audit, roles, tenants, coas, companies, users, auth, baseline, reset, admin, storage };
}

/**
 * The global chart of accounts template marked loaded_by_default. Migrated databases carry one
 * (IFRS, 1826000000000-seed-coa-templates.ts) and a unique index allows no second one: the spec
 * inserts a small one only when none exists, and removes it at the end.
 */
export async function ensureDefaultCoaTemplate(): Promise<{ id: string; inserted: boolean }> {
  const [existing] = await dataSource.query(
    `SELECT id FROM coa_templates WHERE is_global = true AND loaded_by_default = true LIMIT 1`,
  );
  if (existing) return { id: existing.id, inserted: false };
  const csv = [
    'account_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status',
    '6000;Software licences;;;6000;Software licences;;enabled',
    '6100;IT services;;;6100;IT services;;enabled',
  ].join('\n');
  const [row] = await dataSource.query(
    `INSERT INTO coa_templates (country_iso, template_code, template_name, version, is_global, loaded_by_default, csv_payload)
     VALUES (NULL, 'RESET-SPEC', 'Reset spec chart', '1.0', true, true, $1) RETURNING id`,
    [csv],
  );
  return { id: row.id, inserted: true };
}

export async function removeCoaTemplate(template: { id: string; inserted: boolean }) {
  if (template.inserted) await dataSource.query(`DELETE FROM coa_templates WHERE id = $1`, [template.id]);
}

export type ActivatedTenant = {
  tenantId: string;
  slug: string;
  ownerId: string;
  ownerEmail: string;
  companyName: string;
  countryIso: string;
};

/**
 * A tenant as trial activation leaves it (PublicController.activateTrial): the tenant with its
 * defaults, the administrator, the starting state (TenantBaselineService.ensureBaseline: chart of
 * accounts and starting company, created by the administrator), the trial subscription, and the
 * administrator's password link. With `signup`, the trial sign-up row of the slug, as activation
 * leaves it.
 */
export async function createActivatedTenant(
  svc: Services,
  opts: { tag: string; orgName: string; countryIso?: string; signup?: boolean },
): Promise<ActivatedTenant> {
  const slug = `rs-${opts.tag}-${randomUUID().slice(0, 8)}`;
  const ownerEmail = `owner-${randomUUID().slice(0, 8)}@reset-spec.test`;
  const countryIso = opts.countryIso ?? 'FR';
  const companyName = buildStartingCompanyName({ org_name: opts.orgName, slug });
  if (opts.signup) {
    await dataSource.query(
      `INSERT INTO trial_signups (org_name, slug, email, country_iso, activated_at) VALUES ($1, $2, $3, $4, now())`,
      [opts.orgName, slug, ownerEmail, countryIso],
    );
  }
  const created = await dataSource.transaction(async (manager) => {
    const tenant = await svc.tenants.createTenant({ slug, name: opts.orgName }, { manager });
    await setCurrentTenant(manager, tenant.id);
    const owner = await svc.users.createUser({
      email: ownerEmail,
      password: randomBytes(18).toString('base64url'),
      role_name: 'Administrator',
      tenant_id: tenant.id,
    }, { manager });
    await svc.baseline.ensureBaseline(manager, tenant.id, { companyName, countryIso, actorId: owner.id });
    await manager.getRepository(Subscription).save({
      tenant_id: tenant.id,
      status: SubscriptionStatus.TRIALING,
      trial_end: new Date(Date.now() + TRIAL_PERIOD_DAYS * 86400000),
      plan_name: 'Trial',
      seat_limit: null,
      active_seats: 0,
    });
    return { tenantId: tenant.id, ownerId: owner.id };
  });
  await inTenant(created.tenantId, (manager) =>
    svc.auth.createPasswordResetToken({ id: created.ownerId, email: ownerEmail, tenant_id: created.tenantId }, manager));
  return { ...created, slug, ownerEmail, companyName, countryIso };
}

/** A second real user, with personal settings that the reset keeps. */
export async function addRealUser(svc: Services, tenantId: string): Promise<string> {
  return inTenant(tenantId, async (manager) => {
    const user = await svc.users.createUser({
      email: `member-${randomUUID().slice(0, 8)}@reset-spec.test`,
      role_name: 'Portfolio Member',
      first_name: 'Real',
      last_name: 'Member',
      tenant_id: tenantId,
    }, { manager });
    await manager.query(
      `INSERT INTO user_notification_preferences (tenant_id, user_id, emails_enabled) VALUES ($1, $2, true)`,
      [tenantId, user.id],
    );
    await manager.query(
      `INSERT INTO user_dashboard_config (tenant_id, user_id, tiles) VALUES ($1, $2, '[{"key":"tasks"}]'::jsonb)`,
      [tenantId, user.id],
    );
    await manager.query(
      `INSERT INTO refresh_tokens (tenant_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 day')`,
      [tenantId, user.id, randomBytes(16).toString('hex')],
    );
    return user.id;
  });
}

/** AI settings an administrator made: a model connection, the settings, a personal key. */
export async function addAiSettings(tenantId: string, userId: string) {
  await inTenant(tenantId, async (manager) => {
    const [model] = await manager.query(
      `INSERT INTO ai_model_configs (tenant_id, name, provider, model, is_default) VALUES ($1, 'Spec model', 'openai', 'gpt-spec', true) RETURNING id`,
      [tenantId],
    );
    await manager.query(
      `INSERT INTO ai_settings (tenant_id, chat_enabled, mcp_enabled, chat_model_config_id) VALUES ($1, true, true, $2)`,
      [tenantId, model.id],
    );
    await manager.query(
      `INSERT INTO ai_api_keys (tenant_id, user_id, created_by_user_id, key_hash, key_prefix, label)
       VALUES ($1, $2, $2, $3, 'kspec', 'Spec key')`,
      [tenantId, userId, randomBytes(16).toString('hex')],
    );
  });
}

export type DemoSet = {
  /** Business references, in creation order. */
  refs: string[];
  /** Storage paths of the attachments. */
  storagePaths: string[];
  demoUserIds: string[];
};

/**
 * A representative sample data set written in SQL, numbered by the real allocators (item numbers
 * and the reference triggers): companies, departments, three `fromage-co.example` users with
 * roles and settings, applications, instances, an interface with a leg and a binding, a
 * connection, a supplier and a contract, an OPEX line with amounts, tasks, a project, a document,
 * attachments with storage paths, audit entries, an AI conversation. The real user given joins a
 * sample company and department.
 */
export async function loadDemoSet(tenantId: string, opts: { realUserId?: string } = {}): Promise<DemoSet> {
  return inTenant(tenantId, async (manager) => {
    const q = (sql: string, params: unknown[] = []) => manager.query(sql, params);
    const path = (kind: string) => `reset-spec/${tenantId}/${kind}/${randomUUID()}.pdf`;
    const storagePaths: string[] = [];
    const refs: string[] = [];

    const [paris] = await q(
      `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Fromage Paris', 'FR', 'Paris') RETURNING id`, [tenantId]);
    const [lyon] = await q(
      `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Fromage Lyon', 'FR', 'Lyon') RETURNING id`, [tenantId]);
    const [it] = await q(
      `INSERT INTO departments (tenant_id, company_id, name) VALUES ($1, $2, 'IT') RETURNING id`, [tenantId, paris.id]);
    await q(`INSERT INTO departments (tenant_id, company_id, name) VALUES ($1, $2, 'Finance')`, [tenantId, lyon.id]);
    if (opts.realUserId) {
      await q(`UPDATE users SET company_id = $2, department_id = $3 WHERE id = $1`, [opts.realUserId, paris.id, it.id]);
    }

    const [memberRole] = await q(`SELECT id FROM roles WHERE role_name = 'Portfolio Member'`);
    const [tasksRole] = await q(`SELECT id FROM roles WHERE role_name = 'Tasks Member'`);
    const demoUserIds: string[] = [];
    for (const name of ['claire.dupont', 'marc.leroy', 'ines.martin']) {
      const [user] = await q(
        `INSERT INTO users (tenant_id, email, role_id, status, first_name, last_name, company_id, department_id)
         VALUES ($1, $2, $3, 'enabled', $4, $5, $6, $7) RETURNING id`,
        [tenantId, `${name}@fromage-co.example`, memberRole.id, name.split('.')[0], name.split('.')[1], paris.id, it.id],
      );
      demoUserIds.push(user.id);
      await q(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true)`, [tenantId, user.id, memberRole.id]);
      await q(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, false)`, [tenantId, user.id, tasksRole.id]);
      await q(`INSERT INTO user_notification_preferences (tenant_id, user_id) VALUES ($1, $2)`, [tenantId, user.id]);
      await q(`INSERT INTO user_dashboard_config (tenant_id, user_id) VALUES ($1, $2)`, [tenantId, user.id]);
    }
    const [claire] = demoUserIds;
    await q(`INSERT INTO user_page_roles (tenant_id, user_id, resource, level) VALUES ($1, $2, 'tasks', 'member')`, [tenantId, claire]);
    await q(`INSERT INTO refresh_tokens (tenant_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 day')`,
      [tenantId, claire, randomBytes(16).toString('hex')]);
    await q(`INSERT INTO password_reset_tokens (tenant_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 day')`,
      [tenantId, claire, randomBytes(16).toString('hex')]);
    await q(
      `INSERT INTO ai_api_keys (tenant_id, user_id, created_by_user_id, key_hash, key_prefix, label) VALUES ($1, $2, $2, $3, 'kdemo', 'Demo key')`,
      [tenantId, claire, randomBytes(16).toString('hex')]);

    const [supplier] = await q(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Affineur SA') RETURNING id`, [tenantId]);
    const [contract] = await q(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, 'Cave maintenance', $2, $3, '2026-01-01') RETURNING id`,
      [tenantId, paris.id, supplier.id]);

    const applicationIds: string[] = [];
    for (const name of ['Cave ERP', 'Affinage MES']) {
      const [app] = await q(`INSERT INTO applications (tenant_id, name) VALUES ($1, $2) RETURNING id, sequential_id`, [tenantId, name]);
      applicationIds.push(app.id);
      refs.push(app.sequential_id);
    }
    await q(`INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`,
      [tenantId, applicationIds[0], claire]);
    const instanceIds: string[] = [];
    for (const applicationId of applicationIds) {
      const [instance] = await q(
        `INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, 'prod') RETURNING id`, [tenantId, applicationId]);
      instanceIds.push(instance.id);
    }
    const [iface] = await q(
      `INSERT INTO interfaces (tenant_id, name, business_purpose, source_application_id, target_application_id, data_category, integration_route_type)
       VALUES ($1, 'Stock sync', 'Stock levels', $2, $3, 'master_data', 'direct') RETURNING id, interface_reference`,
      [tenantId, applicationIds[0], applicationIds[1]]);
    refs.push(iface.interface_reference);
    const [leg] = await q(
      `INSERT INTO interface_legs (tenant_id, interface_id, leg_type, from_role, to_role, trigger_type, integration_pattern, data_format, order_index)
       VALUES ($1, $2, 'direct', 'source', 'target', 'scheduled', 'batch', 'csv', 1) RETURNING id`,
      [tenantId, iface.id]);
    await q(
      `INSERT INTO interface_bindings (tenant_id, interface_id, interface_leg_id, environment, source_instance_id, target_instance_id)
       VALUES ($1, $2, $3, 'prod', $4, $5)`,
      [tenantId, iface.id, leg.id, instanceIds[0], instanceIds[1]]);
    const [connection] = await q(
      `INSERT INTO connections (tenant_id, name, topology) VALUES ($1, 'Cave link', 'server_to_server') RETURNING id, connection_reference`,
      [tenantId]);
    refs.push(connection.connection_reference);
    await q(`INSERT INTO connection_legs (tenant_id, connection_id, order_index) VALUES ($1, $2, 1)`, [tenantId, connection.id]);

    const spendNumber = await allocateItemNumbers('spend', tenantId, 1, manager);
    refs.push(`OPEX-${spendNumber}`);
    const [spend] = await q(
      `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, supplier_id)
       VALUES ($1, 'ERP licences', 'EUR', '2026-01-01', $2, $3) RETURNING id`,
      [tenantId, spendNumber, supplier.id]);
    const [version] = await q(
      `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, as_of_date, budget_year) VALUES ($1, $2, 'Budget', '2026-01-01', 2026) RETURNING id`,
      [tenantId, spend.id]);
    await q(`INSERT INTO spend_amounts (tenant_id, version_id, period, planned) VALUES ($1, $2, '2026-01-01', 1000), ($1, $2, '2026-02-01', 1500)`,
      [tenantId, version.id]);
    await q(`INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES ($1, $2, $3)`, [tenantId, contract.id, spend.id]);
    const spendPath = path('spend');
    await q(
      `INSERT INTO spend_attachments (tenant_id, spend_item_id, original_filename, stored_filename, size, storage_path)
       VALUES ($1, $2, 'invoice.pdf', 'invoice.pdf', 10, $3)`,
      [tenantId, spend.id, spendPath]);
    storagePaths.push(spendPath);

    const firstTask = await allocateItemNumbers('task', tenantId, 2, manager);
    const taskIds: string[] = [];
    for (const [index, title] of ['Renew cave licences', 'Check humidity sensors'].entries()) {
      const [task] = await q(
        `INSERT INTO tasks (tenant_id, title, item_number, assignee_user_id, creator_id) VALUES ($1, $2, $3, $4, $4) RETURNING id`,
        [tenantId, title, firstTask + index, claire]);
      taskIds.push(task.id);
      refs.push(`T-${firstTask + index}`);
    }
    const taskPath = path('task');
    await q(
      `INSERT INTO task_attachments (tenant_id, task_id, original_filename, stored_filename, size, storage_path)
       VALUES ($1, $2, 'sensor.pdf', 'sensor.pdf', 10, $3)`,
      [tenantId, taskIds[0], taskPath]);
    storagePaths.push(taskPath);

    const projectNumber = await allocateItemNumbers('project', tenantId, 1, manager);
    await q(`INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES ($1, 'New cave', $2)`, [tenantId, projectNumber]);
    refs.push(`PRJ-${projectNumber}`);

    const [library] = await q(`SELECT id FROM document_libraries WHERE slug = 'documents'`);
    const documentNumber = await allocateItemNumbers('document', tenantId, 1, manager);
    const [document] = await q(
      `INSERT INTO documents (tenant_id, item_number, title, content_markdown, library_id, created_by)
       VALUES ($1, $2, 'Cave procedures', 'Keep it cool.', $3, $4) RETURNING id`,
      [tenantId, documentNumber, library.id, claire]);
    refs.push(`DOC-${documentNumber}`);
    const documentPath = path('document');
    await q(
      `INSERT INTO document_attachments (tenant_id, document_id, original_filename, stored_filename, size, storage_path, uploaded_by_id)
       VALUES ($1, $2, 'procedure.pdf', 'procedure.pdf', 10, $3, $4)`,
      [tenantId, document.id, documentPath, claire]);
    storagePaths.push(documentPath);

    await q(
      `INSERT INTO audit_log (tenant_id, table_name, record_id, action, user_id, after_json)
       VALUES ($1, 'tasks', $2, 'create', $3, '{"title":"Renew cave licences"}'::jsonb),
              ($1, 'documents', $4, 'create', $3, '{"title":"Cave procedures"}'::jsonb)`,
      [tenantId, taskIds[0], claire, document.id]);

    const [conversation] = await q(`INSERT INTO ai_conversations (tenant_id, user_id, title) VALUES ($1, $2, 'Cave questions') RETURNING id`,
      [tenantId, claire]);
    await q(
      `INSERT INTO ai_messages (tenant_id, conversation_id, role, content, user_id)
       VALUES ($1, $2, 'user', 'Which caves are humid?', $3), ($1, $2, 'assistant', 'Cave 2.', NULL)`,
      [tenantId, conversation.id, claire]);

    return { refs, storagePaths, demoUserIds };
  });
}

/** Rows of the tenant in every tenant-scoped table, read under the tenant's RLS context. */
export async function countTenantRows(tenantId: string): Promise<Record<string, number>> {
  const sql = TENANT_SCOPED_TABLES
    .map((table) => `SELECT '${table}' AS t, count(*)::int AS n FROM ${table} WHERE tenant_id = $1`)
    .join(' UNION ALL ');
  const rows: Array<{ t: string; n: number }> = await inTenant(tenantId, (manager) => manager.query(sql, [tenantId]));
  return Object.fromEntries(rows.map((row) => [row.t, row.n]));
}

/** Tables whose counts differ, as `table: a vs b`. */
export function countDifferences(a: Record<string, number>, b: Record<string, number>, skip: string[] = []): string[] {
  return Object.keys(a)
    .filter((table) => !skip.includes(table) && a[table] !== b[table])
    .map((table) => `${table}: ${a[table]} vs ${b[table]}`);
}

const VOLATILE_COLUMN = /^(id|tenant_id)$|_id$|_at$|_by$|^search_vector$/;

function normalizeRow(row: Record<string, unknown>): string {
  const kept = Object.entries(row).filter(([key]) => !VOLATILE_COLUMN.test(key));
  return JSON.stringify(Object.fromEntries(kept.sort(([a], [b]) => a.localeCompare(b))));
}

/**
 * The starting state of a tenant without ids or timestamps: roles and permissions, analytics
 * dimension, task and employment types, document libraries, folders, types and templates with
 * their numbers, charts of accounts and accounts, companies, calendars, item sequences.
 */
export async function baselineSnapshot(tenantId: string): Promise<Record<string, string[]>> {
  const queries: Record<string, string> = {
    roles: `SELECT * FROM roles WHERE tenant_id = $1`,
    role_permissions: `SELECT r.role_name, rp.resource, rp.level FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE rp.tenant_id = $1`,
    analytics_axes: `SELECT * FROM analytics_axes WHERE tenant_id = $1`,
    portfolio_task_types: `SELECT * FROM portfolio_task_types WHERE tenant_id = $1`,
    portfolio_employment_types: `SELECT * FROM portfolio_employment_types WHERE tenant_id = $1`,
    document_libraries: `SELECT * FROM document_libraries WHERE tenant_id = $1`,
    document_folders: `SELECT f.*, l.slug AS library_slug FROM document_folders f JOIN document_libraries l ON l.id = f.library_id WHERE f.tenant_id = $1`,
    document_types: `SELECT * FROM document_types WHERE tenant_id = $1`,
    documents: `SELECT d.*, l.slug AS library_slug, t.name AS type_name FROM documents d
                JOIN document_libraries l ON l.id = d.library_id LEFT JOIN document_types t ON t.id = d.document_type_id
                WHERE d.tenant_id = $1`,
    integrated_document_slot_settings: `SELECT s.*, d.item_number AS template_item_number FROM integrated_document_slot_settings s
                LEFT JOIN documents d ON d.id = s.template_document_id WHERE s.tenant_id = $1`,
    chart_of_accounts: `SELECT * FROM chart_of_accounts WHERE tenant_id = $1`,
    accounts: `SELECT a.*, c.code AS coa_code FROM accounts a LEFT JOIN chart_of_accounts c ON c.id = a.coa_id WHERE a.tenant_id = $1`,
    companies: `SELECT co.*, c.code AS coa_code FROM companies co LEFT JOIN chart_of_accounts c ON c.id = co.coa_id WHERE co.tenant_id = $1`,
    working_day_profiles: `SELECT * FROM working_day_profiles WHERE tenant_id = $1`,
    item_sequences: `SELECT * FROM item_sequences WHERE tenant_id = $1`,
  };
  return inTenant(tenantId, async (manager) => {
    const snapshot: Record<string, string[]> = {};
    for (const [name, sql] of Object.entries(queries)) {
      const rows: Array<Record<string, unknown>> = await manager.query(sql, [tenantId]);
      snapshot[name] = rows.map(normalizeRow).sort();
    }
    return snapshot;
  });
}

/** Removes committed spec tenants: every tenant table in purge order, the sign-up, the tenant row. */
export async function cleanupTenants(tenantIds: Array<string | undefined>) {
  for (const tenantId of tenantIds) {
    if (!tenantId) continue;
    const [tenant] = await dataSource.query(`SELECT slug FROM tenants WHERE id = $1`, [tenantId]);
    await inTenant(tenantId, (manager) => purgeTenantTables(manager, TENANT_PURGE_TABLES));
    await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    if (tenant?.slug) {
      const originalSlug = String(tenant.slug).replace(/^deleted-(.*)-\d+$/, '$1');
      await dataSource.query(`DELETE FROM trial_signups WHERE slug = $1 OR slug = $2`, [tenant.slug, originalSlug]);
    }
  }
}

/** Runs a call that must be refused; returns the error. */
export async function refusal(run: () => Promise<unknown>): Promise<any> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  assert.fail('the call should have been refused');
}

export async function runSpecs(name: string, tests: Array<() => Promise<void>>) {
  await dataSource.initialize();
  const failures: string[] = [];
  const template = await ensureDefaultCoaTemplate();
  try {
    for (const test of tests) {
      try {
        await test();
      } catch (err) {
        console.error(`${test.name}:`, err);
        failures.push(`${test.name}: ${(err as Error).message.split('\n')[0]}`);
      }
    }
  } finally {
    await removeCoaTemplate(template).catch(() => undefined);
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`${name}: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log(`${name}: ok`);
}
