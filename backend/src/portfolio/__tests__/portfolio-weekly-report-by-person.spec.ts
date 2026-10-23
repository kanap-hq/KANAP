import * as assert from 'node:assert/strict';
import AdmZip = require('adm-zip');
import { PortfolioWeeklyReportService } from '../services/portfolio-weekly-report.service';

/**
 * The by-person reading of the weekly report: who created, who touched and who carried a task
 * when it closed, plus the days each person logged. The statements are stubbed, so what is
 * checked here is the attribution and the grouping, not the SQL planner.
 */

const TENANT = '44dd2037-a4a7-4943-8b63-5b2c95cff52b';

const taskRow = (over: Record<string, any> = {}) => ({
  record_id: over.record_id ?? 'task-1',
  name: over.name ?? 'Tune the cellar probes',
  item_number: over.item_number ?? 1,
  source_id: null,
  source_name: null,
  category_id: null,
  category_name: null,
  stream_id: null,
  stream_name: null,
  status: 'open',
  live_created_day: '2026-09-01',
  created_day: null,
  modified_day: null,
  closed_day: null,
  update_count: 0,
  status_from: null,
  status_to: null,
  changed_fields: [],
  priority: 70,
  task_type_id: null,
  task_type_name: null,
  creator_user_id: null,
  modifier_user_ids: [],
  closing_assignee_id: null,
  ...over,
});

type Call = { sql: string; params: any[] };

function stub(tasks: any[], hours: any[], people: any[]) {
  const calls: Call[] = [];
  const manager: any = {
    query: async (sql: string, params: any[]) => {
      calls.push({ sql, params });
      if (sql.includes('JOIN tasks t ON t.id = a.record_id')) return tasks;
      if (sql.includes('task_time_entries tte')) return hours;
      if (sql.includes('FROM users u')) return people;
      return [];
    },
  };
  return { manager, calls };
}

const baseQuery = {
  tenantId: TENANT,
  startDate: '2026-09-14',
  endDate: '2026-09-20',
  timeZone: 'Europe/Paris',
  groupBy: 'person' as const,
};

async function run() {
  /* ---------------------------------------------------------------- */
  /*  Attribution of the three lists                                  */
  /* ---------------------------------------------------------------- */

  const rows = [
    // Created by Thomas, still open.
    taskRow({ record_id: 't1', item_number: 1, created_day: '2026-09-15', creator_user_id: 'u-thomas' }),
    // Modified by Thomas and Isabelle: it belongs to both.
    taskRow({
      record_id: 't2',
      item_number: 2,
      modified_day: '2026-09-16',
      update_count: 2,
      modifier_user_ids: ['u-thomas', 'u-isabelle'],
    }),
    // Closed while assigned to Isabelle, whoever clicked.
    taskRow({
      record_id: 't3',
      item_number: 3,
      closed_day: '2026-09-17',
      status: 'done',
      closing_assignee_id: 'u-isabelle',
    }),
    // Closed with nobody on it.
    taskRow({ record_id: 't4', item_number: 4, closed_day: '2026-09-18', status: 'done', closing_assignee_id: null }),
    // Created by an import: no actor at all.
    taskRow({ record_id: 't5', item_number: 5, created_day: '2026-09-15', creator_user_id: null }),
    // Modified with no actor either.
    taskRow({ record_id: 't6', item_number: 6, modified_day: '2026-09-16', update_count: 1, modifier_user_ids: [] }),
  ];

  const hours = [
    // 12 hours of project work and 4 of anything else: 1.5 day and 0.5 day.
    { user_id: 'u-isabelle', project_hours: '12', other_hours: '4' },
    // Someone who logged time but carried no task event still shows up.
    { user_id: 'u-marc', project_hours: '0', other_hours: '6' },
  ];

  const people = [
    { user_id: 'u-thomas', name: 'Thomas Berger', item_number: 3, team_id: 'team-ops', team_name: 'Operations' },
    { user_id: 'u-isabelle', name: 'Isabelle Moreau', item_number: 7, team_id: 'team-ops', team_name: 'Operations' },
    // No contributor profile: no team, no CTR reference.
    { user_id: 'u-marc', name: 'Marc Dupond', item_number: null, team_id: null, team_name: null },
  ];

  const { manager, calls } = stub(rows, hours, people);
  const svc = new PortfolioWeeklyReportService();
  const result = await svc.list(baseQuery, { manager });

  const byPerson = result.byPerson;
  assert.ok(byPerson, 'person mode returns the by-person block');

  // The by-type lists are untouched: they still carry every row.
  assert.equal(result.tasks.created.length, 2);
  assert.equal(result.tasks.modified.length, 2);
  assert.equal(result.tasks.closed.length, 2);

  const teams = byPerson!.teams;
  assert.deepEqual(teams.map((team) => team.teamName), ['Operations', null], 'no team comes last');

  const ops = teams[0];
  assert.deepEqual(ops.members.map((member) => member.name), ['Isabelle Moreau', 'Thomas Berger'], 'alphabetical');

  const isabelle = ops.members[0];
  const thomas = ops.members[1];

  assert.deepEqual(thomas.created.map((row) => row.ref), ['T-1'], 'created goes to the creation actor');
  assert.deepEqual(thomas.modified.map((row) => row.ref), ['T-2']);
  assert.deepEqual(thomas.closed, [], 'closing is never the actor');
  assert.equal(thomas.contributorRef, 'CTR-3');

  assert.deepEqual(isabelle.modified.map((row) => row.ref), ['T-2'], 'two actors, two entries');
  assert.deepEqual(isabelle.closed.map((row) => row.ref), ['T-3'], 'closed goes to the assignee of the event');

  // 12h project + 4h other on an eight-hour day.
  assert.deepEqual(isabelle.loggedDays, { project: 1.5, other: 0.5, total: 2 });
  assert.deepEqual(thomas.loggedDays, { project: 0, other: 0, total: 0 });

  assert.deepEqual(ops.totals, { created: 1, modified: 2, closed: 1, loggedDays: 2 });

  const noTeam = teams[1];
  assert.equal(noTeam.teamId, null);
  assert.deepEqual(noTeam.members.map((member) => member.name), ['Marc Dupond']);
  assert.equal(noTeam.members[0].contributorRef, null, 'no contributor profile, no reference');
  assert.deepEqual(noTeam.members[0].loggedDays, { project: 0, other: 0.8, total: 0.8 });

  assert.deepEqual(byPerson!.unassigned.created.map((row) => row.ref), ['T-5']);
  assert.deepEqual(byPerson!.unassigned.modified.map((row) => row.ref), ['T-6']);
  assert.deepEqual(byPerson!.unassigned.closed.map((row) => row.ref), ['T-4']);

  /* ---------------------------------------------------------------- */
  /*  The sums the view promises                                      */
  /* ---------------------------------------------------------------- */

  const sumOf = (key: 'created' | 'modified' | 'closed') =>
    teams.reduce((total, team) => total + team.totals[key], 0) + byPerson!.unassigned[key].length;

  assert.equal(sumOf('created'), result.tasks.created.length, 'created by person plus unassigned = created');
  assert.equal(sumOf('closed'), result.tasks.closed.length, 'closed by person plus unassigned = closed');
  assert.ok(sumOf('modified') >= result.tasks.modified.length, 'modified may exceed: several actors');
  assert.equal(sumOf('modified'), 3, 'one task counted twice, one unassigned');

  /* ---------------------------------------------------------------- */
  /*  Statements                                                      */
  /* ---------------------------------------------------------------- */

  assert.equal(calls.length, 5, 'three entity statements plus time and people: no query per person');
  for (const call of calls) {
    assert.equal(call.params[0], TENANT, 'every statement is filtered on the tenant');
    assert.ok(call.sql.includes('tenant_id = $1'), 'every statement carries the tenant predicate');
  }

  const taskCall = calls[2];
  assert.ok(taskCall.sql.includes('COALESCE(cr.user_id::text, t.creator_id::text) AS creator_user_id'));
  assert.ok(taskCall.sql.includes("pe.after_json->>'assignee_user_id' AS assignee_user_id"));
  assert.ok(taskCall.sql.includes('array_agg(DISTINCT pe.user_id::text)'));

  const peopleCall = calls[4];
  assert.ok(peopleCall.sql.includes('u.id::text = ANY($2::text[])'), 'people are read in one batch');
  assert.deepEqual(
    [...(peopleCall.params[1] as string[])].sort(),
    ['u-isabelle', 'u-marc', 'u-thomas'],
    'everyone in a list or with logged time is read',
  );

  /* ---------------------------------------------------------------- */
  /*  By type is untouched                                            */
  /* ---------------------------------------------------------------- */

  const plain = stub(rows, hours, people);
  const typeResult = await svc.list({ ...baseQuery, groupBy: 'type' }, { manager: plain.manager });
  assert.equal(typeResult.byPerson, undefined, 'by type returns no person block');
  assert.equal(plain.calls.length, 3, 'by type reads no person statement');
  assert.ok(!plain.calls[2].sql.includes('creator_user_id'), 'the person columns are person mode only');

  /* ---------------------------------------------------------------- */
  /*  Export                                                          */
  /* ---------------------------------------------------------------- */

  const exportStub = stub(rows, hours, people);
  const csv = await svc.exportCsv(baseQuery, { manager: exportStub.manager, language: 'en' });
  assert.ok(csv.content.includes('Tasks by person'));
  assert.ok(csv.content.includes('Team,Person,List,Reference,Task name'));
  assert.ok(csv.content.includes('Operations,Thomas Berger,Created,T-1,'));
  assert.ok(csv.content.includes('Operations,Isabelle Moreau,Modified,T-2,'));
  assert.ok(csv.content.includes('Operations,Isabelle Moreau,Closed,T-3,'));
  assert.ok(csv.content.includes(',Unassigned,Closed,T-4,'));
  assert.ok(csv.content.includes(',2026-09-15'), 'English: ISO days');
  assert.ok(!csv.content.includes('Tasks created'), 'the three task blocks give way to the person block');
  assert.ok(csv.content.includes('Requests created'), 'requests and projects are untouched');

  // The words, the days and the separator follow the screen language.
  const french = (await svc.exportCsv(baseQuery, { manager: stub(rows, hours, people).manager, language: 'fr' })).content;
  assert.ok(french.includes('Tâches par personne'), 'French: the block title');
  assert.ok(french.includes('Équipe;Personne;Liste;Référence;Nom de la tâche'), 'French: the headers');
  assert.ok(french.includes('Operations;Thomas Berger;Créations;T-1;'), 'French: the list');
  assert.ok(french.includes(';Non affectées;Clôtures;T-4;'), 'French: unassigned');
  assert.ok(french.includes(';15/09/2026') && !french.includes('2026-09-15'), 'French: the days');
  assert.ok(french.includes('Demandes créées'), 'French: the request block');
  const german = (await svc.exportCsv(baseQuery, { manager: stub(rows, hours, people).manager, language: 'de' })).content;
  assert.ok(german.includes('Team;Person;Liste;Referenz;Aufgabenname') && german.includes(';15.09.2026'), 'German');
  const spanish = (await svc.exportCsv(baseQuery, { manager: stub(rows, hours, people).manager, language: 'es' })).content;
  assert.ok(spanish.includes('Equipo;Persona;Lista;Referencia;Nombre de la tarea') && spanish.includes('Tareas por persona'), 'Spanish');

  // The XLSX follows it too: sheet names, headers, list words and days.
  const xlsx = await svc.exportXlsx(baseQuery, null, { manager: stub(rows, hours, people).manager, language: 'fr' });
  const zip = new AdmZip(xlsx.content);
  const workbook = zip.readAsText('xl/workbook.xml');
  assert.ok(workbook.includes('name="Tâches"') && workbook.includes('name="Demandes"'), 'French sheet names');
  const sheets = zip.getEntries().filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.entryName)).map((entry) => entry.getData().toString('utf8')).join('');
  for (const text of ['Équipe', 'Personne', 'Créations', 'Non affectées', 'Événement']) {
    assert.ok(sheets.includes(text), `French XLSX writes ${text}`);
  }
  assert.ok(!sheets.includes('2026-09-15') && !sheets.includes('15/09/2026'), 'French XLSX: no day written as text');

  // Days are date cells: the serial (days since 1899-12-30) with the date style, in the language's format.
  assert.match(sheets, /<c r="[A-Z]+\d+" s="1"><v>46280<\/v><\/c>/, 'French XLSX: 2026-09-15 is a date cell');
  assert.ok(!/t="inlineStr"><is><t xml:space="preserve">\d{2}\/\d{2}\/\d{4}</.test(sheets), 'French XLSX: no text date');
  assert.match(sheets, /<cols><col min="\d+" max="\d+" width="12" customWidth="1"\/>/, 'French XLSX: date columns wide enough');
  const styles = zip.readAsText('xl/styles.xml');
  assert.ok(styles.includes('<numFmt numFmtId="164" formatCode="[$-40C]dd/mm/yyyy"/>'), 'French XLSX: the date format');
  assert.ok(/<cellXfs count="2">.*<xf numFmtId="164"[^>]*applyNumberFormat="1"\/><\/cellXfs>/.test(styles), 'French XLSX: style 1 is the date');
  assert.ok(zip.readAsText('xl/_rels/workbook.xml.rels').includes('Target="styles.xml"'), 'French XLSX: styles relationship');
  assert.ok(
    zip.readAsText('[Content_Types].xml').includes('<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'),
    'French XLSX: styles content type',
  );
  const englishXlsx = await svc.exportXlsx(baseQuery, null, { manager: stub(rows, hours, people).manager, language: 'en' });
  assert.ok(new AdmZip(englishXlsx.content).readAsText('xl/styles.xml').includes('formatCode="yyyy-mm-dd"'), 'English XLSX: ISO date format');

  const typeExport = stub(rows, hours, people);
  const typeCsv = await svc.exportCsv({ ...baseQuery, groupBy: 'type' }, { manager: typeExport.manager });
  assert.ok(typeCsv.content.includes('Tasks created'));
  assert.ok(!typeCsv.content.includes('Tasks by person'));

  console.log('portfolio-weekly-report-by-person.spec.ts: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
