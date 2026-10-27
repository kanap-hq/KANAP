import * as assert from 'node:assert/strict';
import 'reflect-metadata';
import { defer, lastValueFrom } from 'rxjs';
import AdmZip = require('adm-zip');
import { ExportEventsInterceptor } from '../../../audit/export-events.interceptor';
import { CsvExportService } from '../csv-export.service';
import { CsvResolverService } from '../csv-resolver.service';
import { CsvEntityConfig, CsvFieldType } from '../csv-field.types';
import { XLSX_CONTENT_TYPE } from '../../xlsx';
import { ApplicationsController } from '../../../applications/applications.controller';
import { AssetsController } from '../../../assets/assets.controller';
import { IncidentsController } from '../../../incidents/incidents.controller';
import { PortfolioProjectsController } from '../../../portfolio/portfolio-projects.controller';
import { PortfolioRequestsController } from '../../../portfolio/portfolio-requests.controller';
import { TasksController } from '../../../spend/tasks.controller';

// The six field-engine export routes (applications, assets, incidents, projects, requests, tasks),
// without a database: each handler, run through the export interceptor as Nest runs it, reads
// `format` (csv by default, xlsx; anything else, or xlsx for a template, 400 before any work), hands
// it to its service, sends the file with its type and name, and reports the format and row count to
// the export row of the audit log before the body goes out.

const ENGINE = new CsvExportService(new CsvResolverService());
const CONFIG: CsvEntityConfig = {
  entityName: 'probe',
  tableName: 'probes',
  displayName: 'Probes',
  sheetNames: { fr: 'Sondes' },
  upsertKey: ['name'],
  fields: [
    { csvColumn: 'name', entityProperty: 'name', type: CsvFieldType.STRING },
    { csvColumn: 'effort', entityProperty: 'effort', type: CsvFieldType.NUMBER },
  ],
};
const ROWS = [{ name: 'Alpha', effort: '2.50' }, { name: '=cmd', effort: null }, { name: 'Gamma', effort: 4 }];

type Probe = {
  name: string;
  path: string;
  controller: any;
  /** Calls the handler with `format` and `scope`, the other parameters as the screen sends them. */
  call: (controller: any, format: string | undefined, scope: 'data' | 'template', req: any, res: any) => Promise<unknown>;
};

const manager = (queries: Array<{ sql: string; params?: unknown[] }>) => ({
  getRepository: () => ({ insert: async () => ({ identifiers: [{ id: 'row-1' }] }) }),
  query: async (sql: string, params?: unknown[]) => {
    queries.push({ sql, params });
    return [];
  },
});

function controllerWith(type: any, seen: Array<Record<string, unknown>>) {
  const controller = Object.create(type.prototype);
  controller.csvSvc = {
    export: async (opts: any) => {
      seen.push(opts);
      return ENGINE.export(CONFIG, opts.scope === 'template' ? [] : ROWS, {
        manager: opts.manager, tenantId: opts.tenantId, language: opts.language, scope: opts.scope, format: opts.format,
      });
    },
  };
  return controller;
}

const probes: Probe[] = [
  {
    name: 'applications',
    path: '/applications/export',
    controller: ApplicationsController,
    call: (c, format, scope, req, res) => c.export({}, 'fr', scope, undefined, undefined, undefined, undefined, undefined, format, res, req.ctx),
  },
  {
    name: 'assets',
    path: '/assets/export',
    controller: AssetsController,
    call: (c, format, scope, req, res) => c.exportCsv({}, 'fr', scope, undefined, undefined, undefined, undefined, undefined, format, req, res),
  },
  {
    name: 'incidents',
    path: '/incidents/export',
    controller: IncidentsController,
    call: (c, format, scope, req, res) => c.exportCsv({}, 'fr', 'Europe/Paris', scope, undefined, format, res, req.ctx),
  },
  {
    name: 'projects',
    path: '/portfolio/projects/export',
    controller: PortfolioProjectsController,
    call: (c, format, scope, req, res) => c.exportCsv('fr', scope, undefined, undefined, undefined, format, req.ctx, res),
  },
  {
    name: 'requests',
    path: '/portfolio/requests/export',
    controller: PortfolioRequestsController,
    call: (c, format, scope, req, res) => c.exportCsv('fr', scope, undefined, undefined, undefined, format, req, res),
  },
  {
    name: 'tasks',
    path: '/tasks/export',
    controller: TasksController,
    call: (c, format, scope, req, res) => c.exportCsv('fr', scope, undefined, undefined, undefined, undefined, format, req, res),
  },
];

/** One request through the interceptor: what the handler sent, its headers, and the audit queries. */
async function run(probe: Probe, format: string | undefined, scope: 'data' | 'template' = 'data') {
  const headers: Record<string, string> = {};
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const seen: Array<Record<string, unknown>> = [];
  const mg = manager(queries);
  const req: any = {
    tenant: { id: 'tenant-1' },
    user: { sub: 'user-1' },
    isAdmin: true,
    permissions: {},
    path: probe.path,
    query: {},
    queryRunner: { manager: mg, isReleased: false },
  };
  req.ctx = { tenantId: 'tenant-1', userId: 'user-1', manager: mg, isAdmin: true, permissions: {} };
  let body: unknown;
  let queriesBeforeSend = -1;
  const res: any = {
    req,
    setHeader: (name: string, value: string) => { headers[name] = value; },
    getHeader: (name: string) => headers[Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase()) ?? ''],
    send: (value: unknown) => {
      body = value;
      queriesBeforeSend = queries.length;
    },
  };
  req.res = res;
  const controller = controllerWith(probe.controller, seen);
  const handlerName = probe.name === 'applications' ? 'export' : 'exportCsv';
  const context = {
    getType: () => 'http',
    getClass: () => probe.controller,
    getHandler: () => probe.controller.prototype[handlerName],
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as any;
  let error: any = null;
  try {
    await lastValueFrom(
      new ExportEventsInterceptor().intercept(context, { handle: () => defer(() => probe.call(controller, format, scope, req, res)) }),
      { defaultValue: undefined },
    );
  } catch (caught) {
    error = caught;
  }
  const update = queries.find((query) => query.sql.startsWith('UPDATE audit_log'));
  return { headers, queries, seen, body, error, update, queriesBeforeSend };
}

async function testRoutes() {
  for (const probe of probes) {
    const xlsx = await run(probe, 'xlsx');
    assert.equal(xlsx.error, null, `${probe.name}: xlsx answers`);
    assert.equal(xlsx.seen[0]?.format, 'xlsx', `${probe.name}: the service gets the format`);
    assert.equal(xlsx.headers['Content-Type'], XLSX_CONTENT_TYPE, `${probe.name}: xlsx type`);
    assert.match(xlsx.headers['Content-Disposition'], /probe_export\.xlsx/, `${probe.name}: xlsx name`);
    assert.ok(Buffer.isBuffer(xlsx.body), `${probe.name}: a workbook`);
    const zip = new AdmZip(xlsx.body as Buffer);
    assert.match(zip.readAsText('xl/workbook.xml'), /<sheet name="Sondes"/, `${probe.name}: the sheet in French`);
    const sheet = zip.readAsText('xl/worksheets/sheet1.xml');
    assert.match(sheet, /<c r="B2"><v>2.5<\/v><\/c>/, `${probe.name}: a number cell`);
    assert.match(sheet, /<t xml:space="preserve">&apos;=cmd<\/t>/, `${probe.name}: the formula guard`);
    assert.deepEqual(xlsx.update?.params, ['{"format":"xlsx","rows":3}', 'row-1', 'tenant-1'], `${probe.name}: format and rows on the audit row`);
    assert.equal(xlsx.queriesBeforeSend, xlsx.queries.length, `${probe.name}: the audit row is completed before sending, nothing after`);

    const csv = await run(probe, undefined);
    assert.equal(csv.error, null, `${probe.name}: csv answers`);
    assert.equal(csv.headers['Content-Type'], 'text/csv; charset=utf-8', `${probe.name}: csv by default`);
    assert.match(csv.headers['Content-Disposition'], /probe_export\.csv/);
    assert.equal(typeof csv.body, 'string');
    assert.deepEqual(csv.update?.params, ['{"format":"csv","rows":3}', 'row-1', 'tenant-1'], `${probe.name}: csv on the audit row`);

    const template = await run(probe, 'csv', 'template');
    assert.equal(template.error, null, `${probe.name}: the CSV template answers`);
    assert.deepEqual(template.update?.params, ['{"format":"csv","rows":0}', 'row-1', 'tenant-1'], `${probe.name}: a template has no row`);

    for (const [format, scope] of [['xlsx', 'template'], ['ods', 'data'], ['XLSX ', 'template']] as const) {
      const refused = await run(probe, format, scope);
      assert.equal(refused.error?.getStatus?.(), 400, `${probe.name}: ${format} ${scope} answers 400`);
      assert.equal(refused.seen.length, 0, `${probe.name}: ${format} ${scope} refused before any work`);
      assert.equal(refused.body, undefined);
    }
  }
  console.log(`  ${probes.length} routes: format to the service, type, name, audit format and rows before sending; template xlsx and unknown format 400: OK`);
}

async function main() {
  console.log('csv export routes');
  await testRoutes();
  console.log('csv-export-routes.spec: all assertions passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
