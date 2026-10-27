import * as assert from 'node:assert/strict';
import AdmZip = require('adm-zip');
import { assertLocaleLabels } from '../../common/report-export/__tests__/locale-labels';
import { TeamMemberConfigController } from '../team-member-config.controller';
import { SKILLS_MATRIX_EXPORT_KEYS, SKILLS_MATRIX_EXPORT_LABELS } from '../services/skills-matrix-export';
// The screen's own code, from the frontend tree: the export must give the grid it computes.
import { filterContributorsByEmploymentType } from '../../../../frontend/src/pages/portfolio/contributorsOrdering';
import { buildSkillsMatrix, contributorSummary, orientSkillsMatrix } from '../../../../frontend/src/pages/portfolio/skillsMatrix';

/**
 * The skills matrix export (`GET /portfolio/team-members/skills-matrix/export`) against the screen: from the
 * same three answers (`GET /portfolio/team-members`, `/portfolio/teams`, `/portfolio/skills`), its rows are the
 * grid the screen's module computes, in both orientations, with a hidden category whose name holds a comma.
 * Then the Parameters sheet, the refused requests (400) and the labels against `portfolio.json`.
 */

const TENANT = '00000000-0000-0000-0000-000000000001';
const APPS = '11111111-1111-4111-8111-111111111111';
const DATA = '22222222-2222-4222-8222-222222222222';
const EMPLOYEE = '33333333-3333-4333-8333-333333333333';
const CONTRACTOR = '44444444-4444-4444-8444-444444444444';

// The three answers, as the API sends them (the order of `GET /portfolio/team-members`: first name, last name).
const members = [
  { id: 'c-ann', item_number: 3, user_display_name: 'Ann Durand', user_email: 'ann@example.invalid', team_id: APPS, employment_type_id: EMPLOYEE,
    skills: [{ skill_id: 's-sql', proficiency: 4 }, { skill_id: 's-java', proficiency: 2 }, { skill_id: 's-bi', proficiency: 3 }] },
  { id: 'c-bob', item_number: 7, user_display_name: 'Bob Klein', user_email: 'bob@example.invalid', team_id: DATA, employment_type_id: CONTRACTOR,
    skills: [{ skill_id: 's-sql', proficiency: 3 }, { skill_id: 's-bi', proficiency: 0 }] },
  { id: 'c-cyd', item_number: 9, user_display_name: '', user_email: 'cyd@example.invalid', team_id: null, employment_type_id: EMPLOYEE,
    skills: [{ skill_id: 's-java', proficiency: 3 }] },
];
const teams = [{ id: DATA, name: 'Data' }, { id: APPS, name: 'Applications' }];
const skills = [
  { id: 's-sql', category: 'Data, analytics', name: 'SQL', enabled: true },
  { id: 's-bi', category: 'Data, analytics', name: 'BI', enabled: true },
  { id: 's-java', category: 'Development', name: 'Java', enabled: true },
  { id: 's-go', category: 'Development', name: 'Go', enabled: true },
  { id: 's-old', category: 'Development', name: 'Cobol', enabled: false },
];

const manager = {
  query: async (sql: string, params?: unknown[]) => {
    if (sql.includes('FROM portfolio_employment_types')) return params?.[1] === EMPLOYEE ? [{ name: 'Employee' }] : [];
    if (sql.includes('split_part(email')) return [{ name: 'Claire Martin' }];
    if (sql.includes('user_notification_preferences')) return [];
    throw new Error(`Unexpected statement: ${sql}`);
  },
} as any;
const ctx = { tenantId: TENANT, userId: 'user-1', userRoles: [], manager } as any;

const controller = () => new TeamMemberConfigController(
  { list: async () => ({ items: members }) } as any,
  {} as any,
  { list: async () => teams } as any,
  { list: async () => ({ items: skills }) } as any,
);

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

async function exportCsv(query: Record<string, unknown>) {
  const out = fakeResponse();
  await controller().exportSkillsMatrix({ language: 'en', tz: 'UTC', ...query }, ctx, out.res);
  return csvRows(out.body());
}

/** What the screen draws for the same answers and filters, written as the export's cells. */
function screenGrid(p: { teamId: string; employmentTypeId: string; orientation: 'contributors' | 'skills'; showUnused: boolean; hiddenCategories: string[] }) {
  const en = SKILLS_MATRIX_EXPORT_LABELS.en;
  const matrix = buildSkillsMatrix({
    contributors: filterContributorsByEmploymentType(members, p.employmentTypeId),
    teams,
    skills,
    teamId: p.teamId,
    showUnused: p.showUnused,
    hiddenCategories: p.hiddenCategories,
    words: { unassigned: en.unassigned, unknownTeam: en.unknownTeam },
    compare: new Intl.Collator('en').compare,
  });
  const { columns, rows, levelAt } = orientSkillsMatrix(matrix, p.orientation);
  const summary = (axis: typeof rows, index: number) => (axis.kind === 'contributor'
    ? contributorSummary(axis.entries[index].counts)
    : String(axis.entries[index].counts.autonomous));
  const lead = rows.kind === 'contributor' ? [en.contributor, en.reference, en.team] : [en.category, en.skill];
  const header = [...lead, ...columns.entries.map((entry) => entry.label), rows.kind === 'contributor' ? en.summaryColumn : en.coverageRow];
  const body = rows.entries.map((entry, index) => [
    ...(entry.kind === 'contributor' ? [entry.label, `CTR-${entry.itemNumber}`, entry.teamLabel] : [entry.category, entry.label]),
    ...columns.entries.map((column) => String(levelAt(entry.id, column.id) ?? '')),
    summary(rows, index),
  ]);
  const footer = [columns.kind === 'contributor' ? en.summaryColumn : en.coverageRow, ...lead.slice(1).map(() => ''),
    ...columns.entries.map((_, index) => summary(columns, index)), ''];
  return [header, ...body, footer];
}

async function testRowsFollowTheScreen() {
  // Contributors in the columns (the default): the skills of the shown categories with a declared level.
  const byDefault = await exportCsv({});
  assert.deepEqual(byDefault, screenGrid({ teamId: 'all', employmentTypeId: 'all', orientation: 'contributors', showUnused: false, hiddenCategories: [] }));
  assert.deepEqual(byDefault, [
    ['Category', 'Skill', 'Ann Durand', 'Bob Klein', 'cyd@example.invalid', 'Autonomous or expert'],
    ['Data, analytics', 'BI', '3', '1', '', '1'],
    ['Data, analytics', 'SQL', '4', '3', '', '2'],
    ['Development', 'Java', '2', '', '3', '1'],
    ['Skills', '', '2/3', '1/2', '1/1', ''],
  ], 'teams alphabetically, unassigned last; a level 0 reads as 1; Go and the disabled Cobol left out');

  // Skills in the columns, the category with a comma hidden, unused skills shown, one contract type.
  const params = { orientation: 'skills', showUnused: 'true', hiddenCategories: JSON.stringify(['Data, analytics']), employmentTypeId: EMPLOYEE } as const;
  const turned = await exportCsv(params);
  assert.deepEqual(turned, screenGrid({ teamId: 'all', employmentTypeId: EMPLOYEE, orientation: 'skills', showUnused: true, hiddenCategories: ['Data, analytics'] }));
  assert.deepEqual(turned, [
    ['Contributor', 'Reference', 'Team', 'Go', 'Java', 'Skills'],
    ['Ann Durand', 'CTR-3', 'Applications', '', '2', '0/1'],
    ['cyd@example.invalid', 'CTR-9', 'Unassigned', '', '3', '1/1'],
    ['Autonomous or expert', '', '', '0', '1', ''],
  ]);

  // One team: its people only, the coverage counted on them.
  assert.deepEqual(
    await exportCsv({ teamId: DATA }),
    screenGrid({ teamId: DATA, employmentTypeId: 'all', orientation: 'contributors', showUnused: false, hiddenCategories: [] }),
  );
  assert.deepEqual(
    await exportCsv({ teamId: 'unassigned', orientation: 'skills' }),
    screenGrid({ teamId: 'unassigned', employmentTypeId: 'all', orientation: 'skills', showUnused: false, hiddenCategories: [] }),
  );
}

async function testWorkbook() {
  const out = fakeResponse();
  await controller().exportSkillsMatrix(
    { format: 'xlsx', language: 'fr', tz: 'Europe/Paris', orientation: 'skills', hiddenCategories: JSON.stringify(['Data, analytics']), employmentTypeId: EMPLOYEE },
    ctx,
    out.res,
  );
  assert.match(out.headers['Content-Disposition'], /skills-matrix-\d{4}-\d{2}-\d{2}\.xlsx/);
  const zip = new AdmZip(out.body());
  const names = [...zip.readAsText('xl/workbook.xml').matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(names, ['Matrice de compétences', 'Paramètres']);
  const sheet = zip.readAsText('xl/worksheets/sheet1.xml');
  assert.ok(sheet.includes('<c r="D2"><v>2</v></c>'), 'a level is a number');
  assert.ok(sheet.includes('<t xml:space="preserve">0/1</t>'), 'the contributor summary is text');
  const parameters = [...zip.readAsText('xl/worksheets/sheet2.xml').matchAll(/<t xml:space="preserve">([^<]*)<\/t>/g)].map((m) => m[1]);
  assert.deepEqual(parameters.slice(2, 12), [
    'Équipe', 'Toutes les équipes',
    'Type de contrat', 'Employee',
    'Colonnes', 'Compétences',
    'Afficher les compétences non utilisées', 'Non',
    'Catégories masquées', 'Data, analytics',
  ]);
}

async function testRefused() {
  for (const [query, message] of [
    [{ orientation: 'rows' }, /orientation must be one of contributors, skills/],
    [{ showUnused: 'yes' }, /showUnused must be true or false/],
    [{ hiddenCategories: 'Data, analytics' }, /hiddenCategories must be a JSON list/],
    [{ hiddenCategories: JSON.stringify([3]) }, /hiddenCategories must be a JSON list/],
    [{ teamId: 'apps' }, /teamId must be/],
    [{ teamId: '55555555-5555-4555-8555-555555555555' }, /teamId is not a team/],
    [{ employmentTypeId: CONTRACTOR }, /employmentTypeId is not a contract type/],
    [{ employmentTypeId: 'employees' }, /employmentTypeId must be/],
    [{ teamId: ['all', 'all'] }, /teamId must be given once/],
    [{ table: 'matrix' }, /Unknown parameter: table/],
    [{ format: 'ods' }, /format must be csv or xlsx/],
  ] as Array<[Record<string, unknown>, RegExp]>) {
    await assert.rejects(
      () => controller().exportSkillsMatrix({ language: 'en', ...query }, ctx, fakeResponse().res),
      (error: any) => error.getStatus?.() === 400 && message.test(error.message),
      JSON.stringify(query),
    );
  }
}

async function run() {
  await testRowsFollowTheScreen();
  await testWorkbook();
  await testRefused();
  assertLocaleLabels('portfolio', SKILLS_MATRIX_EXPORT_KEYS, SKILLS_MATRIX_EXPORT_LABELS);
  console.log('skills-matrix-export.spec: OK');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
