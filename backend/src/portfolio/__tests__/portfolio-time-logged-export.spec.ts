import * as assert from 'node:assert/strict';
import AdmZip = require('adm-zip');
import { assertLocaleLabels } from '../../common/report-export/__tests__/locale-labels';
import { buildMonths, todayIn } from '../services/portfolio-flow-report.service';
import { PortfolioTimeLoggedReportController } from '../portfolio-time-logged-report.controller';
import { TIME_LOGGED_EXPORT_KEYS, TIME_LOGGED_EXPORT_LABELS } from '../services/portfolio-time-logged-export';
import { cellTotalDays, PortfolioTimeLoggedReportService } from '../services/portfolio-time-logged-report.service';
import type { TimeLoggedReportResponse } from '../dto/time-logged-report.dto';

/**
 * The time logged export against the report it comes from: for the same seeded entries and the same
 * parameters, the rows of the file are the flattening of `getReport` (the data route's call), in its
 * order, with the screen's month total. Then the Parameters sheet, the refused requests and the labels.
 */

const TENANT = '00000000-0000-0000-0000-000000000001';
const USER = '00000000-0000-0000-0000-0000000000aa';
const today = todayIn('UTC');
const months = buildMonths(today, 6).map((bound) => bound.periodStart.slice(0, 7));

const hours = [
  { user_id: 'u-ann', month: months[0], is_project: true, hours: 4.8 },
  { user_id: 'u-ann', month: months[0], is_project: false, hours: 8 },
  { user_id: 'u-bob', month: months[1], is_project: true, hours: 16 },
  { user_id: 'u-bob', month: months[5], is_project: false, hours: '2.4' },
  { user_id: null, month: months[2], is_project: false, hours: 3.2 },
];
const people = [
  { user_id: 'u-ann', name: 'Ann Durand', item_number: 1, team_id: 'team-apps', team_name: 'Applications', team_order: 1, is_contributor: true },
  { user_id: 'u-bob', name: 'Bob Klein', item_number: 2, team_id: null, team_name: null, team_order: null, is_contributor: true },
  { user_id: 'u-cyd', name: 'Cyd Moreau', item_number: 3, team_id: 'team-infra', team_name: 'Infrastructure', team_order: 0, is_contributor: true },
];

type Call = { sql: string; params: any[] };
function stubManager() {
  const calls: Call[] = [];
  const manager = {
    query: async (sql: string, params: any[]) => {
      calls.push({ sql, params });
      if (sql.includes('UNION ALL')) return hours;
      if (sql.includes('FROM users u')) return people;
      if (sql.includes('FROM portfolio_teams')) return params[1].includes('team-apps') ? [{ name: 'Applications' }] : [];
      if (sql.includes('FROM portfolio_projects')) return [];
      if (sql.includes('split_part(email')) return [{ name: 'Claire Martin' }];
      if (sql.includes('user_notification_preferences')) return [{ timezone: 'Europe/Paris' }];
      if (sql.includes('SELECT locale FROM users')) return [{ locale: 'de' }];
      throw new Error(`Unexpected statement: ${sql}`);
    },
  } as any;
  return { manager, calls };
}

function fakeResponse() {
  const headers: Record<string, string> = {};
  let body: Buffer | null = null;
  return {
    headers,
    body: () => body!,
    res: { setHeader: (name: string, value: string) => { headers[name] = value; }, send: (value: Buffer) => { body = value; } } as any,
  };
}

/** The flattening the export must equal, written here from the report itself. */
function flatten(report: TimeLoggedReportResponse, noTeam: string, unknownUser: string): string[][] {
  return report.teams.flatMap((team) => team.members.flatMap((member) => member.cells.map((cell) => [
    team.teamName ?? noTeam,
    member.userId ? member.name : unknownUser,
    cell.month,
    String(cell.projectDays),
    String(cell.otherDays),
    String(Math.round((cell.projectDays + cell.otherDays) * 10) / 10),
  ])));
}

const sheetRows = (xml: string): string[][] =>
  [...xml.matchAll(/<row r="\d+">(.*?)<\/row>/gs)].map((row) =>
    [...row[1].matchAll(/<c r="[A-Z]+\d+"[^>]*>(?:<is><t xml:space="preserve">([^<]*)<\/t><\/is>|<v>([^<]*)<\/v>)<\/c>/g)].map((m) => m[1] ?? m[2]));

async function run() {
  const svc = new PortfolioTimeLoggedReportService();
  const controller = new PortfolioTimeLoggedReportController(svc);
  const ctx = (manager: any) => ({ tenantId: TENANT, userId: USER, userRoles: [], manager }) as any;

  assert.equal(cellTotalDays(0.1, 0.2), 0.3, 'one decimal, no float residue');

  // CSV, French, a team filter: the same report call as the data route, the same rows.
  {
    const data = stubManager();
    const report = await controller.getTimeLogged({ months: '6', tz: 'UTC', teamIds: 'team-apps' }, ctx(data.manager));
    const file = stubManager();
    const out = fakeResponse();
    await controller.exportTimeLogged({ months: '6', tz: 'UTC', teamIds: 'team-apps', format: 'csv', language: 'fr' }, ctx(file.manager), out.res);
    const unionParams = (calls: Call[]) => calls.find((call) => call.sql.includes('UNION ALL'))!.params;
    assert.deepEqual(unionParams(file.calls), unionParams(data.calls), 'the export reads the hours the data route reads');
    const labels = TIME_LOGGED_EXPORT_LABELS.fr;
    const lines = out.body().toString('utf8').replace(/^﻿/, '').trimEnd().split('\n').map((line) => line.split(';'));
    assert.deepEqual(lines[0], [labels.team, labels.person, labels.month, labels.projectDays, labels.otherDays, labels.totalDays]);
    const expected = flatten(report, labels.noTeam, labels.unknownUser).map((row) => row.map((cell) => cell.replace('.', ',')));
    assert.deepEqual(lines.slice(1), expected, 'rows: the flattening of the report, decimal comma');
    assert.equal(lines.length - 1, 4 * 6, 'four people (Unknown user included), six months each');
    assert.deepEqual(lines.slice(1).map((row) => row[0]).filter((v, i, a) => a.indexOf(v) === i), ['Infrastructure', 'Applications', 'Sans équipe'], 'team order of the report');
    assert.equal(out.headers['Content-Type'], 'text/csv; charset=utf-8');
    assert.match(out.headers['Content-Disposition'], /^attachment; filename="time-logged-\d{4}-\d{2}-\d{2}\.csv"$/);
    const annFirst = lines.find((row) => row[1] === 'Ann Durand' && row[2] === months[0])!;
    assert.deepEqual(annFirst.slice(3), ['0,6', '1', '1,6'], 'days from hours, total as the screen');
  }

  // xlsx, English: the same rows as numbers, then the Parameters sheet.
  {
    const data = stubManager();
    const report = await controller.getTimeLogged({ months: '12', tz: 'Europe/Paris' }, ctx(data.manager));
    const file = stubManager();
    const out = fakeResponse();
    await controller.exportTimeLogged({ months: '12', tz: 'Europe/Paris', format: 'xlsx', language: 'en' }, ctx(file.manager), out.res);
    const zip = new AdmZip(out.body());
    const labels = TIME_LOGGED_EXPORT_LABELS.en;
    assert.deepEqual([...zip.readAsText('xl/workbook.xml').matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]), ['Time logged', 'Parameters']);
    const rows = sheetRows(zip.readAsText('xl/worksheets/sheet1.xml'));
    assert.deepEqual(rows.slice(1), flatten(report, labels.noTeam, labels.unknownUser));
    assert.ok(/<c r="D2"><v>/.test(zip.readAsText('xl/worksheets/sheet1.xml')), 'days are number cells');
    const parameters = sheetRows(zip.readAsText('xl/worksheets/sheet2.xml'));
    assert.deepEqual(parameters.slice(0, 5), [
      ['Parameter', 'Value'],
      ['Period', '12 months'],
      ['Time zone', 'Europe/Paris'],
      ['Project', 'All projects'],
      ['Team', 'All teams'],
    ]);
    assert.deepEqual(parameters[5][0], 'Generated on');
    assert.match(parameters[5][1], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})? \(Europe\/Paris\)$/);
    assert.deepEqual(parameters[6], ['Generated by', 'Claire Martin']);
    assert.equal(parameters.length, 7, 'no access line: the report is not under data-scoped access');
  }

  // No language: the user's own; no tz: the data route's UTC for the months.
  {
    const file = stubManager();
    const out = fakeResponse();
    await controller.exportTimeLogged({}, ctx(file.manager), out.res);
    assert.ok(out.body().toString('utf8').startsWith(`﻿${TIME_LOGGED_EXPORT_LABELS.de.team};`), 'German, the stored locale');
    assert.equal(file.calls.find((call) => call.sql.includes('UNION ALL'))!.params[2], 'UTC');
  }

  // An unknown team id: refused by neither route; both match nothing for it.
  {
    const out = fakeResponse();
    await controller.exportTimeLogged({ teamIds: 'nobody', language: 'en' }, ctx(stubManager().manager), out.res);
    assert.ok(out.body().length > 0);
  }

  // Refused: unknown parameter, a horizon the screen does not offer, a zone nobody knows, other values.
  for (const [query, message] of [
    [{ months: '6', sort: 'name' }, /Unknown parameter: sort/],
    [{ months: '24' }, /months must be one of 6, 12/],
    [{ tz: 'Mars/Olympus' }, /tz must be a known time zone/],
    [{ format: 'pdf' }, /format must be csv or xlsx/],
    [{ language: 'it' }, /language must be en, fr, de or es/],
    [{ table: 'time-logged' }, /Unknown parameter: table/],
    [{ teamIds: ['a', 'b'] }, /teamIds must be given once/],
  ] as Array<[Record<string, unknown>, RegExp]>) {
    await assert.rejects(
      () => controller.exportTimeLogged(query, ctx(stubManager().manager), fakeResponse().res),
      (error: any) => error.getStatus?.() === 400 && message.test(error.message),
      JSON.stringify(query),
    );
  }

  assertLocaleLabels('portfolio', TIME_LOGGED_EXPORT_KEYS, TIME_LOGGED_EXPORT_LABELS);
  console.log('portfolio-time-logged-export.spec: OK');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
