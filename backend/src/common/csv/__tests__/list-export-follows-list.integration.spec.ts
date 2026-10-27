import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../../data-source';
import { CsvExportService } from '../csv-export.service';
import { CsvImportService } from '../csv-import.service';
import { CsvJsonValidators } from '../csv-json-validators';
import { CsvResolverService } from '../csv-resolver.service';
import { exportListQuery } from '../../pagination';
import { inRolledBackTransaction, seedTenant } from '../../../spend/__tests__/round-inputs.fixtures';
import { PortfolioProject } from '../../../portfolio/portfolio-project.entity';
import { PortfolioRequest } from '../../../portfolio/portfolio-request.entity';
import { PortfolioProjectsListService } from '../../../portfolio/services/portfolio-projects-list.service';
import { PortfolioRequestsService } from '../../../portfolio/portfolio-requests.service';
import { PortfolioProjectsCsvService } from '../../../portfolio/portfolio-projects-csv.service';
import { PortfolioRequestsCsvService } from '../../../portfolio/portfolio-requests-csv.service';
import { TasksService } from '../../../spend/tasks.service';
import { TasksCsvService } from '../../../tasks/tasks-csv.service';
import { Task } from '../../../tasks/task.entity';
import { Application } from '../../../applications/application.entity';
import { ApplicationsListService } from '../../../applications/services/applications-list.service';
import { ApplicationsCsvService } from '../../../applications/applications-csv.service';
import { Asset } from '../../../assets/asset.entity';
import { AssetsListService } from '../../../assets/services/assets-list.service';
import { AssetsCsvService } from '../../../assets/assets-csv.service';

// The list exports follow the screen (Excel export, lot 3): with a column filter, a quick search and a
// sort active, the rows of the export (their ids, in order) are the rows of the list route for the
// same query, every page. Projects, requests and tasks read the list's ids (`rows=list`, the
// dialog's request: `exportListQuery` then `listIds`); applications and assets read them through their
// own list query. Incidents: incident-review-csv.integration.spec.ts compares its export with its list.

const engine = new CsvExportService(new CsvResolverService());
const importer = new CsvImportService(new CsvResolverService(), new CsvJsonValidators());
const settings = {
  applicationCategories: [], lifecycleStates: [], businessCriticalityLevels: [], cyberCriticalityLevels: [],
  recoveryWaves: [], dataClasses: [], accessMethods: [], serverKinds: [], domains: [], adminZones: [], ipAddressTypes: [],
};
const itOps = { getSettings: async () => settings, getSettingsForWrite: async () => settings } as any;

/** The `id` column of an export, in order. */
function idsOf(content: string): string[] {
  const [header, ...lines] = content.replace(/^﻿/, '').trim().split(/\r?\n/);
  assert.equal(header, 'id');
  return lines;
}

/** What the screen sends for its list, and the export dialog the same with `rows=list`. */
const screenQuery = (filters: Record<string, unknown>, q: string, sort: string) => ({ filters: JSON.stringify(filters), q, sort });
const dialogQuery = (query: Record<string, unknown>) => exportListQuery({ ...query, rows: 'list', scope: 'data', language: 'fr', format: 'xlsx' })!;

async function seed(runner: QueryRunner, tenantId: string) {
  const at = (minutes: number) => new Date(Date.UTC(2026, 9, 1, 8, minutes)).toISOString();
  const names = ['Alpha one', 'alpha two', 'Beta Alpha', 'Gamma', 'Alpha closed', 'Alpha twin', 'Alpha twin'];
  const statuses = ['in_progress', 'waiting_list', 'in_progress', 'in_progress', 'done', 'waiting_list', 'waiting_list'];
  for (const [index, name] of names.entries()) {
    // The twins share their name and creation time: the id breaks the tie, on the list and in the file.
    const created = at(index >= 5 ? 50 : index);
    await runner.query(
      `INSERT INTO portfolio_projects (id, tenant_id, name, item_number, status, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), tenantId, name, index + 1, statuses[index], created],
    );
    await runner.query(
      `INSERT INTO portfolio_requests (id, tenant_id, name, item_number, status, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), tenantId, name, index + 1, statuses[index] === 'done' ? 'converted' : statuses[index], created],
    );
    await runner.query(
      `INSERT INTO tasks (id, tenant_id, title, item_number, status, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), tenantId, name, index + 1, statuses[index] === 'done' ? 'done' : statuses[index] === 'waiting_list' ? 'open' : 'in_progress', created],
    );
    await runner.query(
      `INSERT INTO applications (id, tenant_id, name, created_at) VALUES ($1, $2, $3, $4)`,
      [randomUUID(), tenantId, `${name} ${index}`, created],
    );
    await runner.query(
      `INSERT INTO assets (id, tenant_id, name, kind, environment, created_at) VALUES ($1, $2, $3, 'physical_server', 'prod', $4)`,
      [randomUUID(), tenantId, `${name} ${index}`, created],
    );
  }
}

async function run() {
  await dataSource.initialize();
  try {
    await inRolledBackTransaction(async (runner) => {
      const tenantId = await seedTenant(runner, 'list-export');
      await seed(runner, tenantId);
      const manager = runner.manager;
      const opts = { manager, tenantId };
      const checked: string[] = [];
      const compare = (list: string, listIds: string[], exported: string[]) => {
        assert.ok(listIds.length >= 2, `${list}: the query keeps several rows (${listIds.length})`);
        assert.deepEqual(exported, listIds, `${list}: the export holds the list's rows, in its order`);
        checked.push(`${list} (${listIds.length})`);
      };

      // Projects: the list route's service, then the export route's path (listIds of the dialog's query).
      const projectsList = new PortfolioProjectsListService(manager.getRepository(PortfolioProject));
      const projectsCsv = new PortfolioProjectsCsvService(manager.getRepository(PortfolioProject), engine, importer, null as any);
      for (const sort of ['name:DESC', 'created_at:ASC']) {
        const query = screenQuery({ status: { filterType: 'set', values: ['in_progress', 'waiting_list'] } }, 'alpha', sort);
        const page = await projectsList.list({ ...query, page: 1, limit: 2 }, opts);
        const all = await projectsList.list({ ...query, page: 1, limit: 100 }, opts);
        assert.ok(page.items.length < all.items.length, 'projects: the screen shows a first page only');
        const { ids } = await projectsList.listIds({ ...dialogQuery(query), __export: true }, opts);
        const file = await projectsCsv.export({ ...opts, language: 'fr', fields: ['id'], ids });
        compare(`projects ${sort}`, all.items.map((item: any) => item.id), idsOf(file.content));
      }

      const requestsService = Object.assign(Object.create(PortfolioRequestsService.prototype), { repo: manager.getRepository(PortfolioRequest) }) as PortfolioRequestsService;
      const requestsCsv = new PortfolioRequestsCsvService(manager.getRepository(PortfolioRequest), engine, importer, null as any);
      for (const sort of ['name:ASC', 'created_at:DESC']) {
        const query = screenQuery({ status: { filterType: 'set', values: ['in_progress', 'waiting_list'] } }, 'alpha', sort);
        const all = await requestsService.list({ ...query, page: 1, limit: 100 }, opts);
        const { ids } = await requestsService.listIds({ ...dialogQuery(query), __export: true }, opts);
        const file = await requestsCsv.export({ ...opts, language: 'fr', fields: ['id'], ids });
        compare(`requests ${sort}`, all.items.map((item: any) => item.id), idsOf(file.content));
      }

      const tasksService = new TasksService(dataSource);
      const tasksCsv = new TasksCsvService(manager.getRepository(Task), engine, importer);
      for (const sort of ['title:DESC', 'created_at:ASC']) {
        const query = screenQuery({ status: { filterType: 'set', values: ['in_progress', 'open'] } }, 'alpha', sort);
        const all = await tasksService.listAllTasks({ ...query, page: 1, limit: 100 }, opts);
        const { ids } = await tasksService.listIds({ ...dialogQuery(query), __export: true }, opts);
        const file = await tasksCsv.export({ ...opts, language: 'fr', fields: ['id'], ids });
        compare(`tasks ${sort}`, all.items.map((item: any) => item.id), idsOf(file.content));
      }

      // Applications and assets: their export reads the list's ids itself, from the query the screen sends.
      const applicationsList = new ApplicationsListService(manager.getRepository(Application));
      const applicationsCsv = new ApplicationsCsvService(
        manager.getRepository(Application), null as any, null as any, engine, importer, new CsvResolverService(), null as any, applicationsList, itOps,
      );
      for (const sort of ['name:DESC', 'created_at:ASC']) {
        const query = screenQuery({ name: { filterType: 'text', type: 'contains', filter: 'a' } }, 'alpha', sort);
        const all = await applicationsList.list({ ...query, page: 1, limit: 100 }, opts);
        const file = await applicationsCsv.export({ ...opts, language: 'fr', fields: ['id'], query });
        compare(`applications ${sort}`, all.items.map((item: any) => item.id), idsOf(file.content));
      }

      const assetsList = new AssetsListService(manager.getRepository(Asset));
      const assetsCsv = new AssetsCsvService(
        manager.getRepository(Asset), engine, importer, itOps, { labelsOf: async () => new Map() } as any, assetsList,
      );
      for (const sort of ['name:DESC', 'created_at:ASC']) {
        const query = screenQuery({ name: { filterType: 'text', type: 'contains', filter: 'a' } }, 'alpha', sort);
        const all = await assetsList.list({ ...query, page: 1, limit: 100 }, { ...opts, language: 'fr' });
        const file = await assetsCsv.export({ ...opts, language: 'fr', fields: ['id'], query });
        compare(`assets ${sort}`, all.items.map((item: any) => item.id), idsOf(file.content));
      }

      console.log(`  export rows = list rows, in order: ${checked.join(', ')}: OK`);
    });
  } finally {
    await dataSource.destroy();
  }
  console.log('list-export-follows-list.integration.spec: all assertions passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
