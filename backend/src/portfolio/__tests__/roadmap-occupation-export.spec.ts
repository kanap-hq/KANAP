import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import AdmZip = require('adm-zip');
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { backendPath } from '../../common/__tests__/backend-root';
import { assertLocaleLabels } from '../../common/report-export/__tests__/locale-labels';
import { PortfolioRoadmapController } from '../portfolio-roadmap.controller';
import { PortfolioRoadmapService } from '../services/portfolio-roadmap.service';
import { parseRoadmapGenerate } from '../dto/roadmap.dto';
import {
  ROADMAP_OCCUPATION_EXPORT_KEYS,
  ROADMAP_OCCUPATION_EXPORT_LABELS,
} from '../services/roadmap-occupation-export';
import { contributor, prepared, project } from './roadmap-scheduler.fixtures';
// The screen's own code, from the frontend tree: the export must give the tables it computes.
import { buildRoadmapOccupation, isoWeekParts, roundedMean } from '../../../../frontend/src/pages/portfolio/roadmapOccupation';

/**
 * The roadmap occupation export (`POST /portfolio/reports/roadmap/occupation/export`, the generate payload as
 * body) against the screen: from the answer of `POST …/roadmap/generate` for the same payload, its two tables
 * are what the screen's module computes. The generation the export runs skips the sensitivity reruns: the
 * occupation is the same with and without them. Then the workbook, the refused requests (400), the guard of
 * `generate` and the labels against `portfolio.json`. No database: the service runs on a prototype instance
 * whose data loading returns a hand-built input (roadmap-scheduler.fixtures.ts).
 */

const TENANT = '00000000-0000-0000-0000-000000000001';
const APPS = '11111111-1111-4111-8111-111111111111';
const DATA = '22222222-2222-4222-8222-222222222222';

const PAYLOAD = {
  startDate: '2026-01-05',
  statuses: ['planned', 'in_progress'],
  capacityMode: 'theoretical',
  capacityConstraintMode: 'full',
  parallelizationLimit: 2,
  optimizationMode: 'completion_focused',
  includeAlreadyScheduled: false,
  excludedProjectIds: ['33333333-3333-4333-8333-333333333333'],
  contextSwitchPenaltyPct: 0.1,
  contextSwitchGrace: 2,
};

/** Three contributors (two teams and none), three projects that share them: occupation over several weeks. */
function service(): PortfolioRoadmapService {
  const svc: any = Object.create(PortfolioRoadmapService.prototype);
  svc.prepareData = async (_tenantId: string, options: unknown) => ({
    ...prepared(
      [
        project('p1', new Map([['c-ann', 10], ['c-bob', 5]])),
        project('p2', new Map([['c-bob', 8], ['c-cyd', 6]]), { priorityScore: 80 }),
        project('p3', new Map([['c-ann', 4], ['c-cyd', 3]]), { priorityScore: 60 }),
      ],
      [
        { ...contributor('c-ann', 20), name: 'Ann Durand', teamId: APPS, teamName: 'Applications' },
        { ...contributor('c-bob', 16), name: 'Bob Klein', teamId: DATA, teamName: 'Data' },
        { ...contributor('c-cyd', 10), name: 'Cyd Moreau', teamId: null, teamName: null },
      ],
    ),
    options,
  });
  svc.buildOnHoldRanges = async () => new Map();
  return svc;
}

const manager = {
  query: async (sql: string) => {
    if (sql.includes('split_part(email')) return [{ name: 'Claire Martin' }];
    if (sql.includes('user_notification_preferences')) return [];
    throw new Error(`Unexpected statement: ${sql}`);
  },
} as any;
const ctx = { tenantId: TENANT, userId: 'user-1', userRoles: [], manager } as any;

function fakeResponse() {
  const headers: Record<string, string> = {};
  let body: Buffer | null = null;
  return {
    headers,
    body: () => body!,
    res: { setHeader: (name: string, value: string) => { headers[name] = value; }, send: (value: Buffer) => { body = value; } } as any,
  };
}

/** The rows of an English CSV (BOM dropped, quotes read). */
function csvRows(buffer: Buffer): string[][] {
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (ch !== '\r') cell += ch;
  }
  return rows;
}

async function exportCsv(table: string, body: unknown = PAYLOAD) {
  const out = fakeResponse();
  await new PortfolioRoadmapController(service()).exportRoadmapOccupation({ language: 'en', tz: 'UTC', table }, body as any, ctx, out.res);
  return csvRows(out.body());
}

const EN = JSON.parse(fs.readFileSync(backendPath('..', 'frontend', 'src', 'locales', 'en', 'portfolio.json'), 'utf8')).planning.roadmap.occupation;

/** What the screen draws from the generate answer, written as the export's English CSV cells. */
function screenTables(response: { occupation: any[]; teamOccupation: any[] }) {
  const tables = buildRoadmapOccupation(response.occupation, response.teamOccupation, { noTeam: EN.noTeam }, new Intl.Collator('en').compare);
  const pct = (value: number | null | undefined) => (value == null ? '' : `${value.toFixed(2)}%`);
  const weekHeaders = tables.weekKeys.map((key) => {
    const { week, year } = isoWeekParts(key);
    return EN.weekYear.replace('{{week}}', String(week).padStart(2, '0')).replace('{{year}}', String(year));
  });
  const cells = (values: Map<string, number | null>) => [
    ...tables.weekKeys.map((key) => pct(values.get(key))),
    pct(roundedMean(tables.weekKeys.map((key) => values.get(key)))),
  ];
  return {
    contributors: [
      [EN.team, EN.contributor, ...weekHeaders, EN.average],
      ...tables.contributorGroups.flatMap((group) => group.rows.map((row) => [group.teamName, row.contributorName, ...cells(row.weekOccupation)])),
      [EN.avg, '', ...cells(tables.contributorAverages)],
    ],
    teams: [
      [EN.team, ...weekHeaders, EN.average],
      ...tables.teamRows.map((row) => [row.teamName, ...cells(row.weekOccupation)]),
      [EN.avg, ...cells(tables.teamAverages)],
    ],
  };
}

async function testSensitivityLeavesTheOccupation() {
  const withReruns = await service().generateRoadmap(TENANT, PAYLOAD, { manager });
  const without = await service().generateRoadmap(TENANT, PAYLOAD, { manager }, { skipSensitivity: true });
  assert.ok(withReruns.occupation.length > 6, 'several contributor weeks');
  assert.equal(withReruns.diagnostics.sensitivityReruns, 3, 'one rerun per contributor');
  assert.equal(withReruns.bottlenecks.length, 3);
  assert.equal(without.diagnostics.sensitivityReruns, 0, 'no rerun');
  assert.deepEqual(without.bottlenecks, []);
  assert.deepEqual(without.occupation, withReruns.occupation, 'the same contributor occupation');
  assert.deepEqual(without.teamOccupation, withReruns.teamOccupation, 'the same team occupation');
  assert.deepEqual(without.schedule, withReruns.schedule, 'the same schedule');
}

async function testRowsFollowTheScreen() {
  // The answer the screen holds: the generate route for the same payload.
  const generated = await new PortfolioRoadmapController(service()).generateRoadmap(PAYLOAD as any, ctx);
  const expected = screenTables(generated);
  assert.ok(expected.contributors.length >= 5 && expected.teams.length >= 5, 'three contributors, three teams');
  assert.ok(expected.teams.some((row) => row[0] === 'No team'), 'a contributor without a team');
  assert.deepEqual(await exportCsv('contributors'), expected.contributors);
  assert.deepEqual(await exportCsv('teams'), expected.teams);
}

async function testWorkbook() {
  const out = fakeResponse();
  await new PortfolioRoadmapController(service()).exportRoadmapOccupation(
    { format: 'xlsx', language: 'fr', tz: 'Europe/Paris', table: 'teams' },
    { ...PAYLOAD, scenario: { projectOverrides: [{ projectId: '44444444-4444-4444-8444-444444444444', schedulingMode: 'collaborative' }], scenarioProjects: [] } } as any,
    ctx,
    out.res,
  );
  assert.match(out.headers['Content-Disposition'], /roadmap-occupation-\d{4}-\d{2}-\d{2}\.xlsx/);
  const zip = new AdmZip(out.body());
  const names = [...zip.readAsText('xl/workbook.xml').matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(names, ['Équipes', 'Contributeurs', 'Paramètres'], 'the table asked first, then the other one');
  const teams = zip.readAsText('xl/worksheets/sheet1.xml');
  assert.match(teams, /<c r="B2" s="4"><v>0\.\d+<\/v><\/c>|<c r="B2" s="4"><v>1(\.\d+)?<\/v><\/c>/, 'an occupation is a percent cell');
  const parameters = [...zip.readAsText('xl/worksheets/sheet3.xml').matchAll(/<t xml:space="preserve">([^<]*)<\/t>/g)]
    .map((m) => m[1].replace(/&apos;/g, "'"));
  assert.deepEqual(parameters.slice(2, 24), [
    'Date de début', '2026-01-05',
    'Statuts', 'Planifié, En cours',
    'Mode de capacité', 'Théorique',
    'Périmètre des contraintes', 'Portefeuille complet',
    'Limite de parallélisme', '2',
    'Optimisation', 'Achèvement d\'abord',
    'Recalculer les projets déjà planifiés', 'Non',
    'Pénalité de changement de contexte', '10 %',
    'Tolérance de changement de contexte', '2',
    'Projets exclus', '1',
    'Ajustements du scénario', 'Oui',
  ]);
}

async function testRefused() {
  for (const [query, body, message] of [
    [{ table: 'contributors', months: '3' }, PAYLOAD, /Unknown parameter: months/],
    [{}, PAYLOAD, /table is required for a CSV file/],
    [{ table: 'weeks' }, PAYLOAD, /table must be one of contributors, teams/],
    [{ table: 'teams', format: 'ods' }, PAYLOAD, /format must be csv or xlsx/],
    [{ table: 'teams' }, { ...PAYLOAD, startDate: '2026-02-30' }, /Invalid calendar date/],
    [{ table: 'teams' }, { ...PAYLOAD, parallelizationLimit: 9 }, /Too big: expected number to be <=5/],
    [{ table: 'teams' }, { ...PAYLOAD, statuses: ['done'] }, /Invalid option/],
    [{ table: 'teams' }, 'not a payload', /expected object/],
  ] as Array<[Record<string, unknown>, unknown, RegExp]>) {
    await assert.rejects(
      () => new PortfolioRoadmapController(service()).exportRoadmapOccupation({ language: 'en', ...query }, body as any, ctx, fakeResponse().res),
      (error: any) => error.getStatus?.() === 400 && message.test(error.message),
      JSON.stringify({ query, body }),
    );
  }
  // The payload the export validates is the one generate validates.
  assert.throws(() => parseRoadmapGenerate({ ...PAYLOAD, startDate: '2026-02-30' }));
}

function testRouteFollowsGenerate() {
  const generate = PortfolioRoadmapController.prototype.generateRoadmap;
  const exportRoute = PortfolioRoadmapController.prototype.exportRoadmapOccupation;
  assert.equal(Reflect.getMetadata(PATH_METADATA, exportRoute), 'reports/roadmap/occupation/export');
  assert.equal(Reflect.getMetadata(METHOD_METADATA, exportRoute), Reflect.getMetadata(METHOD_METADATA, generate), 'a POST, as generate');
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, exportRoute), Reflect.getMetadata(GUARDS_METADATA, generate), 'the guards of generate');
  const keys = (handler: object) => Reflect.getMetadataKeys(handler).filter((key) => typeof key === 'string' && key !== PATH_METADATA && key !== METHOD_METADATA && !key.startsWith('__'));
  const metadata = (handler: object) => Object.fromEntries(keys(handler).map((key: string) => [key, Reflect.getMetadata(key, handler)]));
  assert.deepEqual(metadata(exportRoute), metadata(generate), 'the same required level and route decorators as generate');
}

async function run() {
  await testSensitivityLeavesTheOccupation();
  await testRowsFollowTheScreen();
  await testWorkbook();
  await testRefused();
  testRouteFollowsGenerate();
  assertLocaleLabels('portfolio', ROADMAP_OCCUPATION_EXPORT_KEYS, ROADMAP_OCCUPATION_EXPORT_LABELS);
  console.log('roadmap-occupation-export.spec: OK');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
