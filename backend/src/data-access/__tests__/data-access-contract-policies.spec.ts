// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  APP_URL,
  LIMITED_ROLE,
  PgClient,
  appRoleName,
  connect,
  roleExists,
} from './data-access-test-helpers';
import {
  CONTRACT_LABELS,
  ContractLabel,
  ContractSeed,
  seedContracts,
} from './data-access-contract-seed';
import { LimitedPerson } from './data-access-line-seed';

/**
 * Data-scoped access, lot 5 run 5A (planning/data-scoped-access/spec.md §2.2, §2.3, §4.3, §5.4,
 * §6.4, §6.6, §10.1): the policies of the contracts and of their tables, the placement trigger,
 * the link triggers, the discretionary functions (`data_access_hidden_count`,
 * `data_access_can_read`) and the tasks and search entries of contracts, as the application role
 * taking the limited role through data_access_apply(). One transaction, rolled back; each write
 * under a savepoint.
 *
 * Reference fixture: data-access-contract-seed.ts.
 *
 * Needs the role kanap_data_limited (CI installs it); skipped without it, failed in CI.
 */

let client: PgClient;

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

type Outcome = { code: string; message: string };

/** 'ok', or the SQLSTATE and message of the statement, rolled back either way. */
async function attempt(sql: string, params: unknown[] = []): Promise<Outcome> {
  await client.query('SAVEPOINT data_access_attempt');
  try {
    await client.query(sql, params);
    return { code: 'ok', message: '' };
  } catch (error: any) {
    return { code: String(error?.code ?? error), message: String(error?.message ?? '') };
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT data_access_attempt');
  }
}

async function apply(userId: string): Promise<string> {
  return (await q(`SELECT data_access_apply($1) AS mode`, [userId]))[0].mode;
}

const ALL_CONTRACTS: ContractLabel[] = [...CONTRACT_LABELS];
const readable: Record<LimitedPerson, ContractLabel[]> = {
  // Company ES: CE directly, CX through the centre it reads (company FR, place INF-ES).
  marta: ['CE', 'CX'],
  // INF read: CF and CX by their centres, CE and CL through L1.
  paul: ['CF', 'CE', 'CL', 'CX'],
  // INF-FR edit inside INF read: CF and CX by their centres, CE and CL through L1.
  rita: ['CF', 'CE', 'CL', 'CX'],
  claire: ALL_CONTRACTS,
  rob: ALL_CONTRACTS,
  // Owner of CN; CE through L6 and L7, which it owns.
  nina: ['CE', 'CN'],
};
const modifiable: Record<LimitedPerson, ContractLabel[]> = {
  marta: ['CE'],
  paul: [],
  rita: ['CF'],
  claire: ALL_CONTRACTS,
  rob: [],
  nina: ['CN'],
};
/** Readable directly (company, node or owner), without opening the contract through a line. */
const direct: Record<LimitedPerson, ContractLabel[]> = {
  marta: ['CE', 'CX'],
  paul: ['CF', 'CX'],
  rita: ['CF', 'CX'],
  claire: ALL_CONTRACTS,
  rob: ALL_CONTRACTS,
  nina: ['CN'],
};

const set = (values: ContractLabel[]) => new Set(values);
const sortedIds = (values: string[]) => [...values].sort();

/** Rows of a table that follows a contract, per contract label. */
type Child = {
  table: string;
  count: (s: ContractSeed, label: ContractLabel) => number;
  insert: (s: ContractSeed, label: ContractLabel) => [string, unknown[]];
};

const FOLLOWS: Child[] = [
  {
    table: 'contract_contacts',
    count: () => 1,
    insert: (s, label) => [
      `INSERT INTO contract_contacts (tenant_id, contract_id, contact_id, role, origin)
       VALUES (app_current_tenant(), $1, $2, 'support', 'manual')`, [s.contracts[label], s.contact2],
    ],
  },
  {
    table: 'contract_compliance_items',
    count: () => 1,
    insert: (s, label) => [
      `INSERT INTO contract_compliance_items (tenant_id, contract_id, requirement)
       VALUES (app_current_tenant(), $1, 'requirement_b')`, [s.contracts[label]],
    ],
  },
  {
    table: 'contract_tasks',
    count: () => 1,
    insert: (s, label) => [
      `INSERT INTO contract_tasks (tenant_id, contract_id, description)
       VALUES (app_current_tenant(), $1, 'Second legacy contract task')`, [s.contracts[label]],
    ],
  },
];

const DOCUMENTS: Child[] = [
  {
    table: 'contract_attachments',
    count: (_s, label) => label === 'CL' ? 2 : 1,
    insert: (s, label) => [
      `INSERT INTO contract_attachments (tenant_id, contract_id, original_filename, stored_filename, storage_path)
       VALUES (app_current_tenant(), $1, $2, $2, 'spec/second.pdf')`, [s.contracts[label], `insert-${label}.pdf`],
    ],
  },
  {
    table: 'contract_links',
    count: () => 1,
    insert: (s, label) => [
      `INSERT INTO contract_links (tenant_id, contract_id, url)
       VALUES (app_current_tenant(), $1, $2)`, [s.contracts[label], `https://example.invalid/insert-${label}`],
    ],
  },
];

/** Links from an application, an asset and a technology: the contract readable for every command. */
type LinkTable = {
  table: string;
  objectColumn: string;
  object: (s: ContractSeed) => string;
  objectB: (s: ContractSeed) => string;
};

const LINKS: LinkTable[] = [
  { table: 'application_contracts', objectColumn: 'application_id', object: (s) => s.application, objectB: (s) => s.applicationB },
  { table: 'asset_contracts', objectColumn: 'asset_id', object: (s) => s.asset, objectB: (s) => s.assetB },
  { table: 'technology_contracts', objectColumn: 'technology_id', object: (s) => s.technology, objectB: (s) => s.technologyB },
];

function contractOf(s: ContractSeed, label: ContractLabel): string {
  return s.contracts[label];
}

/** The rows a person must see in a table, as contract label to row count. */
function expectedCounts(
  s: ContractSeed,
  parents: ContractLabel[],
  count: (s: ContractSeed, label: ContractLabel) => number,
): Map<string, number> {
  return new Map(parents.map((label) => [contractOf(s, label), count(s, label)]));
}

async function seenCounts(s: ContractSeed, table: string): Promise<Map<string, number>> {
  const rows = await q(`SELECT contract_id::text AS parent, count(*)::int AS n FROM ${table} GROUP BY 1`);
  return new Map(rows.map((row) => [row.parent, row.n]));
}

async function testContractTable(s: ContractSeed, person: LimitedPerson): Promise<void> {
  const canRead = set(readable[person]);
  const canEdit = set(modifiable[person]);
  const seen = sortedIds((await q(`SELECT id::text AS id FROM contracts`)).map((r) => r.id));
  assert.deepEqual(seen, sortedIds([...canRead].map((label) => s.contracts[label])), `${person}: readable contracts`);
  assert.equal(await affected(`UPDATE contracts SET name = name`), canEdit.size, `${person}: modifiable contracts`);
  assert.equal(await affected(`DELETE FROM contracts`), 0, `${person}: deleting a contract is refused, even inside its nodes`);

  const children: Array<{ child: Child; parents: ContractLabel[] }> = [
    ...FOLLOWS.map((child) => ({ child, parents: [...canRead] })),
    ...DOCUMENTS.map((child) => ({ child, parents: direct[person] })),
  ];
  for (const { child, parents } of children) {
    const visible = await seenCounts(s, child.table);
    assert.deepEqual(visible, expectedCounts(s, parents, child.count), `${person}: ${child.table} follows the ${child.table.startsWith('contract_attach') || child.table === 'contract_links' ? 'directly readable' : 'readable'} contracts`);
    const editCount = [...canEdit].reduce((n, label) => n + child.count(s, label), 0);
    assert.equal(await affected(`UPDATE ${child.table} SET contract_id = contract_id`), editCount, `${person}: ${child.table} update`);
    assert.equal(await affected(`DELETE FROM ${child.table}`), editCount, `${person}: ${child.table} delete`);
    for (const label of ALL_CONTRACTS) {
      const [sql, params] = child.insert(s, label);
      const state = await attempt(sql, params);
      assert.equal(state.code, canEdit.has(label) ? 'ok' : '42501', `${person}: insert into ${child.table} for ${label}`);
    }
  }

  const linkedContracts = (['CF', 'CE', 'CH'] as ContractLabel[]).filter((label) => canRead.has(label));
  for (const link of LINKS) {
    const visible = await seenCounts(s, link.table);
    assert.deepEqual(visible, expectedCounts(s, linkedContracts, () => 1), `${person}: ${link.table} shows the links to readable contracts`);
    assert.equal(await affected(`UPDATE ${link.table} SET created_at = created_at`), linkedContracts.length, `${person}: ${link.table} update`);
    assert.equal(await affected(`DELETE FROM ${link.table}`), linkedContracts.length, `${person}: ${link.table} delete`);
    for (const label of ALL_CONTRACTS) {
      const state = await attempt(
        `INSERT INTO ${link.table} (tenant_id, ${link.objectColumn}, contract_id)
         VALUES (app_current_tenant(), $1, $2)`,
        [link.objectB(s), s.contracts[label]],
      );
      assert.equal(state.code, canRead.has(label) ? 'ok' : '42501', `${person}: link an object to contract ${label}`);
    }
  }
}

async function testReadAndWrite(s: ContractSeed): Promise<void> {
  for (const person of Object.keys(readable) as LimitedPerson[]) {
    assert.equal(await apply(s.persons[person]), 'limited', `${person}: limited`);
    await testContractTable(s, person);
    assert.equal(await apply(s.persons.ulla), 'all', 'back to the application role');
  }
  console.log('  contracts and their tables: read, update, delete and insert, per person (§10.1): OK');
}

async function contractInsert(s: ContractSeed, company: string | null, centre: string | null, owner: string | null = null): Promise<Outcome> {
  return attempt(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, cost_center_id, owner_user_id)
     VALUES (app_current_tenant(), 'New contract', $1, $2, '2026-01-01', $3, $4)`,
    [company, s.supplier, centre, owner],
  );
}

async function testPlacement(s: ContractSeed): Promise<void> {
  // A contract is placed by its company in edit access, or by an edit node whose company is the
  // contract's company (data_access_placable_contract, spec §2.3).
  const cases: Array<[keyof ContractSeed['persons'], string | null, string | null, string | null, string]> = [
    ['marta', s.es, null, null, 'ok'],
    ['marta', s.es, s.infEs, null, 'ok'],
    ['marta', s.fr, s.infEs, null, '42501'], // an edit node of another company
    ['marta', s.fr, null, null, '42501'],
    ['rita', s.fr, s.infFr, null, 'ok'],
    ['rita', s.es, s.infFr, null, '42501'], // edit node INF-FR, company ES outside edit_node_companies
    ['rita', s.fr, null, null, '42501'],
    ['paul', s.fr, s.infFr, null, '42501'],
    ['nina', s.fr, null, s.persons.nina, '42501'], // a participation never places
    ['claire', s.es, null, null, 'ok'],
    ['ulla', s.es, null, null, 'ok'], // mode all
  ];
  for (const [person, company, centre, owner, expected] of cases) {
    assert.ok(['all', 'limited'].includes(await apply(s.persons[person])), `${person}: access applied`);
    const state = await contractInsert(s, company, centre, owner);
    assert.equal(state.code, expected, `${person}: create a contract (${company === s.fr ? 'FR' : company === s.es ? 'ES' : '-'}, ${centre === s.infFr ? 'INF-FR' : centre === s.infEs ? 'INF-ES' : '-'})`);
    await apply(s.persons.ulla);
  }

  // Moves: an owner modifies the contract but never moves it; a read-only contract is not updated;
  // outside the limited mode the trigger does nothing.
  const moves: Array<[keyof ContractSeed['persons'], ContractLabel, string, unknown, string | number]> = [
    ['nina', 'CN', 'company_id', s.es, '42501'],
    ['nina', 'CN', 'cost_center_id', s.infFr, '42501'],
    ['nina', 'CN', 'name', 'Renamed by its owner', 1],
    ['marta', 'CX', 'name', 'Renamed by Marta', 0], // readable through its node, not modifiable
    ['rita', 'CE', 'name', 'Renamed by Rita', 0], // read through L1, not modifiable
    ['paul', 'CF', 'name', 'Renamed by Paul', 0],
    ['rita', 'CF', 'cost_center_id', null, '42501'], // moving CF out of its edit node: not placable
    ['rita', 'CF', 'name', 'Renamed by Rita', 1],
    ['claire', 'CH', 'company_id', s.es, 1],
    ['ulla', 'CF', 'company_id', s.es, 1],
  ];
  for (const [person, label, column, value, expected] of moves) {
    assert.ok(['all', 'limited'].includes(await apply(s.persons[person])), `${person}: access applied`);
    await client.query('SAVEPOINT data_access_move');
    let state: string | number = 'ok';
    try {
      const result = (await client.query(`UPDATE contracts SET ${column} = $2 WHERE id = $1`, [s.contracts[label], value])) as unknown as { rowCount: number };
      state = result.rowCount;
    } catch (error: any) {
      state = String(error?.code ?? error);
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT data_access_move');
    }
    assert.equal(state, expected, `${person}: set ${column} of ${label}`);
    await apply(s.persons.ulla);
  }
  console.log('  placement: create, move (owner included), read only, delete (§2.3, §4.3): OK');
}

/** The same 23503 and the same message for an invisible and a nonexistent object. */
async function testLinkTriggers(s: ContractSeed): Promise<void> {
  assert.equal(await apply(s.persons.rita), 'limited');

  const hiddenContract = await attempt(
    `INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES (app_current_tenant(), $1, $2)`,
    [s.contracts.CH, s.lines.L1],
  );
  const missingContract = await attempt(
    `INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES (app_current_tenant(), $1, $2)`,
    [randomUUID(), s.lines.L1],
  );
  assert.equal(hiddenContract.code, '23503', 'a hidden contract: 23503');
  assert.deepEqual(missingContract, hiddenContract, 'a random contract: the same SQLSTATE and message');
  assert.ok(!hiddenContract.message.includes(s.contracts.CH), 'the message carries no id the caller did not send');

  const hiddenLine = await attempt(
    `INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES (app_current_tenant(), $1, $2)`,
    [s.contracts.CF, s.lines.L5],
  );
  const missingLine = await attempt(
    `INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES (app_current_tenant(), $1, $2)`,
    [s.contracts.CF, randomUUID()],
  );
  assert.equal(hiddenLine.code, '23503', 'a hidden line: 23503');
  assert.deepEqual(missingLine, hiddenLine, 'a random line: the same SQLSTATE and message');

  const readOnlyLine = await attempt(
    `INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES (app_current_tenant(), $1, $2)`,
    [s.contracts.CF, s.lines.L3],
  );
  assert.equal(readOnlyLine.code, '42501', 'a readable but read-only line: 42501');

  // Paul reads L1 (linked to CF) but never modifies it; Rita reads CE and not L5.
  await apply(s.persons.paul);
  const deleteReadOnly = await attempt(
    `DELETE FROM contract_spend_items WHERE contract_id = $1 AND spend_item_id = $2`, [s.contracts.CF, s.lines.L1],
  );
  assert.equal(deleteReadOnly.code, '42501', 'deleting a link to a read-only line: 42501');
  await apply(s.persons.rita);
  const deleteHidden = await attempt(
    `DELETE FROM contract_spend_items WHERE contract_id = $1 AND spend_item_id = $2`, [s.contracts.CE, s.lines.L5],
  );
  assert.equal(deleteHidden.code, '42501', 'deleting a link to an invisible line: 42501');

  // The line's own contract_id: the same contract rule, before the foreign key.
  const hiddenLineContract = await attempt(`UPDATE spend_items SET contract_id = $2 WHERE id = $1`, [s.lines.L1, s.contracts.CH]);
  const missingLineContract = await attempt(`UPDATE spend_items SET contract_id = $2 WHERE id = $1`, [s.lines.L1, randomUUID()]);
  assert.equal(hiddenLineContract.code, '23503', 'a hidden contract on a line: 23503');
  assert.deepEqual(missingLineContract, hiddenLineContract, 'a random contract on a line: the same SQLSTATE and message');
  const readable = await attempt(`UPDATE spend_items SET contract_id = $2 WHERE id = $1`, [s.lines.L1, s.contracts.CE]);
  assert.equal(readable.code, 'ok', 'a readable contract on a modifiable line: allowed');

  // The application role (mode all) is unchanged.
  await apply(s.persons.ulla);
  assert.equal((await attempt(`UPDATE spend_items SET contract_id = $2 WHERE id = $1`, [s.lines.L1, s.contracts.CH])).code, 'ok', 'mode all: a hidden contract on a line');
  assert.equal((await attempt(`INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES (app_current_tenant(), $1, $2)`, [s.contracts.CH, s.lines.L7])).code, 'ok', 'mode all: a link to a hidden contract');
  console.log('  link triggers: 23503 identical for hidden and missing, 42501 for a read-only line, mode all unchanged (§5.4, §6.4): OK');
}

function hiddenCount(type: string, id: string): Promise<number | null> {
  return q(`SELECT data_access_hidden_count($1, $2) AS n`, [type, id]).then((rows) => rows[0].n);
}

async function testDisclosures(s: ContractSeed): Promise<void> {
  for (const person of ['marta', 'paul', 'rita', 'claire', 'rob', 'nina'] as LimitedPerson[]) {
    assert.equal(await apply(s.persons[person]), 'limited', `${person}: limited`);
    const canRead = set(readable[person]);

    // Documents of a contract the person reads without reading it directly.
    for (const label of ALL_CONTRACTS) {
      const value = await hiddenCount('contract_document', s.contracts[label]);
      const expected = !canRead.has(label) ? null : direct[person].includes(label) ? 0 : s.documents[label];
      assert.equal(value, expected, `${person}: closed documents of ${label}`);
    }

    // Contracts linked to an application, an asset or a technology.
    for (const [type, link] of [
      ['application_contract', LINKS[0]],
      ['asset_contract', LINKS[1]],
      ['technology_contract', LINKS[2]],
    ] as const) {
      const value = await hiddenCount(type, link.object(s));
      const expected = ['CF', 'CE', 'CH'].filter((label) => !canRead.has(label as ContractLabel)).length;
      assert.equal(value, expected, `${person}: hidden contracts of the ${type}`);
    }

    // `data_access_can_read`, the person as the limited caller: CE is visible to all of them, CH
    // only to the persons reading everything (another caller cannot see CH at all: NULL).
    assert.equal((await q(`SELECT data_access_can_read($1, 'contract', $2) AS r`, [s.persons[person], s.contracts.CE]))[0].r,
      canRead.has('CE'), `${person}: can_read(CE)`);
    assert.equal((await q(`SELECT data_access_can_read($1, 'contract', $2) AS r`, [s.persons[person], s.contracts.CH]))[0].r,
      canRead.has('CH') ? true : null, `${person}: can_read(CH), limited caller`);
    await apply(s.persons.ulla);
  }

  // A limited caller learns nothing about a contract it cannot see; it answers for one it sees.
  assert.equal(await apply(s.persons.marta), 'limited');
  assert.equal((await q(`SELECT data_access_can_read($1, 'contract', $2) AS r`, [s.persons.ulla, s.contracts.CF]))[0].r, null, 'Marta asks about CF, which she cannot see: NULL');
  assert.equal((await q(`SELECT data_access_can_read($1, 'contract', $2) AS r`, [s.persons.ulla, s.contracts.CE]))[0].r, true, 'Marta asks about CE for Ulla');
  assert.equal((await q(`SELECT data_access_can_read($1, 'contract', $2) AS r`, [s.persons.nina, s.contracts.CH]))[0].r, null, 'Marta asks about CH, which she cannot see: NULL');
  await apply(s.persons.ulla);
  assert.equal((await q(`SELECT data_access_can_read($1, 'contract', $2) AS r`, [randomUUID(), s.contracts.CF]))[0].r, false, 'unknown person: false');
  assert.equal((await q(`SELECT data_access_can_read($1, 'contract', $2) AS r`, [s.persons.ulla, randomUUID()]))[0].r, null, 'unknown contract: NULL');
  assert.equal((await q(`SELECT data_access_can_read($1, 'contract', $2) AS r`, [s.persons.admin, s.contracts.CH]))[0].r, true, 'Administrator: true');
  assert.equal((await q(`SELECT data_access_can_read($1, 'contract', $2) AS r`, [s.persons.claire, s.contracts.CH]))[0].r, true, 'Claire reads everything');

  assert.equal(await apply(s.persons.marta), 'limited');
  assert.equal((await q(`SELECT data_access_hidden_count('contract_document', $1) AS n`, [randomUUID()]))[0].n, null, 'unknown starting object: NULL');
  await apply(s.persons.ulla);
  assert.equal((await attempt(`SELECT data_access_hidden_count('contract_link', $1)`, [randomUUID()])).code, '22023', 'unknown type: 22023');
  console.log('  disclosures: closed documents, hidden contracts of an application/asset/technology, can_read (§5.4, §6.6): OK');
}

async function testTasksAndSearch(s: ContractSeed, contractIds: string[], taskIds: string[]): Promise<void> {
  const taskObjectReadable = (person: LimitedPerson, task: 'hidden' | 'hiddenParticipant' | 'visible'): boolean =>
    set(readable[person]).has(task === 'visible' ? 'CE' : 'CH');
  const taskReadable = (person: LimitedPerson, task: 'hidden' | 'hiddenParticipant' | 'visible'): boolean =>
    taskObjectReadable(person, task) || (task === 'hiddenParticipant' && person === 'paul');
  for (const person of ['marta', 'paul', 'rita', 'claire', 'rob', 'nina'] as LimitedPerson[]) {
    assert.equal(await apply(s.persons[person]), 'limited', `${person}: limited`);
    const tasks = sortedIds((await q(`SELECT id::text AS id FROM tasks WHERE id = ANY ($1::uuid[])`, [taskIds])).map((r) => r.id));
    const expectedTasks = (['hidden', 'hiddenParticipant', 'visible'] as const)
      .filter((task) => taskReadable(person, task)).map((task) => s.tasks[task]).sort();
    assert.deepEqual(tasks, expectedTasks, `${person}: contract tasks visible (participations included)`);

    const contractEntries = sortedIds((await q(
      `SELECT entity_id::text AS id FROM search_index WHERE entity_type = 'contracts' AND entity_id = ANY ($1::uuid[])`, [contractIds],
    )).map((r) => r.id));
    assert.deepEqual(contractEntries, sortedIds([...set(readable[person])].map((label) => s.contracts[label])), `${person}: contract entries of the search index`);

    const taskEntries = sortedIds((await q(
      `SELECT entity_id::text AS id FROM search_index WHERE entity_type = 'tasks' AND entity_id = ANY ($1::uuid[])`, [taskIds],
    )).map((r) => r.id));
    const expectedEntries = (['hidden', 'hiddenParticipant', 'visible'] as const)
      .filter((task) => taskObjectReadable(person, task)).map((task) => s.tasks[task]).sort();
    // A participant's task of a hidden contract stays out of the search: its vector names the contract.
    assert.deepEqual(taskEntries, expectedEntries, `${person}: task entries of the search index`);
    await apply(s.persons.ulla);
  }
  console.log('  tasks and search index of contracts: a hidden contract task is invisible or participant-only, its search entry stays out (§4.4, §5.4): OK');
}

async function testRoleWithoutContext(s: ContractSeed): Promise<void> {
  await apply(s.persons.ulla);
  await client.query('SAVEPOINT data_access_no_context');
  try {
    await client.query(`SET LOCAL ROLE ${LIMITED_ROLE}`);
    for (const table of ['contracts', ...FOLLOWS.map((c) => c.table), ...DOCUMENTS.map((c) => c.table), ...LINKS.map((l) => l.table)]) {
      assert.equal((await q(`SELECT count(*)::int AS n FROM ${table}`))[0].n, 0, `no context: ${table} shows nothing`);
    }
    assert.equal((await attempt(`INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES (app_current_tenant(), 'x', $1, $2, '2026-01-01')`, [s.fr, s.supplier])).code, '42501', 'no context: create a contract refused');
    assert.equal((await attempt(`INSERT INTO contract_contacts (tenant_id, contract_id, contact_id, role, origin) VALUES (app_current_tenant(), $1, $2, 'other', 'manual')`, [s.contracts.CF, s.contact2])).code, '42501', 'no context: a contract contact refused');
    for (const type of ['contract_document', 'application_contract', 'asset_contract', 'technology_contract']) {
      assert.equal(await hiddenCount(type, s.contracts.CF), null, `no context: hidden count ${type}`);
    }
    assert.equal((await q(`SELECT data_access_can_read($1, 'contract', $2) AS r`, [s.persons.ulla, s.contracts.CF]))[0].r, null, 'no context: can_read');
    assert.equal((await q(`SELECT data_access_contract_visible($1) AS v`, [s.contracts.CF]))[0].v, false, 'no context: depth function');
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT data_access_no_context');
  }
  console.log('  role taken without context: nothing visible, nothing writable, disclosures NULL: OK');
}

async function testUnscoped(s: ContractSeed): Promise<void> {
  assert.equal(await apply(s.persons.ulla), 'all');
  assert.equal((await q(`SELECT current_user AS u`))[0].u, appRoleName(), 'unscoped: the application role');
  assert.equal((await q(`SELECT count(*)::int AS n FROM contracts`))[0].n, ALL_CONTRACTS.length, 'unscoped: every contract');
  assert.equal(await affected(`UPDATE contracts SET name = name`), ALL_CONTRACTS.length, 'unscoped: every contract updated');
  assert.equal(await affected(`DELETE FROM contracts`), ALL_CONTRACTS.length, 'unscoped: every contract deleted');
  const values = (await q(`SELECT bool_and(data_access_contract_visible(id) AND data_access_contract_modifiable(id)) AS v FROM contracts`))[0];
  assert.equal(values.v, true, 'unscoped: depth functions true');
  for (const type of ['contract_document', 'application_contract', 'asset_contract', 'technology_contract']) {
    assert.notEqual(await hiddenCount(type, s.contracts.CF), null, `unscoped: hidden count ${type} answers`);
  }
  console.log('  unscoped: every contract, depth functions true, disclosures answer (§10.2): OK');
}

async function run(): Promise<void> {
  client = await connect(APP_URL);
  try {
    if (!(await roleExists(client))) {
      if (process.env.CI) assert.fail(`CI installs ${LIMITED_ROLE} before the migrations (infra/scripts/data-access-role.sql)`);
      console.log(`data access contract policies: ${LIMITED_ROLE} not installed, skipped`);
      return;
    }
    console.log('data access contract policies (lot 5, run 5A)');
    await client.query('BEGIN');
    try {
      const s = await seedContracts(client);
      const contractIds = ALL_CONTRACTS.map((label) => s.contracts[label]);
      const taskIds = Object.values(s.tasks);
      await testUnscoped(s);
      await testReadAndWrite(s);
      await testPlacement(s);
      await testLinkTriggers(s);
      await testDisclosures(s);
      await testTasksAndSearch(s, contractIds, taskIds);
      await testRoleWithoutContext(s);
    } finally {
      await client.query('ROLLBACK');
    }
    console.log('data access contract policies: all scenarios passed');
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
