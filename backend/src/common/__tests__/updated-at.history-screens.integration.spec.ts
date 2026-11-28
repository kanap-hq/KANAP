// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { RecordHistoryService, type RecordHistoryContext } from '../../audit/record-history.service';
import { ContractContactsService } from '../../contracts/contract-contacts.service';
import { SpendAmountsService } from '../../spend/spend-amounts.service';
import { SpendItemsService } from '../../spend/spend-items.service';
import { ApplicationsOwnersService } from '../../applications/services/applications-owners.service';
import { AssetsSupportService } from '../../assets/services/assets-support.service';
import { SupplierContactsService } from '../../suppliers/supplier-contacts.service';
import { SupplierContactRole } from '../../contacts/supplier-contact.entity';
import { PortfolioProjectsCrudService } from '../../portfolio/services/portfolio-projects-crud.service';
import { PortfolioDependenciesService } from '../../portfolio/services/portfolio-dependencies.service';
import { PortfolioRequestsService } from '../../portfolio/portfolio-requests.service';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { TaskTimeEntriesService } from '../../tasks/task-time-entries.service';
import { IncidentRelationsService } from '../../incidents/services/incident-relations.service';
import { LocationsService } from '../../locations/locations.service';
import { AccountsService } from '../../accounts/accounts.service';
import { CompanyMetricsService } from '../../companies/company-metrics.service';
import { DepartmentMetricsService } from '../../departments/department-metrics.service';

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.SETTINGS_ENCRYPTION_SECRET ||= process.env.AI_SETTINGS_ENCRYPTION_SECRET || 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'updated-at-history-screens-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

// The modification date follows the history (audit/record-dating.ts): a child changed through the
// service of its screen writes an entry in the record's history and dates the record; the same
// gesture with nothing to change writes no entry and leaves the date. One transaction, rolled back.

const OLD = '2020-01-02T03:04:05.000Z';
let app: any;
let ds: DataSource;

type Ids = Record<string, string>;

async function seed(r: QueryRunner): Promise<{ tenantId: string; ids: Ids }> {
  const tenantId = randomUUID();
  await r.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Updated at history', 'active', '{}'::jsonb, '{}'::jsonb, now(), now())`,
    [tenantId, `updated-at-history-${tenantId.slice(0, 8)}`],
  );
  await r.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const one = async (sql: string, p: unknown[] = []) => (await r.query(sql, [tenantId, ...p]))[0].id as string;
  const ids: Ids = {};
  ids.role = await one(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Administrator') RETURNING id`);
  ids.user = await one(`INSERT INTO users (tenant_id, email, role_id, status, first_name, last_name) VALUES ($1, 'writer@example.test', $2, 'enabled', 'Wanda', 'Writer') RETURNING id`, [ids.role]);
  ids.other = await one(`INSERT INTO users (tenant_id, email, role_id, status, first_name, last_name) VALUES ($1, 'other@example.test', $2, 'enabled', 'Otto', 'Other') RETURNING id`, [ids.role]);
  ids.contact = await one(`INSERT INTO contacts (tenant_id, email, item_number, first_name, last_name) VALUES ($1, 'contact@example.test', 1, 'Cora', 'Contact') RETURNING id`);
  ids.suppliers = await one(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Supplier') RETURNING id`);
  ids.companies = await one(`INSERT INTO companies (tenant_id, name, country_iso, city, item_number) VALUES ($1, 'Company', 'FR', 'Brest', 1) RETURNING id`);
  ids.departments = await one(`INSERT INTO departments (tenant_id, company_id, name, item_number) VALUES ($1, $2, 'Department', 1) RETURNING id`, [ids.companies]);
  ids.chart = await one(`INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'UPH', 'Chart', 'FR') RETURNING id`);
  ids.accounts = await one(`INSERT INTO accounts (tenant_id, coa_id, account_number, account_name) VALUES ($1, $2, 611000, 'Account') RETURNING id`, [ids.chart]);
  ids.contracts = await one(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, item_number)
     VALUES ($1, 'Contract', $2, $3, '2026-01-01', 1) RETURNING id`,
    [ids.companies, ids.suppliers],
  );
  ids.spend_items = await one(
    `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, nature)
     VALUES ($1, 'Line', 'EUR', '2026-01-01', 1, 'opex') RETURNING id`,
  );
  ids.version = await one(
    `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, as_of_date, budget_year)
     VALUES ($1, $2, 'Budget 2026', '2026-01-01', 2026) RETURNING id`,
    [ids.spend_items],
  );
  ids.applications = await one(`INSERT INTO applications (tenant_id, name) VALUES ($1, 'Application') RETURNING id`);
  ids.assets = await one(`INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, 'Server', 'vm', 'prod') RETURNING id`);
  ids.portfolio_projects = await one(`INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES ($1, 'Project', 1) RETURNING id`);
  ids.project2 = await one(`INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES ($1, 'Project two', 2) RETURNING id`);
  ids.portfolio_requests = await one(`INSERT INTO portfolio_requests (tenant_id, name, item_number, created_by_id) VALUES ($1, 'Request', 1, $2) RETURNING id`, [ids.user]);
  ids.request2 = await one(`INSERT INTO portfolio_requests (tenant_id, name, item_number, created_by_id) VALUES ($1, 'Request two', 2, $2) RETURNING id`, [ids.user]);
  ids.tasks = await one(`INSERT INTO tasks (tenant_id, title, item_number, creator_id) VALUES ($1, 'Task', 1, $2) RETURNING id`, [ids.user]);
  ids.incidents = await one(
    `INSERT INTO incidents (tenant_id, item_number, title, severity, description, created_by, updated_by)
     VALUES ($1, 1, 'Incident', 'minor', 'What happened', $2, $2) RETURNING id`,
    [ids.user],
  );
  ids.locations = await one(`INSERT INTO locations (tenant_id, name, hosting_type, location_reference) VALUES ($1, 'Site', 'on_premise', 'LOC-1') RETURNING id`);
  const library = await one(`INSERT INTO document_libraries (tenant_id, name, slug) VALUES ($1, 'Library', 'library') RETURNING id`);
  ids.documents = await one(
    `INSERT INTO documents (tenant_id, item_number, title, library_id, created_by, updated_by, content_markdown)
     VALUES ($1, 1, 'Document', $2, $3, $3, 'Body') RETURNING id`,
    [library, ids.user],
  );
  return { tenantId, ids };
}

type Case = {
  name: string;
  table: string;
  record: string;
  change: () => Promise<unknown>;
  /** The same gesture, with nothing left to change. */
  same?: () => Promise<unknown>;
  /** A write whose screen keeps no history entry: neither the history nor the date tells it. */
  noHistory?: string;
};

async function main() {
  const { AppModule } = require('../../app.module');
  app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  ds = app.get(DataSource);
  const r = ds.createQueryRunner();
  await r.connect();
  await r.startTransaction();
  const outcome: Record<string, string> = {};
  const expected: Record<string, string> = {};
  try {
    const { tenantId, ids } = await seed(r);
    const manager = r.manager;
    const userId = ids.user;
    const opts = { manager, tenantId, userId } as any;
    const get = <T>(type: new (...args: any[]) => T): T => app.get(type, { strict: false });
    const ctx: RecordHistoryContext = { tenantId, userId, isAdmin: true, permissions: {}, manager } as any;
    const history = new RecordHistoryService();
    const entries = async (table: string, id: string) => {
      try {
        return (await history.list(ctx, table, id, { limit: '100' })).items.length;
      } catch (error: any) {
        throw new Error(`history of ${table} ${id}: ${error?.message ?? error}`);
      }
    };
    const dateOf = async (table: string, id: string) => {
      const [row] = await r.query(`SELECT updated_at = now() AS now, updated_at FROM ${table} WHERE id = $1`, [id]);
      return row.now ? 'now' : new Date(row.updated_at).toISOString() === OLD ? 'old' : new Date(row.updated_at).toISOString();
    };
    const age = (table: string, id: string) => r.query(`UPDATE ${table} SET updated_at = $2 WHERE id = $1`, [id, OLD]);

    const knowledge = get(KnowledgeService);
    const { lock_token: lockToken } = await knowledge.acquireLock(ids.documents, userId, opts);
    const saveDocument = async (contributors: unknown[]) => {
      const [{ revision }] = await r.query(`SELECT revision FROM documents WHERE id = $1`, [ids.documents]);
      await knowledge.update(ids.documents, { title: 'Document', revision: Number(revision), contributors } as any, userId, lockToken, opts);
    };
    const author = [{ user_id: userId, role: 'author', is_primary: true }];
    await saveDocument(author);

    const cases: Case[] = [
      {
        name: 'contract: a contact added',
        table: 'contracts', record: ids.contracts,
        change: () => get(ContractContactsService).attachManual(ids.contracts, { contactId: ids.contact, role: SupplierContactRole.COMMERCIAL }, userId, { manager, tenantId }),
        same: () => get(ContractContactsService).syncFromSupplierForItem(ids.contracts, userId, { manager, tenantId }),
      },
      {
        name: 'budget line: an amount',
        table: 'spend_items', record: ids.spend_items,
        change: () => get(SpendAmountsService).bulkUpsert(ids.version, { kind: 'annual', year: 2026, totals: { planned: 1200 } }, userId, { manager }),
        same: () => get(SpendAmountsService).bulkUpsert(ids.version, { kind: 'annual', year: 2026, totals: { planned: 1200 } }, userId, { manager }),
      },
      {
        name: 'budget line: a field',
        table: 'spend_items', record: ids.spend_items,
        change: () => get(SpendItemsService).update(ids.spend_items, { description: 'Described' } as any, userId, opts),
        same: () => get(SpendItemsService).update(ids.spend_items, { description: 'Described' } as any, userId, opts),
      },
      {
        name: 'application: an owner',
        table: 'applications', record: ids.applications,
        change: () => get(ApplicationsOwnersService).bulkReplaceOwners(ids.applications, [{ user_id: ids.other, owner_type: 'business' }], userId, opts),
        same: () => get(ApplicationsOwnersService).bulkReplaceOwners(ids.applications, [{ user_id: ids.other, owner_type: 'business' }], userId, opts),
      },
      {
        name: 'asset: a support contact',
        table: 'assets', record: ids.assets,
        change: () => get(AssetsSupportService).bulkReplaceSupportContacts(ids.assets, [{ contact_id: ids.contact, role: 'support' }], tenantId, userId, opts),
        same: () => get(AssetsSupportService).bulkReplaceSupportContacts(ids.assets, [{ contact_id: ids.contact, role: 'support' }], tenantId, userId, opts),
      },
      {
        name: 'supplier: a contact',
        table: 'suppliers', record: ids.suppliers,
        change: () => get(SupplierContactsService).attach(ids.suppliers, { contactId: ids.contact, role: SupplierContactRole.TECHNICAL }, { manager, tenantId, userId }),
      },
      {
        name: 'project: a team member',
        table: 'portfolio_projects', record: ids.portfolio_projects,
        change: () => get(PortfolioProjectsCrudService).bulkReplaceTeam(ids.portfolio_projects, 'it_team', [ids.other], opts),
        same: () => get(PortfolioProjectsCrudService).bulkReplaceTeam(ids.portfolio_projects, 'it_team', [ids.other], opts),
      },
      {
        name: 'project: a dependency',
        table: 'portfolio_projects', record: ids.portfolio_projects,
        change: () => get(PortfolioDependenciesService).addDependency(ids.portfolio_projects, 'project', ids.project2, tenantId, opts),
      },
      {
        name: 'request: a team member',
        table: 'portfolio_requests', record: ids.portfolio_requests,
        change: () => get(PortfolioRequestsService).bulkReplaceTeam(ids.portfolio_requests, 'it_team', [ids.other], opts),
        same: () => get(PortfolioRequestsService).bulkReplaceTeam(ids.portfolio_requests, 'it_team', [ids.other], opts),
      },
      {
        name: 'request: a dependency',
        table: 'portfolio_requests', record: ids.portfolio_requests,
        change: () => get(PortfolioRequestsService).addDependency(ids.portfolio_requests, 'request', ids.request2, tenantId, opts),
      },
      {
        name: 'task: a time entry',
        table: 'tasks', record: ids.tasks,
        change: () => get(TaskTimeEntriesService).create(ids.tasks, { hours: 2, logged_at: new Date('2026-03-02'), user_id: userId }, userId, true, { manager }),
      },
      {
        name: 'incident: an asset',
        table: 'incidents', record: ids.incidents,
        change: () => get(IncidentRelationsService).setLink('assets', ids.incidents, ids.assets, true, userId, opts),
        same: () => get(IncidentRelationsService).setLink('assets', ids.incidents, ids.assets, true, userId, opts),
      },
      {
        name: 'location: a sub-item',
        table: 'locations', record: ids.locations,
        change: () => get(LocationsService).createSubItem(ids.locations, { name: 'Rack' }, tenantId, userId, { manager }),
      },
      {
        name: 'account: a field',
        table: 'accounts', record: ids.accounts,
        change: () => get(AccountsService).update(ids.accounts, { account_name: 'Account renamed' } as any, userId, { manager }),
        same: () => get(AccountsService).update(ids.accounts, { account_name: 'Account renamed' } as any, userId, { manager }),
      },
      {
        name: 'company: its headcount',
        table: 'companies', record: ids.companies,
        change: () => get(CompanyMetricsService).upsertForCompany(ids.companies, 2026, { headcount: 12 }, userId, { manager }),
        same: () => get(CompanyMetricsService).upsertForCompany(ids.companies, 2026, { headcount: 12 }, userId, { manager }),
      },
      {
        name: 'department: its headcount',
        table: 'departments', record: ids.departments,
        change: () => get(DepartmentMetricsService).upsertForDepartment(ids.departments, 2026, { headcount: 4 }, userId, { manager }),
        same: () => get(DepartmentMetricsService).upsertForDepartment(ids.departments, 2026, { headcount: 4 }, userId, { manager }),
      },
    ];

    for (const c of cases) {
      const run = async (gesture: () => Promise<unknown>) => {
        await r.query('SAVEPOINT gesture');
        await age(c.table, c.record);
        const before = await entries(c.table, c.record);
        try {
          await gesture();
        } catch (error: any) {
          await r.query('ROLLBACK TO SAVEPOINT gesture');
          return `failed: ${error?.message ?? error}`;
        }
        const added = (await entries(c.table, c.record)) - before;
        return `${added > 0 ? 'entry' : 'no entry'}, ${await dateOf(c.table, c.record)}`;
      };
      outcome[`${c.name}, changed`] = await run(c.change);
      expected[`${c.name}, changed`] = c.noHistory ? 'no entry, old' : 'entry, now';
      if (c.same) {
        outcome[`${c.name}, unchanged`] = await run(c.same);
        expected[`${c.name}, unchanged`] = 'no entry, old';
      }
    }

    // A document's contributors write no history entry: the service dates the document itself
    // (touchUpdatedAt), the change the date tells and the history does not.
    await age('documents', ids.documents);
    await saveDocument([...author, { user_id: ids.other, role: 'reviewer' }]);
    outcome['document: a contributor (no history entry), changed'] = await dateOf('documents', ids.documents);
    expected['document: a contributor (no history entry), changed'] = 'now';
  } finally {
    await r.rollbackTransaction().catch(() => undefined);
    await r.release();
    await app.close();
  }
  console.log(Object.entries(outcome).map(([name, result]) => `  ${name}: ${result}`).join('\n'));
  assert.deepEqual(outcome, expected, 'a child changed through its screen writes an entry and dates the record; the same gesture unchanged does neither');
  console.log('ok - the modification date follows the history, family by family');
}

void main().then(() => process.exit(0), (error) => {
  console.error(error);
  process.exit(1);
});
