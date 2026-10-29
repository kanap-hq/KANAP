import { randomUUID } from 'node:crypto';
import { EntityManager, QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { ApplicationsInstancesService } from '../services/applications-instances.service';
import { ApplicationsRelationsService, type RelationsAccess, type RelationsContext, type RelationsWrites } from '../services/applications-relations.service';
import { PortfolioRequestsService } from '../../portfolio/portfolio-requests.service';
import { TechnologyLinksService } from '../../technologies/technology-links.service';
import { TechnologyReachService } from '../../technologies/technology-reach.service';
import { IncidentRelationsService } from '../../incidents/services/incident-relations.service';
import { CAPEX_NUMBER_OFFSET } from '../../spend/__tests__/round-inputs.fixtures';

// Fixtures of the Relations tab specs (lot R1): a tenant built in raw SQL, with every kind of
// object the tab shows, linked and not linked, and the service wired with stubs where a
// dependency is out of the specs' reach (FX rates, interfaces, documents, tasks, IT Ops settings).

export const YEAR = new Date().getUTCFullYear();

export type AuditEntry = { table: string; recordId?: string | null; before?: unknown; after?: unknown };

export type TaskReplaceCall = { applicationId: string; taskIds: string[]; scoped: boolean };

/**
 * `cpeEvents` collects the technologies whose links changed (`TechnologyCpeEvents`); `failAuditOn`
 * makes the audit of that table throw, to stop a write half-way.
 */
export function relationsService(opts: { audit?: AuditEntry[]; taskCalls?: TaskReplaceCall[]; cpeEvents?: string[]; failAuditOn?: string } = {}) {
  const audit = {
    log: async (entry: AuditEntry) => {
      if (opts.failAuditOn && entry.table === opts.failAuditOn) throw new Error(`audit of ${entry.table} failed`);
      opts.audit?.push(entry);
    },
  };
  const cpeEvents = { emit: async (event: { technologyId: string }) => void opts.cpeEvents?.push(event.technologyId) };
  const instances = new ApplicationsInstancesService(undefined as any, undefined as any, audit as any);
  // Identity rates: the amounts stay in EUR, the reporting currency of a tenant without settings.
  const fxRates = {
    resolveRates: async () => ({ map: new Map(), settings: { reportingCurrency: 'EUR' } }),
    convertValue: (amount: number, rate: number) => amount * rate,
  };
  // An interface bound in two environments is listed twice and counted once.
  const interfaces = { listByApplication: async () => ({ items: [{ id: 'if-1' }, { id: 'if-1' }, { id: 'if-2' }] }) };
  const knowledge = { listDocumentsForEntity: async () => ({ access: 'granted', total: 3, items: [] }) };
  const tasks = {
    bulkReplaceTasksForApplication: async (applicationId: string, taskIds: string[], o: any) => {
      opts.taskCalls?.push({ applicationId, taskIds: [...taskIds].sort(), scoped: !!o?.accessScope });
      return { task_ids: taskIds };
    },
  };
  // The request side writes through its own service: only its manager-bound methods run here. Its
  // own audit row of the link set (the request's history) goes to a sink: the application's rows are under test.
  const requests = new PortfolioRequestsService(
    undefined as any, { log: async () => undefined } as any, undefined as any, undefined as any, undefined as any,
    undefined as any, undefined as any, undefined as any, undefined as any,
  );
  // The technology layer is the real service (lot T2a): its reach, idempotence and audit are under test.
  const technologyLinks = new TechnologyLinksService(audit as any, new TechnologyReachService(), { getSettings: async () => ({}) } as any, cpeEvents as any);
  // The incident side is the real service (lot R1b): its visibility, open state, row lock and journal are under test.
  const incidents = new IncidentRelationsService(undefined as any, audit as any);
  return new ApplicationsRelationsService(
    undefined as any, instances, fxRates as any, interfaces as any, knowledge as any, tasks as any, requests, technologyLinks, incidents, audit as any,
  );
}

export const ALL_ACCESS: RelationsAccess = {
  budget_lines: true, contracts: true, incidents: true, processes: true, projects: true, requests: true, tasks: true, technologies: true,
};
export const NO_ACCESS: RelationsAccess = {
  budget_lines: false, contracts: false, incidents: false, processes: false, projects: false, requests: false, tasks: false, technologies: false,
};
export const ALL_WRITES: RelationsWrites = { technologies: true, processes: true, incidents: true };

export function context(manager: EntityManager, seed: RelationsSeed, overrides: Partial<RelationsContext> = {}): RelationsContext {
  return {
    manager, tenantId: seed.tenantId, userId: seed.userId, access: ALL_ACCESS, writes: ALL_WRITES, scopes: {},
    incidentViewer: { userId: seed.userId, isAdmin: true }, ...overrides,
  };
}

export async function setTenant(runner: QueryRunner | EntityManager, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

export async function inRolledBackTransaction(fn: (runner: QueryRunner) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await fn(runner);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

export type RelationsSeed = {
  tenantId: string;
  userId: string;
  otherUserId: string;
  appId: string;
  supplierId: string;
  lines: { linked: string; noVersion: string; sameSupplier: string; viaContract: string; viaProject: string; disabledSameSupplier: string };
  contracts: { linked: string; sameSupplier: string; disabled: string };
  projects: { linked: string; carrier: string; other: string };
  requests: { linked: string; hidden: string; free: string };
  tasks: { linked: string; carried: string; ofLinkedProject: string; done: string };
  taskNumbers: { carried: number };
};

/**
 * One tenant (the session is left on it) whose application APP has a supplier and:
 * - lines: `linked` (OPEX, the supplier, a version this year with 100 + 50 planned and 999
 *   committed, the tenant's default column, and one last year), `noVersion` (CAPEX, linked, no
 *   version), `sameSupplier` (not linked: A2), `viaContract` (of the linked contract: A3),
 *   `viaProject` (of the linked project: A3), `disabledSameSupplier` (disabled: never suggested);
 * - contracts: `linked` (the supplier), `sameSupplier` (A1), `disabled` (never suggested);
 * - projects: `linked` (led by `userId`), `carrier` (carries the linked task `carried`: A4),
 *   `other`;
 * - requests: `linked` (requested by `userId`), `hidden` (linked, someone else's), `free`;
 * - tasks: `linked` (assigned to `userId`, of the linked project), `carried` (linked, of the
 *   carrier project, someone else's), `done` (linked, done), `ofLinkedProject` (of the linked
 *   project, not linked to the application: never shown);
 * - one deployment with two assets.
 */
export async function seedRelations(runner: QueryRunner, tag: string): Promise<RelationsSeed> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"budget_columns":{"default_column":"committed"}}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `rel-${tag}-${tenantId.slice(0, 8)}`, `Relations ${tag}`],
  );
  await setTenant(runner, tenantId);
  const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;

  const roleId = await one(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2) RETURNING id`, [tenantId, `Relations role ${tag}`]);
  const user = (email: string, first: string, last: string) =>
    one(`INSERT INTO users (tenant_id, email, role_id, first_name, last_name) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [tenantId, email, roleId, first, last]);
  const userId = await user(`rel-${tag}-${tenantId.slice(0, 8)}@example.test`, 'Claire', 'Dubois');
  const otherUserId = await user(`rel-${tag}-other-${tenantId.slice(0, 8)}@example.test`, 'Marc', 'Petit');

  const supplier = (name: string) => one(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, name]);
  const supplierId = await supplier(`Talend ${tag}`);
  const otherSupplierId = await supplier(`Dell ${tag}`);
  const companyId = await one(
    `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, $2, 'FR', 'Lyon') RETURNING id`,
    [tenantId, `Relations company ${tag}`],
  );
  const appId = await one(`INSERT INTO applications (tenant_id, name, supplier_id) VALUES ($1, $2, $3) RETURNING id`, [tenantId, `Relations app ${tag}`, supplierId]);

  let lineNumber = 0;
  const line = async (name: string, nature: 'opex' | 'capex', supplier: string, status = 'enabled') => {
    lineNumber += 1;
    return nature === 'opex'
      ? one(
        `INSERT INTO spend_items (tenant_id, product_name, supplier_id, currency, effective_start, item_number, status)
         VALUES ($1, $2, $3, 'EUR', '2024-01-01', $4, $5::status_state) RETURNING id`,
        [tenantId, name, supplier, lineNumber, status],
      )
      : one(
        `INSERT INTO spend_items (tenant_id, nature, product_name, supplier_id, ppe_type, investment_type, priority, currency, effective_start, item_number, legacy_number, status)
         VALUES ($1, 'capex', $2, $3, 'hardware', 'replacement', 'medium', 'EUR', '2024-01-01', $4::int + ${CAPEX_NUMBER_OFFSET}, 'CPX-' || $4::int, $5::status_state) RETURNING id`,
        [tenantId, name, supplier, lineNumber, status],
      );
  };
  const lines = {
    linked: await line('Licences Talend', 'opex', supplierId),
    noVersion: await line('Serveurs ETL', 'capex', otherSupplierId),
    sameSupplier: await line('Formation Talend', 'opex', supplierId),
    viaContract: await line('Support contrat', 'capex', otherSupplierId),
    viaProject: await line('Prestations projet', 'opex', otherSupplierId),
    disabledSameSupplier: await line('Ancienne licence', 'opex', supplierId, 'disabled'),
  };
  const version = (lineId: string, year: number) => one(
    `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, budget_year, as_of_date) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, lineId, `Budget ${year}`, year, `${year}-01-01`],
  );
  const amount = (versionId: string, period: string, planned: number, committed: number) => runner.query(
    `INSERT INTO spend_amounts (tenant_id, version_id, period, planned, committed) VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, versionId, period, planned, committed],
  );
  const current = await version(lines.linked, YEAR);
  await amount(current, `${YEAR}-01-01`, 100, 999);
  await amount(current, `${YEAR}-02-01`, 50, 0);
  const previous = await version(lines.linked, YEAR - 1);
  await amount(previous, `${YEAR - 1}-01-01`, 7, 7);

  const contract = (name: string, supplier: string, status = 'enabled') => one(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, duration_months, auto_renewal, yearly_amount_at_signature, currency, status)
     VALUES ($1, $2, $3, $4, DATE '2024-06-01', 36, true, 36000, 'EUR', $5::status_state) RETURNING id`,
    [tenantId, name, companyId, supplier, status],
  );
  const contracts = {
    linked: await contract('Maintenance Talend', supplierId),
    sameSupplier: await contract('Support Talend Premium', supplierId),
    disabled: await contract('Ancien contrat Talend', supplierId, 'disabled'),
  };

  const project = (name: string, itemNumber: number, plannedEnd: string | null, lead: string | null) => one(
    `INSERT INTO portfolio_projects (tenant_id, name, item_number, status, planned_end, it_lead_id) VALUES ($1, $2, $3, 'in_progress', $4, $5) RETURNING id`,
    [tenantId, name, itemNumber, plannedEnd, lead],
  );
  const projects = {
    linked: await project('Migration Talend Cloud', 7, `${YEAR}-11-30`, userId),
    carrier: await project('Refonte du datalake', 9, null, null),
    other: await project('Autre projet', 11, null, null),
  };

  const request = (name: string, itemNumber: number, requestor: string | null) => one(
    `INSERT INTO portfolio_requests (tenant_id, name, item_number, status, target_delivery_date, requestor_id) VALUES ($1, $2, $3, 'approved', $4, $5) RETURNING id`,
    [tenantId, name, itemNumber, `${YEAR + 1}-03-31`, requestor],
  );
  const requests = {
    linked: await request('Connecteur Salesforce', 23, userId),
    hidden: await request('Demande confidentielle', 24, null),
    free: await request('Nouvelle demande', 25, null),
  };

  const task = (title: string, itemNumber: number, projectId: string | null, assignee: string | null, status: string, due: string | null) => one(
    `INSERT INTO tasks (tenant_id, title, item_number, related_object_type, related_object_id, assignee_user_id, status, due_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [tenantId, title, itemNumber, projectId ? 'project' : null, projectId, assignee, status, due],
  );
  const tasks = {
    linked: await task('Mettre à jour le connecteur', 118, projects.linked, userId, 'in_progress', `${YEAR}-10-24`),
    carried: await task('Revue des jobs', 121, projects.carrier, otherUserId, 'open', `${YEAR}-10-09`),
    done: await task('Montée de version', 90, null, otherUserId, 'done', `${YEAR}-01-12`),
    ofLinkedProject: await task('Tâche du projet seulement', 130, projects.linked, userId, 'open', null),
  };

  const link = (table: string, column: string, id: string) => runner.query(
    `INSERT INTO ${table} (tenant_id, application_id, ${column}) VALUES ($1, $2, $3)`,
    [tenantId, appId, id],
  );
  await link('application_spend_items', 'spend_item_id', lines.linked);
  await link('application_spend_items', 'spend_item_id', lines.noVersion);
  await link('application_contracts', 'contract_id', contracts.linked);
  await link('application_projects', 'project_id', projects.linked);
  await link('portfolio_request_applications', 'request_id', requests.linked);
  await link('portfolio_request_applications', 'request_id', requests.hidden);
  await link('task_applications', 'task_id', tasks.linked);
  await link('task_applications', 'task_id', tasks.carried);
  await link('task_applications', 'task_id', tasks.done);
  await runner.query(`INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES ($1, $2, $3)`, [tenantId, contracts.linked, lines.viaContract]);
  await runner.query(`INSERT INTO portfolio_project_opex (tenant_id, project_id, opex_id) VALUES ($1, $2, $3)`, [tenantId, projects.linked, lines.viaProject]);

  const instanceId = await one(`INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, 'prod') RETURNING id`, [tenantId, appId]);
  for (const name of ['srv-etl-1', 'srv-etl-2']) {
    const assetId = await one(`INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, $2, 'vm', 'prod') RETURNING id`, [tenantId, `${name}-${tag}`]);
    await runner.query(`INSERT INTO app_asset_assignments (tenant_id, app_instance_id, asset_id, role) VALUES ($1, $2, $3, 'app')`, [tenantId, instanceId, assetId]);
  }

  return {
    tenantId, userId, otherUserId, appId, supplierId, lines, contracts, projects, requests, tasks,
    taskNumbers: { carried: 121 },
  };
}

export async function runSpecs(name: string, tests: Array<() => Promise<void>>) {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of tests) {
      try {
        await test();
      } catch (err) {
        failures.push(`${test.name}: ${(err as Error).stack?.split('\n').slice(0, 12).join('\n    ')}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) throw new Error(`${name}: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  console.log(`${name}: ok`);
}
