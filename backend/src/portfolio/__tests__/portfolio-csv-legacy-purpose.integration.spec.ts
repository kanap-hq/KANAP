// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { EntityManager, QueryRunner } from 'typeorm';
import { CsvExportService } from '../../common/csv/csv-export.service';
import { CsvImportService } from '../../common/csv/csv-import.service';
import { CsvJsonValidators } from '../../common/csv/csv-json-validators';
import { CsvResolverService } from '../../common/csv/csv-resolver.service';
import type { CsvImportResult } from '../../common/csv';
import dataSource from '../../data-source';
import {
  boundDocuments,
  inRolledBackTransaction,
  managedDocumentServices,
  seedCreationTenant,
} from '../../common/creation/__tests__/creation-cancel.fixtures';
import { PortfolioProjectsCsvService } from '../portfolio-projects-csv.service';
import { PortfolioRequestsCsvService } from '../portfolio-requests-csv.service';

// Lot I6 of 26.11.9, pass G: a project or a request whose purpose (and a request's risks) has no bound
// document yet keeps its text in the table's column the documents replaced (a record older than the
// documents, never opened since, where they are not rolled out automatically). The import reads that
// text as the stored value: a file that leaves the column out, or a blank cell, changes nothing and
// writes nothing, and the screen still shows the text; a filled cell goes to the document; `-` empties
// it and is counted.

type Service = PortfolioProjectsCsvService | PortfolioRequestsCsvService;

function servicesFor(manager: EntityManager) {
  const resolver = new CsvResolverService();
  const exporter = new CsvExportService(resolver);
  const importer = new CsvImportService(resolver, new CsvJsonValidators());
  const documents = managedDocumentServices(manager);
  return {
    documents,
    projects: new PortfolioProjectsCsvService(null as any, exporter, importer, documents),
    requests: new PortfolioRequestsCsvService(null as any, exporter, importer, documents),
  };
}

async function run(service: Service, manager: EntityManager, tenantId: string, userId: string, csv: string, dryRun: boolean): Promise<CsvImportResult> {
  const file = { buffer: Buffer.from(csv, 'utf8'), originalname: 'portfolio.csv', mimetype: 'text/csv', size: csv.length } as Express.Multer.File;
  return service.import(file, { dryRun, operation: 'upsert' }, { manager, tenantId, userId, access: { isAdmin: true } as any });
}

/** The check, then the load: both say the same counts. */
async function checkAndLoad(service: Service, runner: QueryRunner, tenantId: string, userId: string, csv: string) {
  const check = await run(service, runner.manager, tenantId, userId, csv, true);
  assert.equal(check.ok, true, JSON.stringify(check.errors));
  const load = await run(service, runner.manager, tenantId, userId, csv, false);
  assert.equal(load.ok, true, JSON.stringify(load.errors));
  const counts = (result: CsvImportResult) => ({ updated: result.updated, unchanged: result.unchanged, cleared: result.cleared });
  assert.deepEqual(counts(load), counts(check), 'the load does what the check said');
  return counts(load);
}

/** The text the record's screen shows for a slot (the service that serves it). */
async function shown(documents: ReturnType<typeof servicesFor>['documents'], runner: QueryRunner, type: 'projects' | 'requests', id: string, slot: string, userId: string) {
  const document: any = await documents.getBySource(type, id, slot, userId, { manager: runner.manager });
  return document?.content_markdown ?? '';
}

async function testProjects() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedCreationTenant(runner, { portfolio_projects: 'admin', portfolio_requests: 'admin' });
    const { tenantId, creatorId: userId } = seed;
    const { documents, projects } = servicesFor(runner.manager);
    const project = async (n: number) => {
      const id = randomUUID();
      await runner.query(
        `INSERT INTO portfolio_projects (id, tenant_id, item_number, name, status, origin, execution_progress, purpose)
         VALUES ($1, $2, $3, $4, 'in_progress', 'legacy', 0, 'Old goal')`,
        [id, tenantId, n, `Legacy project ${n}`],
      );
      return id;
    };
    const [left, blank, filled, cleared] = [await project(1), await project(2), await project(3), await project(4)];

    assert.deepEqual(await checkAndLoad(projects, runner, tenantId, userId, `id;name\n${left};Legacy project 1`), { updated: 0, unchanged: 1, cleared: 0 }, 'a file without the column');
    assert.deepEqual(await checkAndLoad(projects, runner, tenantId, userId, `id;name;purpose\n${blank};Legacy project 2;`), { updated: 0, unchanged: 1, cleared: 0 }, 'a blank cell');
    assert.equal(await boundDocuments(runner, tenantId, 'projects', left), 0, 'nothing written: no document');
    assert.equal(await boundDocuments(runner, tenantId, 'projects', blank), 0, 'nothing written: no document');
    assert.equal(await shown(documents, runner, 'projects', left, 'purpose', userId), 'Old goal', 'the screen still shows the purpose');
    assert.equal(await shown(documents, runner, 'projects', blank, 'purpose', userId), 'Old goal', 'the screen still shows the purpose');

    assert.deepEqual(await checkAndLoad(projects, runner, tenantId, userId, `id;name;purpose\n${filled};Legacy project 3;New goal`), { updated: 1, unchanged: 0, cleared: 0 }, 'a filled cell');
    assert.equal(await shown(documents, runner, 'projects', filled, 'purpose', userId), 'New goal', 'the document holds the new text');

    assert.deepEqual(await checkAndLoad(projects, runner, tenantId, userId, `id;name;purpose\n${cleared};Legacy project 4;-`), { updated: 1, unchanged: 0, cleared: 1 }, '`-` clears the purpose');
    assert.equal(await shown(documents, runner, 'projects', cleared, 'purpose', userId), '', 'the purpose is empty');
  });
}

async function testRequests() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedCreationTenant(runner, { portfolio_projects: 'admin', portfolio_requests: 'admin' });
    const { tenantId, creatorId: userId } = seed;
    const { documents, requests } = servicesFor(runner.manager);
    const request = async (n: number) => {
      const id = randomUUID();
      await runner.query(
        `INSERT INTO portfolio_requests (id, tenant_id, item_number, name, status, purpose, risks)
         VALUES ($1, $2, $3, $4, 'pending_review', 'Old purpose', 'Old risks')`,
        [id, tenantId, n, `Legacy request ${n}`],
      );
      return id;
    };
    const [left, blank, filled, cleared] = [await request(1), await request(2), await request(3), await request(4)];
    const both = async (id: string) => [
      await shown(documents, runner, 'requests', id, 'purpose', userId),
      await shown(documents, runner, 'requests', id, 'risks_mitigations', userId),
    ];

    assert.deepEqual(await checkAndLoad(requests, runner, tenantId, userId, `id;name\n${left};Legacy request 1`), { updated: 0, unchanged: 1, cleared: 0 }, 'a file without the columns');
    assert.deepEqual(await checkAndLoad(requests, runner, tenantId, userId, `id;name;purpose;risks\n${blank};Legacy request 2;;`), { updated: 0, unchanged: 1, cleared: 0 }, 'blank cells');
    assert.equal(await boundDocuments(runner, tenantId, 'requests', left), 0, 'nothing written: no document');
    assert.equal(await boundDocuments(runner, tenantId, 'requests', blank), 0, 'nothing written: no document');
    assert.deepEqual(await both(left), ['Old purpose', 'Old risks'], 'the screen still shows both texts');
    assert.deepEqual(await both(blank), ['Old purpose', 'Old risks'], 'the screen still shows both texts');

    assert.deepEqual(await checkAndLoad(requests, runner, tenantId, userId, `id;name;purpose;risks\n${filled};Legacy request 3;New purpose;New risks`), { updated: 1, unchanged: 0, cleared: 0 }, 'filled cells');
    assert.deepEqual(await both(filled), ['New purpose', 'New risks'], 'the documents hold the new texts');

    assert.deepEqual(await checkAndLoad(requests, runner, tenantId, userId, `id;name;purpose;risks\n${cleared};Legacy request 4;-;-`), { updated: 1, unchanged: 0, cleared: 2 }, '`-` clears both');
    assert.deepEqual(await both(cleared), ['', ''], 'both texts are empty');
  });
}

async function main() {
  const specs: Array<[string, () => Promise<void>]> = [
    ['a project without a purpose document keeps its text', testProjects],
    ['a request without purpose and risks documents keeps its texts', testRequests],
  ];
  await dataSource.initialize();
  let failed = 0;
  for (const [name, spec] of specs) {
    try {
      await spec();
      console.log(`  ok    ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`  FAIL  ${name}\n        ${String((error as Error)?.message ?? error).split('\n').join('\n        ')}`);
    }
  }
  await dataSource.destroy();
  console.log(failed ? `Portfolio CSV legacy texts: ${failed} of ${specs.length} failing` : 'Portfolio CSV legacy texts: ok');
  process.exit(failed ? 1 : 0);
}

void main();
