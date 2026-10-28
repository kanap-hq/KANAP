import * as assert from 'node:assert/strict';
import AdmZip = require('adm-zip');
import { assertLocaleLabels } from '../../common/report-export/__tests__/locale-labels';
import type { CapacityHeatmapResponse } from '../dto/capacity-heatmap.dto';
import { PortfolioCapacityReportController } from '../portfolio-capacity-report.controller';
import { CAPACITY_HEATMAP_EXPORT_KEYS, CAPACITY_HEATMAP_EXPORT_LABELS } from '../services/portfolio-capacity-heatmap-export';

/**
 * The capacity heatmap export against the heatmap it comes from: for the same parameters the export asks the
 * service exactly what the data route asks, and its two tables are the screen's grids of that result (the
 * screen's words, "N/A" as an empty cell, numbers as numbers). Then the Parameters sheet, refusals and labels.
 */

const TENANT = '00000000-0000-0000-0000-000000000001';
const TEAM_A = '11111111-1111-4111-8111-111111111111';

const heatmap = (filters: CapacityHeatmapResponse['filters']): CapacityHeatmapResponse => ({
  contributors: [
    { contributorId: 'u1', contributorName: 'Ann Durand', teamId: TEAM_A, teamName: 'Applications', remainingDays: 12.5, capacityDaysPerMonth: 10, capacitySource: 'historical', monthsOfWork: 1.3, colorBand: 'yellow', hasContributorProfile: true },
    { contributorId: 'u2', contributorName: 'Bob Klein', teamId: null, teamName: null, remainingDays: 4, capacityDaysPerMonth: null, capacitySource: null, monthsOfWork: null, colorBand: 'na', hasContributorProfile: true },
    { contributorId: 'u3', contributorName: 'Cyd Moreau', teamId: null, teamName: null, remainingDays: 3, capacityDaysPerMonth: null, capacitySource: null, monthsOfWork: null, colorBand: 'na', hasContributorProfile: false },
    { contributorId: 'u4', contributorName: 'Dee Roux', teamId: TEAM_A, teamName: 'Applications', remainingDays: 0, capacityDaysPerMonth: 8, capacitySource: 'theoretical', monthsOfWork: 0, colorBand: 'green', hasContributorProfile: true },
  ],
  teams: [
    { teamId: TEAM_A, teamName: 'Applications', memberCount: 2, remainingDays: 12.5, capacityDaysPerMonth: 18, monthsOfWork: 0.7, colorBand: 'green' },
    { teamId: 'no-team', teamName: null, memberCount: 2, remainingDays: 7, capacityDaysPerMonth: null, monthsOfWork: null, colorBand: 'na' },
  ],
  unassignedSummary: { totalProjects: 0, totalUnallocatedDays: 0 },
  unassignedProjects: [],
  filters,
});

function stubService() {
  const calls: any[] = [];
  const svc = {
    getHeatmap: async (tenantId: string, opts: any) => {
      calls.push({ tenantId, opts });
      return heatmap({
        teamIds: opts.teamFilter?.isActive ? [...opts.teamFilter.teamIds, ...(opts.teamFilter.includeNoTeam ? ['no-team'] : [])] : [],
        statuses: opts.statuses ?? ['waiting_list', 'planned', 'in_progress', 'in_testing', 'on_hold'],
        capacityMode: opts.capacityMode === 'theoretical' ? 'theoretical' : 'historical',
        groupBy: opts.groupBy === 'team' ? 'team' : 'contributor',
      });
    },
  };
  return { svc, calls };
}

const manager = {
  query: async (sql: string) => {
    if (sql.includes('FROM portfolio_teams')) return [{ name: 'Applications' }];
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

const unescape = (text: string) =>
  text.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const sheetNames = (zip: AdmZip) => [...zip.readAsText('xl/workbook.xml').matchAll(/<sheet name="([^"]*)"/g)].map((m) => unescape(m[1]));
const sheetRows = (xml: string): string[][] =>
  [...xml.matchAll(/<row r="\d+">(.*?)<\/row>/gs)].map((row) =>
    [...row[1].matchAll(/<c r="([A-Z]+)\d+"[^>]*>(?:<is><t xml:space="preserve">([^<]*)<\/t><\/is>|<v>([^<]*)<\/v>)<\/c>/g)]
      .reduce<string[]>((cells, m) => { cells[m[1].charCodeAt(0) - 65] = unescape(m[2] ?? m[3]); return cells; }, [])
      .map((cell) => cell ?? ''));

/** The screen's grids of a heatmap, written here from the result: "N/A" is an empty cell. */
function grids(result: CapacityHeatmapResponse, language: 'en' | 'fr') {
  const labels = CAPACITY_HEATMAP_EXPORT_LABELS[language];
  const n = (value: number | null) => (value == null ? '' : String(value));
  return {
    contributor: result.contributors.map((row) => [
      row.contributorName,
      row.hasContributorProfile === false ? labels.noContributorProfile : row.teamName || labels.noTeam,
      n(row.remainingDays),
      n(row.capacityDaysPerMonth),
      row.capacitySource ? labels[row.capacitySource] : '',
      n(row.monthsOfWork),
    ]),
    team: result.teams.map((row) => [row.teamId === 'no-team' || !row.teamName ? labels.noTeam : row.teamName, n(row.memberCount), n(row.remainingDays), n(row.capacityDaysPerMonth), n(row.monthsOfWork)]),
  };
}

async function run() {
  // xlsx, French: both groupings, the asked one first; the service gets what the data route sends.
  {
    const data = stubService();
    const result = await new PortfolioCapacityReportController(data.svc as any).getCapacityHeatmap(
      `${TEAM_A},no-team`, 'planned,in_progress', 'theoretical', 'team', { tenant: { id: TENANT }, queryRunner: { manager } },
    );
    const file = stubService();
    const out = fakeResponse();
    await new PortfolioCapacityReportController(file.svc as any).exportCapacityHeatmap(
      { teamIds: `${TEAM_A},no-team`, statuses: 'planned,in_progress', capacityMode: 'theoretical', groupBy: 'team', format: 'xlsx', language: 'fr' },
      ctx,
      out.res,
    );
    assert.deepEqual(file.calls[0].opts, data.calls[0].opts, 'the export asks the service what the data route asks');
    const zip = new AdmZip(out.body());
    const labels = CAPACITY_HEATMAP_EXPORT_LABELS.fr;
    assert.deepEqual(sheetNames(zip), [labels.teamSheet, labels.contributorSheet, 'Paramètres']);
    const expected = grids(result, 'fr');
    const teams = sheetRows(zip.readAsText('xl/worksheets/sheet1.xml'));
    assert.deepEqual(teams[0], [labels.team, labels.members, labels.remainingDays, labels.capacityPerMonth, labels.monthsOfWork]);
    assert.deepEqual(teams.slice(1), expected.team.map(trimEnd));
    const contributors = sheetRows(zip.readAsText('xl/worksheets/sheet2.xml'));
    assert.deepEqual(contributors.slice(1), expected.contributor.map(trimEnd));
    assert.ok(!zip.readAsText('xl/worksheets/sheet2.xml').includes('N/A'), 'no "N/A" text');
    // Days and months show two decimals (`0.00`, style 8); the member count stays General.
    const teamXml = zip.readAsText('xl/worksheets/sheet1.xml');
    const style = (ref: string) => / s="(\d+)"/.exec(new RegExp(`<c r="${ref}"([^>]*)>`).exec(teamXml)?.[1] ?? '')?.[1] ?? '';
    assert.deepEqual(['B2', 'C2', 'D2', 'E2'].map(style), ['', '8', '8', '8'], 'members General; days, capacity and months in 0.00');
    const parameters = sheetRows(zip.readAsText('xl/worksheets/sheet3.xml'));
    assert.deepEqual(parameters.slice(1, 4), [
      [labels.teamsFilter, `Applications, ${labels.noTeam}`],
      [labels.statusFilter, `${labels.status_planned}, ${labels.status_in_progress}`],
      [labels.source, labels.theoretical],
    ]);
    assert.equal(out.headers['Content-Disposition'].replace(/\d{4}-\d{2}-\d{2}/, 'DAY'), 'attachment; filename="capacity-heatmap-DAY.xlsx"');
  }

  // CSV, English, no parameter: the contributor grouping, the screen's defaults.
  {
    const data = stubService();
    const result = await new PortfolioCapacityReportController(data.svc as any).getCapacityHeatmap(undefined, undefined, undefined, undefined, { tenant: { id: TENANT }, queryRunner: { manager } });
    const file = stubService();
    const out = fakeResponse();
    await new PortfolioCapacityReportController(file.svc as any).exportCapacityHeatmap({ language: 'en' }, ctx, out.res);
    assert.deepEqual(file.calls[0].opts, data.calls[0].opts);
    const lines = out.body().toString('utf8').replace(/^﻿/, '').trimEnd().split('\n').map((line) => line.split(','));
    const labels = CAPACITY_HEATMAP_EXPORT_LABELS.en;
    assert.deepEqual(lines[0], [labels.contributor, labels.team, labels.remainingDays, labels.capacityPerMonth, labels.source, labels.monthsOfWork]);
    assert.deepEqual(lines.slice(1), grids(result, 'en').contributor);
    assert.deepEqual(lines[3], ['Cyd Moreau', 'No contributor profile', '3', '', '', ''], 'no profile, N/A as empty cells');
    assert.equal(out.headers['Content-Disposition'].replace(/\d{4}-\d{2}-\d{2}/, 'DAY'), 'attachment; filename="capacity-heatmap-contributor-DAY.csv"');
  }

  // Refused where the data route drops the value (a status) or fails on it (a team id that is not an id).
  for (const [query, message] of [
    [{ statuses: 'planned,closed' }, /statuses must be among/],
    [{ teamIds: 'team-apps' }, /teamIds must be team ids or no-team/],
    [{ capacityMode: 'average' }, /capacityMode must be historical or theoretical/],
    [{ groupBy: 'project' }, /groupBy must be contributor or team/],
    [{ table: 'team' }, /Unknown parameter: table/],
    [{ format: 'ods' }, /format must be csv or xlsx/],
  ] as Array<[Record<string, unknown>, RegExp]>) {
    await assert.rejects(
      () => new PortfolioCapacityReportController(stubService().svc as any).exportCapacityHeatmap({ language: 'en', ...query }, ctx, fakeResponse().res),
      (error: any) => error.getStatus?.() === 400 && message.test(error.message),
      JSON.stringify(query),
    );
  }

  assertLocaleLabels('portfolio', CAPACITY_HEATMAP_EXPORT_KEYS, CAPACITY_HEATMAP_EXPORT_LABELS);
  console.log('portfolio-capacity-heatmap-export.spec: OK');
}

/** A row read back from the sheet stops at its last written cell. */
function trimEnd(row: string[]): string[] {
  const out = [...row];
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
