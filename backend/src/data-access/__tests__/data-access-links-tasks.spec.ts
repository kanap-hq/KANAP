// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { APP_URL, LIMITED_ROLE, PgClient, appRoleName, connect, roleExists } from './data-access-test-helpers';
import {
  EXPECTED,
  LABELS,
  Label,
  LimitedPerson,
  Seed,
  applyPerson,
  seed as seedLines,
} from './data-access-line-seed';

/**
 * Data-scoped access, lot 2 run 2B (planning/data-scoped-access/spec.md §4.4, §5.4, §6.4, §6.6,
 * §10.1, §10.4, §10.5): the policies of the links to a line, of the tasks of lines and contracts,
 * of the task elements and links, and of the search index; the depth functions and the disclosure
 * functions. Lines and persons: data-access-line-seed.ts. One transaction, rolled back; each write
 * under a savepoint.
 *
 * Added here: contracts CF (FR, centre INF-FR), CE (ES, no centre, lines L1 and L5 through
 * contract_spend_items), CN (FR, Nina owner), C6 (FR, named by L6.contract_id); L5 is a CAPEX
 * line. Tasks: one per line (L5 as `capex_item`) and per contract, a project task, a standalone
 * task, and four tasks of L5 (invisible to Paul) where Paul is assignee, owner, observer or only
 * the creator. Every line is linked to an application, an asset, a technology, a project and a
 * request.
 *
 * Needs the role kanap_data_limited (CI installs it); skipped without it, failed in CI.
 */

type ContractLabel = 'CF' | 'CE' | 'CN' | 'C6';
const CONTRACTS: ContractLabel[] = ['CF', 'CE', 'CN', 'C6'];

/** Contracts each limited person reads (lisible_contrat) and modifies (modifiable_contrat). */
const CONTRACT_EXPECTED: Record<LimitedPerson, { readable: ContractLabel[]; modifiable: ContractLabel[] }> = {
  // Company ES: CE directly (and modifies it); CF is on INF-FR, outside its centres.
  marta: { readable: ['CE'], modifiable: ['CE'] },
  // INF read: CF by its centre, CE through L1; modifies nothing.
  paul: { readable: ['CF', 'CE'], modifiable: [] },
  // INF-FR edit: CF placable (centre INF-FR, company FR of that centre); CE read through L1.
  rita: { readable: ['CF', 'CE'], modifiable: ['CF'] },
  claire: { readable: CONTRACTS, modifiable: CONTRACTS },
  rob: { readable: CONTRACTS, modifiable: [] },
  // Owner of CN; C6 through the line it owns (L6.contract_id).
  nina: { readable: ['CN', 'C6'], modifiable: ['CN'] },
};

type TaskLabel =
  | 'tL1' | 'tL2' | 'tL3' | 'tL4' | 'tL5' | 'tL6'
  | 'tCF' | 'tCE' | 'tCN' | 'tC6'
  | 'tProject' | 'tFree'
  | 'tAssignee' | 'tOwner' | 'tViewer' | 'tCreator';

type TaskObject = { kind: 'line'; line: Label } | { kind: 'contract'; contract: ContractLabel } | { kind: 'other' };
type TaskSpec = { object: TaskObject; paul?: 'assignee' | 'owner' | 'viewer' | 'creator' };

const TASKS: Record<TaskLabel, TaskSpec> = {
  tL1: { object: { kind: 'line', line: 'L1' } },
  tL2: { object: { kind: 'line', line: 'L2' } },
  tL3: { object: { kind: 'line', line: 'L3' } },
  tL4: { object: { kind: 'line', line: 'L4' } },
  tL5: { object: { kind: 'line', line: 'L5' } },
  tL6: { object: { kind: 'line', line: 'L6' } },
  tCF: { object: { kind: 'contract', contract: 'CF' } },
  tCE: { object: { kind: 'contract', contract: 'CE' } },
  tCN: { object: { kind: 'contract', contract: 'CN' } },
  tC6: { object: { kind: 'contract', contract: 'C6' } },
  tProject: { object: { kind: 'other' } },
  tFree: { object: { kind: 'other' } },
  tAssignee: { object: { kind: 'line', line: 'L5' }, paul: 'assignee' },
  tOwner: { object: { kind: 'line', line: 'L5' }, paul: 'owner' },
  tViewer: { object: { kind: 'line', line: 'L5' }, paul: 'viewer' },
  tCreator: { object: { kind: 'line', line: 'L5' }, paul: 'creator' },
};
const TASK_LABELS = Object.keys(TASKS) as TaskLabel[];
const PERSONS = Object.keys(EXPECTED) as LimitedPerson[];

type Objects = { a: string; b: string };
type Seed2 = Seed & {
  contracts: Record<ContractLabel, string>;
  tasks: Record<TaskLabel, string>;
  application: Objects;
  asset: Objects;
  technology: Objects;
  project: Objects;
  request: Objects;
  documents: Objects;
};

let client: PgClient;
let taskNumber = 5000;

async function q(sql: string, params?: unknown[]): Promise<any[]> {
  return (await client.query(sql, params)).rows;
}

async function affected(sql: string, params?: unknown[]): Promise<number> {
  await client.query('SAVEPOINT data_access_write');
  try {
    const result = (await client.query(sql, params)) as unknown as { rowCount: number };
    return result.rowCount;
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT data_access_write');
  }
}

/** 'ok' or the SQLSTATE of the statement, rolled back either way. */
async function write(sql: string, params: unknown[]): Promise<string> {
  await client.query('SAVEPOINT data_access_insert');
  try {
    await client.query(sql, params);
    return 'ok';
  } catch (error: any) {
    return String(error?.code ?? error);
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT data_access_insert');
  }
}

async function apply(userId: string): Promise<string> {
  return applyPerson(client, userId);
}

async function seed(): Promise<Seed2> {
  const s = await seedLines(client);
  const tag = s.tenantId.slice(0, 8);
  // A word of L5's name only (the review's probe): the search vectors of its tasks carry it.
  await q(`UPDATE spend_items SET nature = 'capex', product_name = product_name || ' Zorglub' WHERE id = $1`, [s.lines.L5]);

  const supplier = (await q(`INSERT INTO suppliers (tenant_id, name) VALUES (app_current_tenant(), $1) RETURNING id`, [`Supplier ${tag}`]))[0].id;
  const contract = async (name: string, company: string, centre: string | null, owner: string | null) => (await q(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, cost_center_id, owner_user_id)
     VALUES (app_current_tenant(), $1, $2, $3, '2026-01-01', $4, $5) RETURNING id`,
    [`DA contract ${name} ${tag}`, company, supplier, centre, owner],
  ))[0].id as string;
  const contracts: Record<ContractLabel, string> = {
    CF: await contract('CF', s.fr, s.infFr, null),
    CE: await contract('CE', s.es, null, null),
    CN: await contract('CN', s.fr, null, s.persons.nina),
    C6: await contract('C6', s.fr, null, null),
  };
  for (const line of [s.lines.L1, s.lines.L5]) {
    await q(`INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES (app_current_tenant(), $1, $2)`, [contracts.CE, line]);
  }
  await q(`UPDATE spend_items SET contract_id = $2 WHERE id = $1`, [s.lines.L6, contracts.C6]);

  let n = 0;
  const pair = async (insert: string, extra: unknown[] = []): Promise<Objects> => ({
    a: (await q(insert, [`DA object ${++n} ${tag}`, ...extra.map((x) => (typeof x === 'function' ? x() : x))]))[0].id,
    b: (await q(insert, [`DA object ${++n} ${tag}`, ...extra.map((x) => (typeof x === 'function' ? x() : x))]))[0].id,
  });
  const application = await pair(`INSERT INTO applications (tenant_id, name) VALUES (app_current_tenant(), $1) RETURNING id`);
  const asset = await pair(`INSERT INTO assets (tenant_id, name, kind, environment) VALUES (app_current_tenant(), $1, 'server', 'prod') RETURNING id`);
  const technology = await pair(`INSERT INTO technologies (tenant_id, name, item_number) VALUES (app_current_tenant(), $1, $2) RETURNING id`, [() => n]);
  const project = await pair(`INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES (app_current_tenant(), $1, $2) RETURNING id`, [() => n]);
  const request = await pair(`INSERT INTO portfolio_requests (tenant_id, name, item_number) VALUES (app_current_tenant(), $1, $2) RETURNING id`, [() => n]);
  const library = (await q(`INSERT INTO document_libraries (tenant_id, name, slug) VALUES (app_current_tenant(), $1, $1) RETURNING id`, [`lib-${tag}`]))[0].id;
  const documents = await pair(`INSERT INTO documents (tenant_id, title, item_number, library_id) VALUES (app_current_tenant(), $1, $2, $3) RETURNING id`, [() => n, library]);

  for (const label of LABELS) {
    const line = s.lines[label];
    await q(`INSERT INTO application_spend_items (tenant_id, application_id, spend_item_id) VALUES (app_current_tenant(), $1, $2)`, [application.a, line]);
    await q(`INSERT INTO asset_spend_items (tenant_id, asset_id, spend_item_id) VALUES (app_current_tenant(), $1, $2)`, [asset.a, line]);
    await q(`INSERT INTO technology_spend_items (tenant_id, technology_id, spend_item_id) VALUES (app_current_tenant(), $1, $2)`, [technology.a, line]);
    await q(`INSERT INTO portfolio_project_opex (tenant_id, project_id, opex_id) VALUES (app_current_tenant(), $1, $2)`, [project.a, line]);
    await q(`INSERT INTO portfolio_request_opex (tenant_id, request_id, opex_id) VALUES (app_current_tenant(), $1, $2)`, [request.a, line]);
  }

  const tasks = {} as Record<TaskLabel, string>;
  for (const label of TASK_LABELS) {
    const spec = TASKS[label];
    let type: string | null = null;
    let id: string | null = null;
    if (spec.object.kind === 'line') {
      type = spec.object.line === 'L5' ? 'capex_item' : 'spend_item';
      id = s.lines[spec.object.line];
    } else if (spec.object.kind === 'contract') {
      type = 'contract';
      id = contracts[spec.object.contract];
    } else if (label === 'tProject') {
      type = 'project';
      id = project.a;
    }
    const paul = s.persons.paul;
    tasks[label] = (await q(
      `INSERT INTO tasks (tenant_id, title, item_number, related_object_type, related_object_id, assignee_user_id, owner_ids, viewer_ids, creator_id)
       VALUES (app_current_tenant(), $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8) RETURNING id`,
      [
        `DA task ${label} ${tag}`, taskNumber++, type, id,
        spec.paul === 'assignee' ? paul : null,
        JSON.stringify(spec.paul === 'owner' ? [paul] : []),
        JSON.stringify(spec.paul === 'viewer' ? [paul] : []),
        spec.paul === 'creator' ? paul : null,
      ],
    ))[0].id;
    const task = tasks[label];
    await q(`INSERT INTO task_attachments (tenant_id, task_id, original_filename, stored_filename, storage_path) VALUES (app_current_tenant(), $1, 'a.png', 'a.png', 'spec/a.png')`, [task]);
    await q(`INSERT INTO task_time_entries (tenant_id, task_id, hours, logged_at) VALUES (app_current_tenant(), $1, 1, now())`, [task]);
    await q(`INSERT INTO task_applications (tenant_id, task_id, application_id) VALUES (app_current_tenant(), $1, $2)`, [task, application.a]);
    await q(`INSERT INTO task_assets (tenant_id, task_id, asset_id) VALUES (app_current_tenant(), $1, $2)`, [task, asset.a]);
    await q(`INSERT INTO document_tasks (tenant_id, document_id, task_id) VALUES (app_current_tenant(), $1, $2)`, [documents.a, task]);
  }
  return { ...s, contracts, tasks, application, asset, technology, project, request, documents };
}

// Expectations, from the line expectations of run 2A and the contract table above.

const lineReadable = (p: LimitedPerson, l: Label) => EXPECTED[p].readable.includes(l);
const lineModifiable = (p: LimitedPerson, l: Label) => EXPECTED[p].modifiable.includes(l);
const contractReadable = (p: LimitedPerson, c: ContractLabel) => CONTRACT_EXPECTED[p].readable.includes(c);
const contractModifiable = (p: LimitedPerson, c: ContractLabel) => CONTRACT_EXPECTED[p].modifiable.includes(c);

function objectReadable(p: LimitedPerson, o: TaskObject): boolean {
  if (o.kind === 'line') return lineReadable(p, o.line);
  if (o.kind === 'contract') return contractReadable(p, o.contract);
  return true;
}

function objectModifiable(p: LimitedPerson, o: TaskObject): boolean {
  if (o.kind === 'line') return lineModifiable(p, o.line);
  if (o.kind === 'contract') return contractModifiable(p, o.contract);
  return true;
}

/** Visible: object readable, or participant (assignee, owner, observer); the creator is none. */
function taskVisible(p: LimitedPerson, t: TaskLabel): boolean {
  const spec = TASKS[t];
  const participant = p === 'paul' && ['assignee', 'owner', 'viewer'].includes(spec.paul ?? '');
  return participant || objectReadable(p, spec.object);
}

/**
 * In the search index: the object readable (§5.4). A participant's task whose line or contract is
 * hidden stays visible on the tasks page, never in search: its vector names that object.
 */
function taskSearchable(p: LimitedPerson, t: TaskLabel): boolean {
  return objectReadable(p, TASKS[t].object);
}

/** Modifiable: object modifiable, or responsible (assignee, owner). */
function taskModifiable(p: LimitedPerson, t: TaskLabel): boolean {
  const spec = TASKS[t];
  const responsible = p === 'paul' && ['assignee', 'owner'].includes(spec.paul ?? '');
  return responsible || objectModifiable(p, spec.object);
}

function taskObjectModifiable(p: LimitedPerson, t: TaskLabel): boolean {
  return objectModifiable(p, TASKS[t].object);
}

const ids = (rows: any[]) => rows.map((r) => r.id as string).sort();
const pick = <K extends string>(map: Record<K, string>, keys: K[]) => keys.map((k) => map[k]).sort();

/** The link tables to a line: their object column and line column, and the seeded objects. */
const LINKS: Array<{ table: string; objectColumn: string; lineColumn: string; objects: (s: Seed2) => Objects; type: string }> = [
  { table: 'application_spend_items', objectColumn: 'application_id', lineColumn: 'spend_item_id', objects: (s) => s.application, type: 'application' },
  { table: 'asset_spend_items', objectColumn: 'asset_id', lineColumn: 'spend_item_id', objects: (s) => s.asset, type: 'asset' },
  { table: 'technology_spend_items', objectColumn: 'technology_id', lineColumn: 'spend_item_id', objects: (s) => s.technology, type: 'technology' },
  { table: 'portfolio_project_opex', objectColumn: 'project_id', lineColumn: 'opex_id', objects: (s) => s.project, type: 'project' },
  { table: 'portfolio_request_opex', objectColumn: 'request_id', lineColumn: 'opex_id', objects: (s) => s.request, type: 'request' },
];

/** Links to a line (§5.4, §6.4, §10.4): line readable for every command. */
async function checkLinks(s: Seed2, p: LimitedPerson): Promise<void> {
  const readable = LABELS.filter((l) => lineReadable(p, l));
  for (const link of LINKS) {
    const visible = (await q(`SELECT ${link.lineColumn}::text AS id FROM ${link.table}`)).map((r) => r.id).sort();
    assert.deepEqual(visible, pick(s.lines, readable), `${p}: ${link.table} shows the links to readable lines`);
    assert.equal(await affected(`UPDATE ${link.table} SET created_at = created_at`), readable.length, `${p}: ${link.table} update`);
    assert.equal(await affected(`DELETE FROM ${link.table}`), readable.length, `${p}: ${link.table} delete`);
    for (const label of LABELS) {
      const state = await write(
        `INSERT INTO ${link.table} (tenant_id, ${link.objectColumn}, ${link.lineColumn}) VALUES (app_current_tenant(), $1, $2)`,
        [link.objects(s).b, s.lines[label]],
      );
      // A read-only line can be linked from the other object (§10.4, last item).
      assert.equal(state, lineReadable(p, label) ? 'ok' : '42501', `${p}: ${link.table} link to ${label}`);
    }
  }
}

/** Tasks (§4.4): visibility, update, delete and creation per object. */
async function checkTasks(s: Seed2, p: LimitedPerson): Promise<void> {
  const visible = ids(await q(`SELECT id::text AS id FROM tasks`));
  assert.deepEqual(visible, pick(s.tasks, TASK_LABELS.filter((t) => taskVisible(p, t))), `${p}: visible tasks`);
  assert.equal(await affected(`UPDATE tasks SET title = title`), TASK_LABELS.filter((t) => taskModifiable(p, t)).length, `${p}: tasks updated`);
  assert.equal(await affected(`DELETE FROM tasks`), TASK_LABELS.filter((t) => taskObjectModifiable(p, t)).length, `${p}: tasks deleted (object modifiable only)`);

  const insert = (type: string, id: string, assignee: string | null = null) => write(
    `INSERT INTO tasks (tenant_id, title, item_number, related_object_type, related_object_id, assignee_user_id)
     VALUES (app_current_tenant(), 'New task', $1, $2, $3, $4)`,
    [taskNumber++, type, id, assignee],
  );
  for (const label of LABELS) {
    const state = await insert(label === 'L5' ? 'capex_item' : 'spend_item', s.lines[label]);
    assert.equal(state, lineModifiable(p, label) ? 'ok' : '42501', `${p}: create a task of ${label}`);
  }
  for (const label of CONTRACTS) {
    const state = await insert('contract', s.contracts[label]);
    assert.equal(state, contractModifiable(p, label) ? 'ok' : '42501', `${p}: create a task of contract ${label}`);
  }
  assert.equal(await insert('project', s.project.a), 'ok', `${p}: create a project task`);
  if (p === 'paul') {
    // Being the assignee gives no right to create a task on a line out of access.
    assert.equal(await insert('capex_item', s.lines.L5, s.persons.paul), '42501', 'paul: create a task of L5 assigned to himself');
  }
}

const ELEMENTS: Array<{ table: string; touch: string; insert: (s: Seed2) => [string, unknown[]] }> = [
  {
    table: 'task_attachments',
    touch: `UPDATE task_attachments SET original_filename = original_filename`,
    insert: () => [`INSERT INTO task_attachments (tenant_id, task_id, original_filename, stored_filename, storage_path) VALUES (app_current_tenant(), $1, 'b.png', 'b.png', 'spec/b.png')`, []],
  },
  {
    table: 'task_time_entries',
    touch: `UPDATE task_time_entries SET notes = notes`,
    insert: () => [`INSERT INTO task_time_entries (tenant_id, task_id, hours, logged_at) VALUES (app_current_tenant(), $1, 2, now())`, []],
  },
  {
    table: 'task_applications',
    touch: `UPDATE task_applications SET created_at = created_at`,
    insert: (s) => [`INSERT INTO task_applications (tenant_id, task_id, application_id) VALUES (app_current_tenant(), $1, $2)`, [s.application.b]],
  },
  {
    table: 'task_assets',
    touch: `UPDATE task_assets SET created_at = created_at`,
    insert: (s) => [`INSERT INTO task_assets (tenant_id, task_id, asset_id) VALUES (app_current_tenant(), $1, $2)`, [s.asset.b]],
  },
];

/** Task elements follow the task: visible to read, modifiable to write; document links: visible for every command. */
async function checkTaskElements(s: Seed2, p: LimitedPerson): Promise<void> {
  const visibleTasks = pick(s.tasks, TASK_LABELS.filter((t) => taskVisible(p, t)));
  const modifiable = TASK_LABELS.filter((t) => taskModifiable(p, t));
  for (const element of ELEMENTS) {
    const seen = ids(await q(`SELECT task_id::text AS id FROM ${element.table}`));
    assert.deepEqual(seen, visibleTasks, `${p}: ${element.table} follows the visible tasks`);
    assert.equal(await affected(element.touch), modifiable.length, `${p}: ${element.table} update`);
    assert.equal(await affected(`DELETE FROM ${element.table}`), modifiable.length, `${p}: ${element.table} delete`);
    for (const label of TASK_LABELS) {
      const [sql, extra] = element.insert(s);
      const state = await write(sql, [s.tasks[label], ...extra]);
      assert.equal(state, taskModifiable(p, label) ? 'ok' : '42501', `${p}: ${element.table} insert on ${label}`);
    }
  }
  const linked = ids(await q(`SELECT task_id::text AS id FROM document_tasks`));
  assert.deepEqual(linked, visibleTasks, `${p}: document_tasks follows the visible tasks`);
  assert.equal(await affected(`UPDATE document_tasks SET created_at = created_at`), visibleTasks.length, `${p}: document_tasks update`);
  assert.equal(await affected(`DELETE FROM document_tasks`), visibleTasks.length, `${p}: document_tasks delete`);
  for (const label of TASK_LABELS) {
    const state = await write(`INSERT INTO document_tasks (tenant_id, document_id, task_id) VALUES (app_current_tenant(), $1, $2)`, [s.documents.b, s.tasks[label]]);
    assert.equal(state, taskVisible(p, label) ? 'ok' : '42501', `${p}: link a document to ${label}`);
  }
}

const ZORGLUB = `SELECT entity_type || ':' || entity_id AS k FROM search_index WHERE search_vector @@ plainto_tsquery('simple', 'Zorglub')`;

/** Search index: no entry of an invisible line, contract or task, nor of a task whose object is hidden; every other entry. */
async function checkSearch(s: Seed2, p: LimitedPerson, entries: Array<{ type: string; id: string }>, zorglub: string[]): Promise<void> {
  const lineLabel = new Map(LABELS.map((l) => [s.lines[l], l]));
  const contractLabel = new Map(CONTRACTS.map((c) => [s.contracts[c], c]));
  const taskLabel = new Map(TASK_LABELS.map((t) => [s.tasks[t], t]));
  const expected = entries.filter((e) => {
    if (e.type === 'spend_items' || e.type === 'capex_items') return lineReadable(p, lineLabel.get(e.id)!);
    if (e.type === 'contracts') return contractReadable(p, contractLabel.get(e.id)!);
    if (e.type === 'tasks') return taskSearchable(p, taskLabel.get(e.id)!);
    return true;
  }).map((e) => `${e.type}:${e.id}`).sort();
  const seen = (await q(`SELECT entity_type || ':' || entity_id AS k FROM search_index`)).map((r) => r.k).sort();
  assert.deepEqual(seen, expected, `${p}: search entries`);
  // A word of a hidden line's name finds nothing, not even a task the person takes part in.
  const found = (await q(ZORGLUB)).map((r) => r.k).sort();
  assert.deepEqual(found, zorglub.filter((k) => expected.includes(k)), `${p}: a search for a word of L5's name`);
  if (!lineReadable(p, 'L5')) assert.deepEqual(found, [], `${p}: L5 hidden, its name finds nothing`);

  const lines = ids(await q(`SELECT entity_id::text AS id FROM search_index WHERE label ILIKE 'DA line %'`));
  assert.deepEqual(lines, pick(s.lines, LABELS.filter((l) => lineReadable(p, l))), `${p}: a search returns the readable lines only`);
  assert.equal(await affected(`UPDATE search_index SET label = label`), expected.length, `${p}: search entries updated`);
  assert.equal(await affected(`DELETE FROM search_index`), expected.length, `${p}: search entries deleted`);
  const insert = (type: string) => write(
    `INSERT INTO search_index (tenant_id, entity_type, entity_id, label, search_vector) VALUES (app_current_tenant(), $1, $2, 'x', to_tsvector('simple', 'x'))`,
    [type, randomUUID()],
  );
  const readAll = p === 'claire' || p === 'rob';
  assert.equal(await insert('spend_items'), readAll ? 'ok' : '42501', `${p}: an entry of an unknown line`);
  assert.equal(await insert('documents'), 'ok', `${p}: an entry of another type`);
}

/** Depth functions, against the same expectations as the policies. */
async function checkDepthFunctions(s: Seed2, p: LimitedPerson): Promise<void> {
  for (const t of TASK_LABELS) {
    const row = (await q(`SELECT data_access_task_visible($1) AS v, data_access_task_modifiable($1) AS m`, [s.tasks[t]]))[0];
    assert.equal(row.v, taskVisible(p, t), `${p}: data_access_task_visible(${t})`);
    assert.equal(row.m, taskModifiable(p, t), `${p}: data_access_task_modifiable(${t})`);
  }
  for (const c of CONTRACTS) {
    const row = (await q(`SELECT data_access_contract_visible($1) AS v, data_access_contract_modifiable($1) AS m`, [s.contracts[c]]))[0];
    assert.equal(row.v, contractReadable(p, c), `${p}: data_access_contract_visible(${c})`);
    assert.equal(row.m, contractModifiable(p, c), `${p}: data_access_contract_modifiable(${c})`);
  }
  const unknown = randomUUID();
  const row = (await q(`SELECT data_access_task_visible($1) AS t, data_access_task_modifiable($1) AS m,
                               data_access_contract_visible($1) AS c, data_access_contract_modifiable($1) AS cm`, [unknown]))[0];
  assert.deepEqual([row.t, row.m, row.c, row.cm], [false, false, false, false], `${p}: an unknown id is not visible`);
}

/** Disclosure functions (§6.6): values, refusal (NULL) on an invisible or unknown starting object. */
async function checkDisclosures(s: Seed2, p: LimitedPerson, references: Record<TaskLabel, string | null>): Promise<void> {
  const hidden = LABELS.filter((l) => !lineReadable(p, l)).length;
  for (const link of LINKS) {
    const rows = await q(`SELECT data_access_hidden_count($1, $2) AS a, data_access_hidden_count($1, $3) AS b`, [link.type, link.objects(s).a, link.objects(s).b]);
    assert.equal(rows[0].a, hidden, `${p}: hidden lines of the ${link.type}`);
    assert.equal(rows[0].b, 0, `${p}: an ${link.type} without lines hides none`);
  }
  for (const c of CONTRACTS) {
    const value = (await q(`SELECT data_access_hidden_count('contract', $1) AS n`, [s.contracts[c]]))[0].n;
    const lines: Label[] = c === 'CE' ? ['L1', 'L5'] : [];
    const expected = contractReadable(p, c) ? lines.filter((l) => !lineReadable(p, l)).length : null;
    assert.equal(value, expected, `${p}: hidden lines of contract ${c}`);
  }
  assert.equal((await q(`SELECT data_access_hidden_count('application', $1) AS n`, [randomUUID()]))[0].n, null, `${p}: hidden count of an unknown object`);

  for (const t of TASK_LABELS) {
    const value = (await q(`SELECT data_access_reference('task', $1) AS r`, [s.tasks[t]]))[0].r;
    assert.equal(value, taskVisible(p, t) ? references[t] : null, `${p}: data_access_reference(task ${t})`);
  }
  assert.equal((await q(`SELECT data_access_reference('task', $1) AS r`, [randomUUID()]))[0].r, null, `${p}: reference of an unknown task`);
}

async function testPersons(s: Seed2): Promise<void> {
  assert.equal(await apply(s.persons.ulla), 'all');
  const entries = (await q(`SELECT entity_type AS type, entity_id::text AS id FROM search_index`));
  const indexed = new Set(entries.map((e) => e.id));
  for (const id of [...Object.values(s.lines), ...Object.values(s.contracts), ...Object.values(s.tasks)]) {
    assert.ok(indexed.has(id), 'every line, contract and task has its search entry (definer triggers)');
  }
  const references = await unscopedReferences(s);
  const zorglub = (await q(ZORGLUB)).map((r) => r.k).sort();
  for (const t of ['tL5', 'tAssignee', 'tOwner', 'tViewer'] as TaskLabel[]) {
    assert.ok(zorglub.includes(`tasks:${s.tasks[t]}`), `the vector of ${t} carries the name of L5 (unscoped)`);
  }

  for (const p of PERSONS) {
    assert.equal(await apply(s.persons[p]), 'limited', `${p}: limited`);
    await checkLinks(s, p);
    await checkTasks(s, p);
    await checkTaskElements(s, p);
    await checkSearch(s, p, entries, zorglub);
    await checkDepthFunctions(s, p);
    await checkDisclosures(s, p, references);
    assert.equal(await apply(s.persons.ulla), 'all', 'back to the application role');
  }
  console.log('  links, tasks, task elements, document links, search index, depth and disclosure functions, per person (§10.1, §10.4): OK');
}

/** References as the application role: what a visible task's line shows (OPX-n, CPX-n). */
async function unscopedReferences(s: Seed2): Promise<Record<TaskLabel, string | null>> {
  const numbers = new Map((await q(`SELECT id::text, item_number, nature FROM spend_items`)).map((r) => [r.id, `${r.nature === 'capex' ? 'CPX' : 'OPX'}-${r.item_number}`]));
  const out = {} as Record<TaskLabel, string | null>;
  for (const t of TASK_LABELS) {
    const o = TASKS[t].object;
    out[t] = o.kind === 'line' ? numbers.get(s.lines[o.line])! : null;
    assert.equal((await q(`SELECT data_access_reference('task', $1) AS r`, [s.tasks[t]]))[0].r, out[t], `unscoped: reference of ${t}`);
  }
  assert.ok(out.tL5!.startsWith('CPX-') && out.tL1!.startsWith('OPX-'), 'the prefix follows the nature of the line');
  return out;
}

async function testBulkReplacement(s: Seed2): Promise<void> {
  await client.query('SAVEPOINT data_access_bulk');
  try {
    assert.equal(await apply(s.persons.paul), 'limited');
    // The replacement of the lines of an application by Paul (L1-L4 readable): delete, then insert the new set.
    await client.query(`DELETE FROM application_spend_items WHERE application_id = $1`, [s.application.a]);
    for (const label of ['L1', 'L2'] as Label[]) {
      await client.query(`INSERT INTO application_spend_items (tenant_id, application_id, spend_item_id) VALUES (app_current_tenant(), $1, $2)`, [s.application.a, s.lines[label]]);
    }
    await apply(s.persons.ulla);
    const kept = ids(await q(`SELECT spend_item_id::text AS id FROM application_spend_items WHERE application_id = $1`, [s.application.a]));
    assert.deepEqual(kept, pick(s.lines, ['L1', 'L2', 'L5', 'L6', 'L7']), 'bulk replacement: the links to invisible lines stay');
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT data_access_bulk');
  }
  console.log('  bulk replacement of the lines of an application: invisible links kept (§5.4, §10.5): OK');
}

async function testUnscoped(s: Seed2): Promise<void> {
  for (const name of ['ulla', 'admin'] as const) {
    assert.equal(await apply(s.persons[name]), 'all', `${name}: everything`);
    assert.equal((await q(`SELECT current_user AS u`))[0].u, appRoleName());
    assert.equal((await q(`SELECT count(*)::int AS n FROM tasks`))[0].n, TASK_LABELS.length, `${name}: every task`);
    const values = (await q(`
      SELECT bool_and(data_access_task_visible(t.id) AND data_access_task_modifiable(t.id)) AS tasks,
             (SELECT bool_and(data_access_contract_visible(c.id) AND data_access_contract_modifiable(c.id)) FROM contracts c) AS contracts,
             data_access_task_visible($2) AS unknown,
             data_access_hidden_count('application', $1) AS hidden,
             data_access_hidden_count('contract', $3) AS hidden_contract
      FROM tasks t`, [s.application.a, randomUUID(), s.contracts.CE]))[0];
    assert.deepEqual(values, { tasks: true, contracts: true, unknown: true, hidden: 0, hidden_contract: 0 }, `${name}: depth functions true, hidden count 0`);
  }
  assert.equal(await sqlStateOf(`SELECT data_access_hidden_count('line', $1)`, [randomUUID()]), '22023', 'hidden count: unknown type');
  assert.equal(await sqlStateOf(`SELECT data_access_reference('spend_item', $1)`, [randomUUID()]), '22023', 'reference: unknown type');

  // The policies change nothing for an unscoped person: same rows without them.
  const counts = async () => {
    const out: Record<string, number> = {};
    for (const table of ['tasks', 'search_index', 'document_tasks', ...ELEMENTS.map((e) => e.table), ...LINKS.map((l) => l.table)]) {
      out[table] = (await q(`SELECT count(*)::int AS n FROM ${table}`))[0].n;
    }
    return out;
  };
  await apply(s.persons.ulla);
  const withPolicies = await counts();
  await client.query('SAVEPOINT data_access_no_policies');
  try {
    for (const p of await q(`SELECT p.polname, c.relname FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE to_regrole($1)::oid = ANY (p.polroles)`, [LIMITED_ROLE])) {
      await client.query(`DROP POLICY ${p.polname} ON ${p.relname}`);
    }
    assert.deepEqual(await counts(), withPolicies, 'unscoped: same rows with and without the policies');
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT data_access_no_policies');
  }
  console.log('  unscoped and Administrator: everything, depth functions true, hidden count 0, references as usual: OK');
}

/**
 * The search index runs at every keystroke (spec §6.9): its policy reaches contracts and tasks
 * through the set functions, in an uncorrelated `IN (SELECT ...)`, so each set is read once per
 * statement (lot 2, run 2D). The plan of a limited person reads each set function in a SubPlan
 * of its own (hashed at scale; on a small seed the planner may scan the kept result instead), and
 * calls no per-id depth function (one call per row: 202 to 233 ms at 10 000 lines, run 2C).
 */
async function testSearchIndexSetForm(s: Seed2): Promise<void> {
  assert.equal(await apply(s.persons.paul), 'limited');
  const plan = (await q(`EXPLAIN (ANALYZE, VERBOSE, FORMAT JSON) SELECT entity_type, entity_id FROM search_index`))[0]['QUERY PLAN'][0].Plan;
  const subplans: Array<{ name: string; loops: number }> = [];
  const walk = (node: any) => {
    if (node['Parent Relationship'] === 'SubPlan') {
      const text = JSON.stringify(node);
      for (const name of ['data_access_visible_contract_ids', 'data_access_searchable_task_ids']) {
        if (text.includes(`${name}()`)) subplans.push({ name, loops: node['Actual Loops'] });
      }
    }
    for (const child of node.Plans ?? []) walk(child);
  };
  walk(plan);
  assert.deepEqual(subplans.map((n) => n.name).sort(), ['data_access_searchable_task_ids', 'data_access_visible_contract_ids'], 'search index: each set function read in one SubPlan');
  assert.ok(subplans.some((n) => n.loops >= 1), 'search index: a set function was read');
  const text = JSON.stringify(plan);
  for (const perId of ['data_access_contract_visible', 'data_access_task_visible']) {
    assert.ok(!text.includes(perId), `search index: no per-row call of ${perId}`);
  }
  await apply(s.persons.ulla);
  console.log('  search index: contracts and tasks through the set functions, read once per statement: OK');
}

/**
 * Placement of a task (§2.5, §6.4): a responsible person (assignee, owner) writes a task whose
 * object is out of access, but never moves it onto a line or a contract it cannot modify; the
 * placement trigger refuses with 42501 (the UPDATE policy does not see the old row).
 */
async function testTaskPlacement(s: Seed2): Promise<void> {
  const move = async (person: keyof Seed['persons'], task: TaskLabel, type: string, id: string): Promise<string> => {
    assert.ok(['all', 'limited'].includes(await apply(s.persons[person])));
    await client.query('SAVEPOINT data_access_task_move');
    try {
      const result = (await client.query(
        `UPDATE tasks SET related_object_type = $2, related_object_id = $3 WHERE id = $1`, [s.tasks[task], type, id],
      )) as unknown as { rowCount: number };
      return result.rowCount === 1 ? 'ok' : `rows ${result.rowCount}`;
    } catch (error: any) {
      return String(error?.code ?? error);
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT data_access_task_move');
      await apply(s.persons.ulla);
    }
  };
  const cases: Array<[keyof Seed['persons'], TaskLabel, string, string, string]> = [
    // Paul, assignee of a task of L5 (out of his access): L1 and CE are readable, not modifiable.
    ['paul', 'tAssignee', 'spend_item', s.lines.L1, '42501'],
    ['paul', 'tOwner', 'spend_item', s.lines.L2, '42501'],
    ['paul', 'tAssignee', 'contract', s.contracts.CE, '42501'],
    ['paul', 'tAssignee', 'contract', s.contracts.CN, '42501'],
    ['paul', 'tAssignee', 'capex_item', s.lines.L5, 'ok'], // the same object: no move
    // Marta modifies L3, L4, L5 and CE.
    ['marta', 'tL4', 'spend_item', s.lines.L3, 'ok'],
    ['marta', 'tL4', 'spend_item', s.lines.L1, '42501'],
    ['marta', 'tL4', 'spend_item', s.lines.L2, '42501'], // readable only
    ['marta', 'tL4', 'contract', s.contracts.CE, 'ok'],
    ['marta', 'tL4', 'contract', s.contracts.CF, '42501'],
    ['marta', 'tProject', 'spend_item', s.lines.L1, '42501'], // from another type
    ['marta', 'tProject', 'capex_item', s.lines.L5, 'ok'],
    ['claire', 'tL1', 'contract', s.contracts.CN, 'ok'],
    ['ulla', 'tAssignee', 'spend_item', s.lines.L1, 'ok'], // mode all: no rule
  ];
  for (const [person, task, type, id, expected] of cases) {
    assert.equal(await move(person, task, type, id), expected, `${person}: move ${task} to ${type} ${id}`);
  }

  // The review's probe: Nina (no node), assignee of a task of L4, moves it to L1, then to CF.
  await client.query('SAVEPOINT data_access_nina_assignee');
  try {
    await apply(s.persons.ulla);
    await client.query(`UPDATE tasks SET assignee_user_id = $2 WHERE id = $1`, [s.tasks.tL4, s.persons.nina]);
    assert.equal(await move('nina', 'tL4', 'spend_item', s.lines.L1), '42501', 'nina: assignee moves her task to L1');
    assert.equal(await move('nina', 'tL4', 'contract', s.contracts.CF), '42501', 'nina: assignee moves her task to a hidden contract');
    assert.equal(await move('nina', 'tL4', 'spend_item', s.lines.L6), 'ok', 'nina: to the line she owns');
    await apply(s.persons.nina);
    assert.equal(await affected(`UPDATE tasks SET title = 'Renamed by its assignee' WHERE id = $1`, [s.tasks.tL4]), 1, 'nina: the assignee still writes her task');
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT data_access_nina_assignee');
    await apply(s.persons.ulla);
  }
  console.log('  task placement: a responsible person never moves a task onto a line or contract out of edit access (§2.5): OK');
}

async function sqlStateOf(sql: string, params: unknown[]): Promise<string> {
  const state = await write(sql, params);
  assert.notEqual(state, 'ok', `expected an error: ${sql}`);
  return state;
}

async function testRoleWithoutContext(s: Seed2): Promise<void> {
  await apply(s.persons.ulla);
  await client.query('SAVEPOINT data_access_no_context');
  try {
    await client.query(`SET LOCAL ROLE ${LIMITED_ROLE}`);
    for (const table of ['tasks', 'search_index', 'document_tasks', ...ELEMENTS.map((e) => e.table), ...LINKS.map((l) => l.table)]) {
      assert.equal((await q(`SELECT count(*)::int AS n FROM ${table}`))[0].n, 0, `no context: ${table} shows nothing`);
    }
    assert.equal(await write(`INSERT INTO tasks (tenant_id, title, item_number) VALUES (app_current_tenant(), 'x', $1)`, [taskNumber++]), '42501', 'no context: a standalone task refused');
    assert.equal(await write(`INSERT INTO application_spend_items (tenant_id, application_id, spend_item_id) VALUES (app_current_tenant(), $1, $2)`, [s.application.b, s.lines.L1]), '42501', 'no context: a link refused');
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT data_access_no_context');
  }
  console.log('  role taken without context: nothing visible, nothing writable: OK');
}

async function run(): Promise<void> {
  client = await connect(APP_URL);
  try {
    if (!(await roleExists(client))) {
      if (process.env.CI) assert.fail(`CI installs ${LIMITED_ROLE} before the migrations (infra/scripts/data-access-role.sql)`);
      console.log(`data access links and tasks: ${LIMITED_ROLE} not installed, skipped`);
      return;
    }
    console.log('data access links and tasks');
    await client.query('BEGIN');
    try {
      const s = await seed();
      await testUnscoped(s);
      await testPersons(s);
      await testBulkReplacement(s);
      await testTaskPlacement(s);
      await testSearchIndexSetForm(s);
      await testRoleWithoutContext(s);
    } finally {
      await client.query('ROLLBACK');
    }
    console.log('data access links and tasks: all scenarios passed');
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
