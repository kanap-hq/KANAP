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
import { prepareRecoveredContent } from '../../common/markdown-worker';
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

// Pass H: that column may hold HTML (a text saved before the Markdown documents). The screen turns it
// into Markdown when it opens the record (`repairSourceSlot`), images migrated. The import compares
// with that Markdown, and a load that writes the record first repairs it as the screen does: the
// document gets the converted text, and the load no longer fails on the HTML.
const HTML_GOAL = '<p>Old <strong>goal</strong></p>';
const MARKDOWN_GOAL = 'Old **goal**';
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const HTML_WITH_IMAGE = `<p>Goal <img src="data:image/png;base64,${PIXEL}"></p>`;

/** The record's managed document of `slot`, read in the table (no repair). */
async function storedDocument(runner: QueryRunner, tenantId: string, type: string, id: string, slot: string) {
  const rows = await runner.query(
    `SELECT d.id, d.content_markdown FROM integrated_document_bindings b
       JOIN documents d ON d.id = b.document_id AND d.tenant_id = b.tenant_id
      WHERE b.tenant_id = $1 AND b.source_entity_type = $2 AND b.source_entity_id = $3 AND b.slot_key = $4`,
    [tenantId, type, id, slot],
  );
  return rows[0] as { id: string; content_markdown: string } | undefined;
}

/** An export of these records, as the list's export button gives it, the text of the file. */
async function exported(service: Service, manager: EntityManager, tenantId: string, ids: string[]) {
  const result = await service.export({ manager, tenantId, language: 'en', ids });
  return String(result.content).replace(/^﻿/, '');
}

async function testHtmlProjects() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedCreationTenant(runner, { portfolio_projects: 'admin', portfolio_requests: 'admin', knowledge: 'member' });
    const { tenantId, creatorId: userId } = seed;
    const { documents, projects } = servicesFor(runner.manager);
    const project = async (n: number, purpose: string) => {
      const id = randomUUID();
      await runner.query(
        `INSERT INTO portfolio_projects (id, tenant_id, item_number, name, status, origin, execution_progress, purpose)
         VALUES ($1, $2, $3, $4, 'in_progress', 'legacy', 0, $5)`,
        [id, tenantId, n, `Html project ${n}`, purpose],
      );
      return id;
    };
    // The image goes into the document's attachments as the person who imports, as when that person
    // opens the project: writing in the documents' library is needed (`knowledge`), at the screen too.
    const [renamed, left, blank, roundTrip, pictured] = [
      await project(1, HTML_GOAL), await project(2, HTML_GOAL), await project(3, HTML_GOAL),
      await project(4, HTML_GOAL), await project(5, HTML_WITH_IMAGE),
    ];

    assert.deepEqual(await checkAndLoad(projects, runner, tenantId, userId, `id;name\n${renamed};Renamed project`), { updated: 1, unchanged: 0, cleared: 0 }, 'a file that renames the project');
    assert.equal((await storedDocument(runner, tenantId, 'projects', renamed, 'purpose'))?.content_markdown, MARKDOWN_GOAL, 'the document holds the converted text');
    assert.equal(await shown(documents, runner, 'projects', renamed, 'purpose', userId), MARKDOWN_GOAL, 'the screen reads it');

    assert.deepEqual(await checkAndLoad(projects, runner, tenantId, userId, `id;name\n${left};Html project 2`), { updated: 0, unchanged: 1, cleared: 0 }, 'a file without the column');
    assert.deepEqual(await checkAndLoad(projects, runner, tenantId, userId, `id;name;purpose\n${blank};Html project 3;`), { updated: 0, unchanged: 1, cleared: 0 }, 'a blank cell');

    const file = await exported(projects, runner.manager, tenantId, [roundTrip]);
    assert.deepEqual(await checkAndLoad(projects, runner, tenantId, userId, file), { updated: 0, unchanged: 1, cleared: 0 }, 'an export imported as it is');
    assert.equal(await boundDocuments(runner, tenantId, 'projects', roundTrip), 0, 'nothing written: no document');

    assert.deepEqual(await checkAndLoad(projects, runner, tenantId, userId, `id;name\n${pictured};Pictured project`), { updated: 1, unchanged: 0, cleared: 0 }, 'a renamed project with an inline image');
    const document = await storedDocument(runner, tenantId, 'projects', pictured, 'purpose');
    assert.ok(document, 'the document exists');
    assert.doesNotMatch(document!.content_markdown, /data:image/, 'the inline image is migrated');
    const attachments = await runner.query(`SELECT id FROM document_attachments WHERE tenant_id = $1 AND document_id = $2`, [tenantId, document!.id]);
    assert.equal(attachments.length, 1, 'the image is an attachment of the document');
    assert.match(document!.content_markdown, new RegExp(`^Goal !\\[\\]\\(/api/knowledge/inline/[^/]+/${attachments[0].id}\\)$`), 'the text points at it');
  });
}

async function testHtmlRequests() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedCreationTenant(runner, { portfolio_projects: 'admin', portfolio_requests: 'admin' });
    const { tenantId, creatorId: userId } = seed;
    const { documents, requests } = servicesFor(runner.manager);
    const request = async (n: number) => {
      const id = randomUUID();
      await runner.query(
        `INSERT INTO portfolio_requests (id, tenant_id, item_number, name, status, purpose, risks)
         VALUES ($1, $2, $3, $4, 'pending_review', $5, '<ul><li>Old risk</li></ul>')`,
        [id, tenantId, n, `Html request ${n}`, HTML_GOAL],
      );
      return id;
    };
    const [renamed, left, blank, roundTrip] = [await request(1), await request(2), await request(3), await request(4)];
    const risks = (await prepareRecoveredContent('<ul><li>Old risk</li></ul>'))!;
    assert.doesNotMatch(risks, /</, 'the risks convert to Markdown');

    assert.deepEqual(await checkAndLoad(requests, runner, tenantId, userId, `id;name\n${renamed};Renamed request`), { updated: 1, unchanged: 0, cleared: 0 }, 'a file that renames the request');
    assert.equal((await storedDocument(runner, tenantId, 'requests', renamed, 'purpose'))?.content_markdown, MARKDOWN_GOAL, 'the purpose document holds the converted text');
    assert.equal((await storedDocument(runner, tenantId, 'requests', renamed, 'risks_mitigations'))?.content_markdown, risks, 'the risks document holds the converted text');
    assert.equal(await shown(documents, runner, 'requests', renamed, 'purpose', userId), MARKDOWN_GOAL, 'the screen reads the purpose');
    assert.equal(await shown(documents, runner, 'requests', renamed, 'risks_mitigations', userId), risks, 'the screen reads the risks');

    assert.deepEqual(await checkAndLoad(requests, runner, tenantId, userId, `id;name\n${left};Html request 2`), { updated: 0, unchanged: 1, cleared: 0 }, 'a file without the columns');
    assert.deepEqual(await checkAndLoad(requests, runner, tenantId, userId, `id;name;purpose;risks\n${blank};Html request 3;;`), { updated: 0, unchanged: 1, cleared: 0 }, 'blank cells');

    const file = await exported(requests, runner.manager, tenantId, [roundTrip]);
    assert.deepEqual(await checkAndLoad(requests, runner, tenantId, userId, file), { updated: 0, unchanged: 1, cleared: 0 }, 'an export imported as it is');
    assert.equal(await boundDocuments(runner, tenantId, 'requests', roundTrip), 0, 'nothing written: no document');
  });
}

async function main() {
  const specs: Array<[string, () => Promise<void>]> = [
    ['a project without a purpose document keeps its text', testProjects],
    ['a request without purpose and risks documents keeps its texts', testRequests],
    ['a project whose purpose column holds HTML is repaired as the screen does', testHtmlProjects],
    ['a request whose columns hold HTML is repaired as the screen does', testHtmlRequests],
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
