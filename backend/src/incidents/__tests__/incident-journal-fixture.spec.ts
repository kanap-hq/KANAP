import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseString } from '@fast-csv/parse';
import { backendPath } from '../../common/__tests__/backend-root';
import { instantInTimeZone, readTimeZoneHeader } from '../../common/csv-sheet';

// The incident part of the Fromage & Co fixture: the register keeps its ten rows and their order,
// the six reviews that have one follow the five headings of the model, the journal file is signed
// by the incident people and backdated to the facts, and the corrective tasks point at INC-2,
// INC-3 and INC-4. The demo loader runs the same files, so what this spec checks is what a new
// trial tenant receives.

const FIXTURES = backendPath('fixtures', 'fromage-co');
const HEADINGS = ['Detailed description', 'Impact', 'Root cause', 'Corrective actions', 'Lessons learned'];
const STATUSES = new Set(['open', 'in_progress', 'resolved', 'closed', 'cancelled']);
const SEVERITIES = new Set(['critical', 'major', 'minor', 'low']);

const INCIDENT_TITLES = [
  'Cave B humidity readings lost overnight',
  'Phishing campaign against accounts payable',
  'SAP month-end close slowed down by host memory contention',
  'B2B portal down: database disk full',
  'Order confirmations sent to the wrong customers',
  'Veeam backup jobs failing on the backup SAN',
  'CheeseTrack offline during SQL Server cluster failover',
  'Microsoft Teams outage in Western Europe',
  'Lab results cannot be saved in QualityLab LIMS',
  'VPN to the Gouda site keeps dropping',
];

const REVIEWED = [
  'Cave B humidity readings lost overnight',
  'Phishing campaign against accounts payable',
  'SAP month-end close slowed down by host memory contention',
  'B2B portal down: database disk full',
  'Order confirmations sent to the wrong customers',
  'Lab results cannot be saved in QualityLab LIMS',
];

/** The applications an incident names in setup-tenant.mjs: their owners are the incident team. */
const LINKED_APPLICATIONS: Record<string, string[]> = {
  'INC-4': ['Fromage B2B Portal'],
  'INC-3': ['SAP S/4HANA', 'SAP BW/4HANA'],
  'INC-9': ['QualityLab LIMS'],
};

type CsvRow = Record<string, string>;

function readCsv(name: string): Promise<CsvRow[]> {
  const text = fs.readFileSync(path.join(FIXTURES, name), 'utf8');
  return new Promise((resolve, reject) => {
    const rows: CsvRow[] = [];
    parseString(text, {
      headers: (headers) =>
        headers.map((header) => {
          const label = String(header ?? '').trim();
          const named = readTimeZoneHeader(label);
          return named ? named.column : label;
        }),
      delimiter: ';',
      ignoreEmpty: true,
      trim: true,
    })
      .on('data', (row: CsvRow) => rows.push(row))
      .on('error', reject)
      .on('end', () => resolve(rows));
  });
}

function lower(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function reviewHeadings(review: string): string[] {
  return review
    .split(/\r?\n/)
    .filter((line) => /^##\s+/.test(line))
    .map((line) => line.replace(/^##\s+/, '').trim());
}

function occurredAt(entry: CsvRow): number {
  const [date, time] = String(entry.occurred_at ?? '').split(' ');
  assert.ok(date && time, `occurred_at: ${entry.occurred_at}`);
  return instantInTimeZone(date, time, 'Europe/Paris').getTime();
}

function applicationOwners(applications: CsvRow[]): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const application of applications) {
    const emails = [1, 2, 3, 4]
      .flatMap((index) => [
        application[`business_owner_email_${index}`],
        application[`it_owner_email_${index}`],
      ])
      .map(lower)
      .filter(Boolean);
    owners.set(application.name, emails);
  }
  return owners;
}

async function run(): Promise<void> {
  const incidents = await readCsv('31-incidents.csv');
  assert.equal(incidents.length, 10, 'ten incident rows');
  assert.deepEqual(incidents.map((incident) => incident.title), INCIDENT_TITLES, 'same rows, same order');
  const byRef = new Map(incidents.map((incident, index) => [`INC-${index + 1}`, incident]));
  assert.equal(byRef.get('INC-4')?.title, 'B2B portal down: database disk full', 'INC-4 is the B2B portal');

  for (const title of REVIEWED) {
    const review = String(incidents.find((incident) => incident.title === title)?.review ?? '');
    assert.deepEqual(reviewHeadings(review), HEADINGS, `${title}: the five headings of the model`);
    assert.ok(!/^##\s+(Summary|Actions)\s*$/m.test(review), `${title}: no heading of the old four-part review`);
  }
  assert.match(String(byRef.get('INC-1')?.review), /CAVE-GW-02[\s\S]*18 sensors[\s\S]*82%/, 'Cave B keeps its facts');
  assert.match(String(byRef.get('INC-4')?.review), /WAL[\s\S]*PAR-DB-01[\s\S]*140 orders[\s\S]*PostgreSQL 13/, 'the B2B review keeps its facts');
  assert.match(String(byRef.get('INC-9')?.review), /Under investigation[\s\S]*10 GB/, 'the LIMS review is partial');

  const users = await readCsv('10-users.csv');
  const knownUsers = new Set(users.map((user) => lower(user.email)));
  const ownersByApplication = applicationOwners(await readCsv('12-applications.csv'));

  const journal = await readCsv('32-incident-journal.csv');
  assert.ok(journal.length >= 12, 'the journal file carries the three stories');
  const now = Date.now();
  for (const [index, entry] of journal.entries()) {
    assert.ok(byRef.has(entry.incident_ref), `row ${index + 2}: a known incident reference`);
    assert.equal(entry.incident_title, byRef.get(entry.incident_ref)?.title, `row ${index + 2}: the title matches the reference`);
    assert.ok(knownUsers.has(lower(entry.author_email)), `row ${index + 2}: ${entry.author_email} is in 10-users.csv`);
    assert.ok(occurredAt(entry) < now, `row ${index + 2}: the entry is backdated`);

    const incident = byRef.get(entry.incident_ref)!;
    const role = lower(entry.author_role);
    const reporter = lower(incident.reporter);
    const owner = lower(incident.owner);
    const team = (LINKED_APPLICATIONS[entry.incident_ref] ?? []).flatMap((name) => ownersByApplication.get(name) ?? []);
    assert.ok([reporter, owner, ...team].includes(lower(entry.author_email)), `row ${index + 2}: an incident person`);
    if (role === 'reporter') assert.equal(lower(entry.author_email), reporter, `row ${index + 2}: the reporter`);
    if (role === 'owner') assert.equal(lower(entry.author_email), owner, `row ${index + 2}: the owner`);
    if (role === 'team') assert.ok(team.includes(lower(entry.author_email)), `row ${index + 2}: a member of the application team`);

    if (entry.kind === 'note') {
      assert.ok(entry.content.length > 0, `row ${index + 2}: a note has content`);
      assert.ok(!entry.status_from && !entry.status_to && !entry.severity_from && !entry.severity_to, `row ${index + 2}: a note carries no change`);
    } else if (entry.kind === 'status_change') {
      assert.ok(STATUSES.has(lower(entry.status_from)), `row ${index + 2}: a known status from`);
      assert.ok(STATUSES.has(lower(entry.status_to)), `row ${index + 2}: a known status to`);
      assert.notEqual(lower(entry.status_from), lower(entry.status_to), `row ${index + 2}: the status changes`);
      assert.ok(!entry.severity_from && !entry.severity_to, `row ${index + 2}: no severity in a status change`);
    } else {
      assert.equal(entry.kind, 'severity_change', `row ${index + 2}: a known kind`);
      assert.ok(SEVERITIES.has(lower(entry.severity_from)), `row ${index + 2}: a known severity from`);
      assert.ok(SEVERITIES.has(lower(entry.severity_to)), `row ${index + 2}: a known severity to`);
      assert.notEqual(lower(entry.severity_from), lower(entry.severity_to), `row ${index + 2}: the severity changes`);
      assert.ok(!entry.status_from && !entry.status_to, `row ${index + 2}: no status in a severity change`);
    }
  }

  for (const ref of ['INC-4', 'INC-3', 'INC-9']) {
    const entries = journal.filter((entry) => entry.incident_ref === ref);
    assert.ok(entries.filter((entry) => entry.kind === 'note').length >= 2, `${ref}: notes at the facts`);
    assert.ok(entries.filter((entry) => entry.kind === 'status_change').length >= 1, `${ref}: a status change`);
    assert.equal(entries.filter((entry) => entry.kind === 'severity_change').length, 1, `${ref}: one severity change`);
    assert.deepEqual(
      entries.filter((entry) => entry.kind === 'status_change').map((entry) => `${lower(entry.status_from)}->${lower(entry.status_to)}`),
      ref === 'INC-9' ? ['open->in_progress'] : ['open->in_progress', 'in_progress->resolved'],
      `${ref}: the status story`,
    );
    assert.deepEqual(
      entries.filter((entry) => entry.kind === 'severity_change').map((entry) => `${lower(entry.severity_from)}->${lower(entry.severity_to)}`),
      ref === 'INC-4' ? ['major->critical'] : ['minor->major'],
      `${ref}: the severity story`,
    );
    assert.deepEqual(
      [entries[0]?.occurred_at, entries[entries.length - 1]?.occurred_at],
      {
        'INC-4': ['2026-06-02 07:52', '2026-06-02 11:10'],
        'INC-3': ['2026-04-30 16:10', '2026-05-06 11:00'],
        'INC-9': ['2026-10-14 10:05', '2026-10-19 14:00'],
      }[ref],
      `${ref}: the entries span the facts`,
    );
  }

  const tasks = await readCsv('19b-incident-tasks.csv');
  assert.deepEqual(tasks.map((task) => task.related_object_name), ['INC-4', 'INC-2', 'INC-3'], 'the corrective tasks of the B2B portal, the phishing campaign and the SAP close');
  for (const task of tasks) {
    assert.equal(task.related_object_type, 'incident', `${task.title}: linked to an incident`);
    const incident = byRef.get(task.related_object_name);
    assert.ok(incident, `${task.title}: the incident exists`);
    assert.ok(knownUsers.has(lower(task.assignee_email)), `${task.title}: a known assignee`);
    assert.ok([lower(incident.reporter), lower(incident.owner)].includes(lower(task.assignee_email)), `${task.title}: the assignee belongs to the incident`);
    assert.match(task.due_date, /^\d{4}-\d{2}-\d{2}$/, `${task.title}: a due date`);
  }

  console.log('incident-journal-fixture.spec.ts: ok');
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
