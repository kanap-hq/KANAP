// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lineEditableSql } from '../line-write-checks';
import { contractEditableSql } from '../contract-write-checks';
import { APP_URL, LIMITED_ROLE, NodeSpec, PgClient, connect, roleExists, seedNodes, seedPerson, seedRole } from './data-access-test-helpers';
import { nextItemNumber } from './data-access-line-seed';

/**
 * Data-scoped access, amendment of 2026-11-21 (planning/data-scoped-access/spec.md §2.3, §4.1,
 * §4.3, §6.4; migration 1856250000000): an edit node on the cost center of a line, or on the place
 * of a contract, is enough to modify it, whatever its company. Placing (create, move) keeps the
 * placement rule. At the policy level, as the application role taking the limited role through
 * data_access_apply(); one transaction, rolled back; each write under a savepoint.
 *
 * Tree: companies A, B, C; group G (no company) with the centres X and Y of B; group H with the
 * centre Z of C. Line L is paid by A and charged to X; line LZ is paid by C and charged to Z.
 * Contract K belongs to A and sits on X; contract K2 belongs to A and sits on the group G.
 * Persons (role Budget member, limited unless said):
 *   P   X and Y in Edit (two centres of B, no company node)
 *   Gp  the group G in Edit (above X and Y)
 *   Bp  the company B in Edit (data_access_apply unfolds B's centres X and Y into the edit nodes)
 *   Q   X in Read
 *   R   Z in Edit
 *   Ulla mode all
 *
 * Needs the role kanap_data_limited (CI installs it); skipped without it, failed in CI.
 */

let client: PgClient;

async function q(sql: string, params?: unknown[]): Promise<any[]> {
  return (await client.query(sql, params)).rows;
}

/** A write under a savepoint, rolled back: the number of rows it touched, or its SQLSTATE. */
async function attempt(sql: string, params: unknown[] = []): Promise<number | string> {
  await client.query('SAVEPOINT edit_by_centre');
  try {
    const result = (await client.query(sql, params)) as unknown as { rowCount: number };
    return result.rowCount;
  } catch (error: any) {
    return String(error?.code ?? error);
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT edit_by_centre');
  }
}

type Person = 'p' | 'gp' | 'bp' | 'q' | 'r' | 'ulla';

type Fixture = {
  a: string; b: string; c: string;
  g: string; x: string; y: string; h: string; z: string;
  line: string; version: string; lineZ: string;
  axis: string; category: string;
  supplier: string; contact: string;
  contract: string; contractOnGroup: string;
  lineTask: string; contractTask: string;
  persons: Record<Person, string>;
};

async function seedFixture(): Promise<Fixture> {
  const tenantId = randomUUID();
  const tag = tenantId.slice(0, 8);
  await q(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `da-centre-${tag}`, `Data access centre ${tag}`],
  );
  await q(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const company = async (name: string) => (await q(
    `INSERT INTO companies (tenant_id, name, country_iso, city, status) VALUES ($1, $2, 'FR', 'Lyon', 'enabled') RETURNING id`,
    [tenantId, `${name} ${tag}`],
  ))[0].id as string;
  const a = await company('Company A');
  const b = await company('Company B');
  const c = await company('Company C');
  const node = async (code: string, kind: string, parent: string | null, companyId: string | null) => (await q(
    `INSERT INTO cost_centers (tenant_id, code, kind, name, parent_id, company_id, status)
     VALUES ($1, $2, $3, $2, $4, $5, 'enabled') RETURNING id`,
    [tenantId, code, kind, parent, companyId],
  ))[0].id as string;
  const g = await node('G', 'group', null, null);
  const x = await node('X', 'cost_center', g, b);
  const y = await node('Y', 'cost_center', g, b);
  const h = await node('H', 'group', null, null);
  const z = await node('Z', 'cost_center', h, c);

  const member = await seedRole(client, tenantId, 'Budget member');
  const person = async (nodes: NodeSpec[], mode: 'limited' | 'all' = 'limited') => {
    const id = await seedPerson(client, tenantId, mode, member);
    await seedNodes(client, tenantId, id, nodes);
    return id;
  };
  const persons: Record<Person, string> = {
    p: await person([{ type: 'cost_center', id: x, access: 'edit' }, { type: 'cost_center', id: y, access: 'edit' }]),
    gp: await person([{ type: 'cost_center', id: g, access: 'edit' }]),
    bp: await person([{ type: 'company', id: b, access: 'edit' }]),
    q: await person([{ type: 'cost_center', id: x, access: 'read' }]),
    r: await person([{ type: 'cost_center', id: z, access: 'edit' }]),
    ulla: await person([], 'all'),
  };

  const lineOf = async (companyId: string, centreId: string, name: string) => (await q(
    `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, paying_company_id, cost_center_id)
     VALUES ($1, $2, 'EUR', '2026-01-01', $3, $4, $5) RETURNING id`,
    [tenantId, `${name} ${tag}`, nextItemNumber(), companyId, centreId],
  ))[0].id as string;
  const line = await lineOf(a, x, 'Line A/X');
  const lineZ = await lineOf(c, z, 'Line C/Z');
  const version = (await q(
    `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, as_of_date, budget_year)
     VALUES ($1, $2, 'Budget 2026', '2026-01-01', 2026) RETURNING id`, [tenantId, line],
  ))[0].id as string;
  await q(`INSERT INTO spend_amounts (tenant_id, version_id, period, planned) VALUES ($1, $2, '2026-01-01', 100)`, [tenantId, version]);
  await q(`INSERT INTO spend_allocations (tenant_id, version_id, company_id, allocation_pct) VALUES ($1, $2, $3, 100)`, [tenantId, version, b]);
  const axis = (await q(`INSERT INTO analytics_axes (tenant_id, code, name) VALUES ($1, $2, $2) RETURNING id`, [tenantId, `axis-${tag}`]))[0].id as string;
  const category = (await q(`INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, 'Value') RETURNING id`, [tenantId, axis]))[0].id as string;
  await q(`INSERT INTO spend_links (tenant_id, spend_item_id, url) VALUES ($1, $2, 'https://example.invalid/l')`, [tenantId, line]);
  await q(
    `INSERT INTO spend_attachments (tenant_id, spend_item_id, original_filename, stored_filename, storage_path)
     VALUES ($1, $2, 'l.pdf', 'l.pdf', 'spec/l.pdf')`, [tenantId, line],
  );

  const supplier = (await q(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, `Supplier ${tag}`]))[0].id as string;
  const contact = (await q(`INSERT INTO contacts (tenant_id, email) VALUES ($1, $2) RETURNING id`, [tenantId, `c-${tag}@example.invalid`]))[0].id as string;
  const contractOf = async (name: string, place: string) => (await q(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, cost_center_id)
     VALUES ($1, $2, $3, $4, '2026-01-01', $5) RETURNING id`,
    [tenantId, `${name} ${tag}`, a, supplier, place],
  ))[0].id as string;
  const contract = await contractOf('Contract A/X', x);
  const contractOnGroup = await contractOf('Contract A/G', g);
  await q(`INSERT INTO contract_contacts (tenant_id, contract_id, contact_id, role, origin) VALUES ($1, $2, $3, 'other', 'manual')`, [tenantId, contract, contact]);
  await q(`INSERT INTO contract_compliance_items (tenant_id, contract_id, requirement) VALUES ($1, $2, 'requirement_a')`, [tenantId, contract]);
  await q(
    `INSERT INTO contract_attachments (tenant_id, contract_id, original_filename, stored_filename, storage_path)
     VALUES ($1, $2, 'k.pdf', 'k.pdf', 'spec/k.pdf')`, [tenantId, contract],
  );
  await q(`INSERT INTO contract_links (tenant_id, contract_id, url) VALUES ($1, $2, 'https://example.invalid/k')`, [tenantId, contract]);

  const task = async (type: string, objectId: string) => (await q(
    `INSERT INTO tasks (tenant_id, title, item_number, related_object_type, related_object_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, `Task of ${type} ${tag}`, nextItemNumber(), type, objectId],
  ))[0].id as string;
  const lineTask = await task('spend_item', line);
  const contractTask = await task('contract', contract);

  return {
    a, b, c, g, x, y, h, z, line, version, lineZ, axis, category, supplier, contact,
    contract, contractOnGroup, lineTask, contractTask, persons,
  };
}

async function apply(f: Fixture, person: Person): Promise<void> {
  const mode = (await q(`SELECT data_access_apply($1) AS mode`, [f.persons[person]]))[0].mode;
  assert.equal(mode, person === 'ulla' ? 'all' : 'limited', `${person}: access applied`);
}

const EDITORS: Array<[Person, string]> = [
  ['p', 'P, X and Y in Edit'],
  ['gp', 'Gp, the group G above X in Edit'],
  ['bp', 'Bp, the company B in Edit (its centres unfolded into the edit nodes)'],
];

/** Cases 1 to 6 for a person whose edit node covers the line's centre but not its company. */
async function testLineEditor(f: Fixture, person: Person, who: string): Promise<void> {
  await apply(f, person);
  // 1. Read, and editable in the list (the column the list and the page read).
  const listed = await q(`SELECT i.id, ${lineEditableSql('i.')} AS editable FROM spend_items i`);
  assert.deepEqual(listed.map((row) => row.id), [f.line], `${who}: case 1, reads L (paid by A, charged to X) and nothing else`);
  assert.equal(listed[0].editable, true, `${who}: case 1, L is editable in the list`);

  // 2. Modify the line and the tables that follow it.
  assert.equal(await attempt(`UPDATE spend_items SET description = 'Edited through its centre', product_name = product_name WHERE id = $1`, [f.line]), 1,
    `${who}: case 2, updates L's description`);
  assert.equal(await attempt(`UPDATE spend_amounts SET planned = 250 WHERE version_id = $1`, [f.version]), 1, `${who}: case 2, updates an amount of L`);
  assert.equal(await attempt(`INSERT INTO spend_amounts (tenant_id, version_id, period, planned) VALUES (app_current_tenant(), $1, '2026-02-01', 5)`, [f.version]), 1,
    `${who}: case 2, inserts an amount of L`);
  assert.equal(await attempt(`DELETE FROM spend_amounts WHERE version_id = $1`, [f.version]), 1, `${who}: case 2, deletes an amount of L`);
  assert.equal(await attempt(`INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, as_of_date, budget_year)
    VALUES (app_current_tenant(), $1, 'Budget 2027', '2027-01-01', 2027)`, [f.line]), 1, `${who}: case 2, inserts a version of L`);
  assert.equal(await attempt(`INSERT INTO spend_allocations (tenant_id, version_id, company_id, allocation_pct) VALUES (app_current_tenant(), $1, $2, 10)`, [f.version, f.a]), 1,
    `${who}: case 2, inserts an allocation of L`);
  assert.equal(await attempt(`UPDATE spend_allocations SET allocation_pct = 90 WHERE version_id = $1`, [f.version]), 1, `${who}: case 2, updates an allocation of L`);
  assert.equal(await attempt(`DELETE FROM spend_allocations WHERE version_id = $1`, [f.version]), 1, `${who}: case 2, deletes an allocation of L`);
  assert.equal(await attempt(`INSERT INTO spend_item_analytics_values (tenant_id, item_id, axis_id, category_id) VALUES (app_current_tenant(), $1, $2, $3)`,
    [f.line, f.axis, f.category]), 1, `${who}: case 2, sets a dimension value of L`);
  assert.equal(await attempt(`UPDATE spend_links SET url = 'https://example.invalid/l2' WHERE spend_item_id = $1`, [f.line]), 1, `${who}: case 2, updates a link of L`);
  assert.equal(await attempt(`DELETE FROM spend_links WHERE spend_item_id = $1`, [f.line]), 1, `${who}: case 2, deletes a link of L`);
  assert.equal(await attempt(`INSERT INTO spend_attachments (tenant_id, spend_item_id, original_filename, stored_filename, storage_path)
    VALUES (app_current_tenant(), $1, 'm.pdf', 'm.pdf', 'spec/m.pdf')`, [f.line]), 1, `${who}: case 2, attaches a file to L`);
  assert.equal(await attempt(`DELETE FROM spend_attachments WHERE spend_item_id = $1`, [f.line]), 1, `${who}: case 2, deletes an attachment of L`);
  // Tasks of the line: create, update, delete, and their elements through data_access_task_modifiable.
  assert.equal(await attempt(`INSERT INTO tasks (tenant_id, title, item_number, related_object_type, related_object_id)
    VALUES (app_current_tenant(), 'New task of L', $1, 'spend_item', $2)`, [nextItemNumber(), f.line]), 1, `${who}: case 2, creates a task of L`);
  assert.equal(await attempt(`UPDATE tasks SET title = 'Renamed' WHERE id = $1`, [f.lineTask]), 1, `${who}: case 2, updates a task of L`);
  assert.equal(await attempt(`DELETE FROM tasks WHERE id = $1`, [f.lineTask]), 1, `${who}: case 2, deletes a task of L`);
  assert.equal((await q(`SELECT data_access_task_modifiable($1) AS m`, [f.lineTask]))[0].m, true, `${who}: case 2, a task of L is modifiable`);
  assert.equal(await attempt(`INSERT INTO task_time_entries (tenant_id, task_id, hours, logged_at) VALUES (app_current_tenant(), $1, 1, now())`, [f.lineTask]), 1,
    `${who}: case 2, logs time on a task of L`);

  // 3. Creating a line (A, X) stays refused: placing needs the centre's own company.
  assert.equal(await attempt(`INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, paying_company_id, cost_center_id)
    VALUES (app_current_tenant(), 'New A/X', 'EUR', '2026-01-01', $1, $2, $3)`, [nextItemNumber(), f.a, f.x]), '42501', `${who}: case 3, cannot create a line (A, X)`);

  // 4. Moves to places that are not placable: the placement trigger refuses them.
  assert.equal(await attempt(`UPDATE spend_items SET cost_center_id = $2 WHERE id = $1`, [f.line, f.y]), '42501', `${who}: case 4, cannot move L to (A, Y)`);
  assert.equal(await attempt(`UPDATE spend_items SET paying_company_id = $2 WHERE id = $1`, [f.line, f.c]), '42501', `${who}: case 4, cannot move L to (C, X)`);
  assert.equal(await attempt(`UPDATE spend_items SET cost_center_id = NULL WHERE id = $1`, [f.line]), '42501', `${who}: case 4, cannot clear L's centre`);

  // 5. Bringing the line back to the centre's company: placable, accepted.
  assert.equal(await attempt(`UPDATE spend_items SET paying_company_id = $2 WHERE id = $1`, [f.line, f.b]), 1, `${who}: case 5, moves L to (B, X)`);

  // 6. Deleting stays reserved to unscoped persons.
  assert.equal(await attempt(`DELETE FROM spend_items WHERE id = $1`, [f.line]), 0, `${who}: case 6, cannot delete L`);
  await apply(f, 'ulla');
}

async function testLines(f: Fixture): Promise<void> {
  for (const [person, who] of EDITORS) await testLineEditor(f, person, who);

  // 7. Read only on X: L is read only.
  await apply(f, 'q');
  const read = await q(`SELECT i.id, ${lineEditableSql('i.')} AS editable FROM spend_items i`);
  assert.deepEqual(read.map((row) => [row.id, row.editable]), [[f.line, false]], 'case 7, Q reads L, not editable');
  assert.equal(await attempt(`UPDATE spend_items SET description = 'x' WHERE id = $1`, [f.line]), 0, 'case 7, Q updates no row of L');
  assert.equal(await attempt(`UPDATE spend_amounts SET planned = 1 WHERE version_id = $1`, [f.version]), 0, 'case 7, Q updates no amount of L');
  assert.equal(await attempt(`INSERT INTO spend_amounts (tenant_id, version_id, period, planned) VALUES (app_current_tenant(), $1, '2026-03-01', 5)`, [f.version]), '42501',
    'case 7, Q cannot insert an amount of L');

  // 8. A centre elsewhere: L is invisible.
  await apply(f, 'r');
  assert.deepEqual((await q(`SELECT id FROM spend_items`)).map((row) => row.id), [f.lineZ], 'case 8, R reads LZ only, L is invisible');
  assert.equal(await attempt(`UPDATE spend_items SET description = 'x' WHERE id = $1`, [f.line]), 0, 'case 8, R updates no row of L');
  await apply(f, 'ulla');
  console.log('  lines: an edit node on the centre modifies a line paid by another company; create, move, delete as before (cases 1-9): OK');
}

/** Case 12 and 13 for a person whose edit node covers the contract's place but not its company. */
async function testContractEditor(f: Fixture, person: Person, who: string): Promise<void> {
  await apply(f, person);
  // 12. Read and modify K and what follows it.
  const read = await q(`SELECT c.id, ${contractEditableSql('c.')} AS editable FROM contracts c WHERE c.id = $1`, [f.contract]);
  assert.deepEqual(read.map((row) => row.editable), [true], `${who}: case 12, reads K (company A, place X), modifiable`);
  assert.equal(await attempt(`UPDATE contracts SET name = 'Edited through its place' WHERE id = $1`, [f.contract]), 1, `${who}: case 12, updates K`);
  assert.equal(await attempt(`UPDATE contract_contacts SET role = 'technical' WHERE contract_id = $1`, [f.contract]), 1, `${who}: case 12, updates a contact of K`);
  assert.equal(await attempt(`DELETE FROM contract_contacts WHERE contract_id = $1`, [f.contract]), 1, `${who}: case 12, removes a contact of K`);
  assert.equal(await attempt(`INSERT INTO contract_compliance_items (tenant_id, contract_id, requirement) VALUES (app_current_tenant(), $1, 'requirement_b')`, [f.contract]), 1,
    `${who}: case 12, adds a compliance item to K`);
  assert.equal(await attempt(`UPDATE contract_compliance_items SET requirement = requirement WHERE contract_id = $1`, [f.contract]), 1, `${who}: case 12, updates a compliance item of K`);
  assert.equal((await q(`SELECT count(*)::int AS n FROM contract_attachments WHERE contract_id = $1`, [f.contract]))[0].n, 1, `${who}: case 12, reads K's attachments`);
  assert.equal(await attempt(`INSERT INTO contract_attachments (tenant_id, contract_id, original_filename, stored_filename, storage_path)
    VALUES (app_current_tenant(), $1, 'n.pdf', 'n.pdf', 'spec/n.pdf')`, [f.contract]), 1, `${who}: case 12, attaches a file to K`);
  assert.equal(await attempt(`DELETE FROM contract_attachments WHERE contract_id = $1`, [f.contract]), 1, `${who}: case 12, deletes an attachment of K`);
  assert.equal(await attempt(`UPDATE contract_links SET url = 'https://example.invalid/k2' WHERE contract_id = $1`, [f.contract]), 1, `${who}: case 12, updates a document link of K`);
  assert.equal(await attempt(`INSERT INTO tasks (tenant_id, title, item_number, related_object_type, related_object_id)
    VALUES (app_current_tenant(), 'New task of K', $1, 'contract', $2)`, [nextItemNumber(), f.contract]), 1, `${who}: case 12, creates a task of K`);
  assert.equal(await attempt(`UPDATE tasks SET title = 'Renamed' WHERE id = $1`, [f.contractTask]), 1, `${who}: case 12, updates a task of K`);
  assert.equal(await attempt(`DELETE FROM tasks WHERE id = $1`, [f.contractTask]), 1, `${who}: case 12, deletes a task of K`);

  // 13. Placing keeps the placement rule; deleting stays reserved.
  assert.equal(await attempt(`INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, cost_center_id)
    VALUES (app_current_tenant(), 'New A/X', $1, $2, '2026-01-01', $3)`, [f.a, f.supplier, f.x]), '42501', `${who}: case 13, cannot create a contract (A, X)`);
  assert.equal(await attempt(`UPDATE contracts SET company_id = $2 WHERE id = $1`, [f.contract, f.c]), '42501', `${who}: case 13, cannot move K to company C`);
  assert.equal(await attempt(`UPDATE contracts SET cost_center_id = $2 WHERE id = $1`, [f.contract, f.z]), '42501', `${who}: case 13, cannot move K to Z, outside the edit nodes`);
  assert.equal(await attempt(`UPDATE contracts SET cost_center_id = NULL WHERE id = $1`, [f.contract]), '42501', `${who}: case 13, cannot take K off its place`);
  assert.equal(await attempt(`UPDATE contracts SET company_id = $2 WHERE id = $1`, [f.contract, f.b]), 1, `${who}: case 13, moves K to company B (placable)`);
  assert.equal(await attempt(`DELETE FROM contracts WHERE id = $1`, [f.contract]), 0, `${who}: case 13, cannot delete K`);
  await apply(f, 'ulla');
}

async function testContracts(f: Fixture): Promise<void> {
  for (const [person, who] of EDITORS) await testContractEditor(f, person, who);

  // The contract on the group G: only the group node covers its place. The company node B unfolds
  // to B's centres, not to the group above them.
  const onGroup: Array<[Person, number]> = [['p', 0], ['gp', 1], ['bp', 0], ['q', 0]];
  for (const [person, expected] of onGroup) {
    await apply(f, person);
    assert.equal(await attempt(`UPDATE contracts SET name = 'Edited on G' WHERE id = $1`, [f.contractOnGroup]), expected,
      `case 12, ${person}: K2 (company A, place G) ${expected ? 'modifiable' : 'not modifiable'}`);
  }

  // Read only on X: K is read only, its tables too.
  await apply(f, 'q');
  assert.equal((await q(`SELECT data_access_contract_modifiable($1) AS m`, [f.contract]))[0].m, false, 'case 12, Q: K is not modifiable');
  assert.equal(await attempt(`UPDATE contracts SET name = 'x' WHERE id = $1`, [f.contract]), 0, 'case 12, Q updates no row of K');
  assert.equal(await attempt(`INSERT INTO contract_compliance_items (tenant_id, contract_id, requirement) VALUES (app_current_tenant(), $1, 'requirement_c')`, [f.contract]), '42501',
    'case 12, Q cannot add a compliance item to K');
  await apply(f, 'r');
  assert.equal((await q(`SELECT count(*)::int AS n FROM contracts WHERE id = $1`, [f.contract]))[0].n, 0, 'R does not read K');
  await apply(f, 'ulla');
  console.log('  contracts: an edit node on the place modifies a contract of another company; create, move, delete as before (cases 12-13): OK');
}

/** Case 14: the links between K and L, written by the link triggers (contract readable, line modifiable). */
async function testLinks(f: Fixture): Promise<void> {
  for (const [person, who] of EDITORS) {
    await apply(f, person);
    assert.equal(await attempt(`INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES (app_current_tenant(), $1, $2)`, [f.contract, f.line]), 1,
      `${who}: case 14, links K and L (L modifiable through X)`);
    assert.equal(await attempt(`UPDATE spend_items SET contract_id = $2 WHERE id = $1`, [f.line, f.contract]), 1, `${who}: case 14, names K as L's contract`);
  }
  // Read only on X: L is read only, so no link.
  await apply(f, 'q');
  assert.equal(await attempt(`INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES (app_current_tenant(), $1, $2)`, [f.contract, f.line]), '42501',
    'case 14, Q cannot link K and L (L read only)');
  assert.equal(await attempt(`UPDATE spend_items SET contract_id = $2 WHERE id = $1`, [f.line, f.contract]), 0, 'case 14, Q cannot name K on L (L read only: no row)');
  await apply(f, 'ulla');
  console.log('  links between K and L: allowed through the centre, refused in read (case 14): OK');
}

/** Tasks: a task moves only onto a line or a contract the person may modify (data_access_tasks_placement). */
async function testTaskMoves(f: Fixture): Promise<void> {
  await apply(f, 'p');
  assert.equal(await attempt(`UPDATE tasks SET related_object_type = 'spend_item', related_object_id = $2 WHERE id = $1`, [f.contractTask, f.line]), 1,
    'tasks: P moves a task of K onto L (modifiable through X)');
  assert.equal(await attempt(`UPDATE tasks SET related_object_id = $2 WHERE id = $1`, [f.lineTask, f.lineZ]), '42501',
    'tasks: P cannot move a task of L onto LZ, a line she cannot modify');
  assert.equal(await attempt(`UPDATE tasks SET related_object_type = 'contract', related_object_id = $2 WHERE id = $1`, [f.lineTask, f.contractOnGroup]), '42501',
    'tasks: P cannot move a task of L onto K2, a contract she cannot modify');
  await apply(f, 'q');
  assert.equal(await attempt(`UPDATE tasks SET title = 'x' WHERE id = $1`, [f.lineTask]), 0, 'tasks: Q updates no task of L (read only)');
  await apply(f, 'ulla');
  console.log('  tasks: moved onto a line or contract modifiable through the centre only: OK');
}

/** data_access_line_editable on values (the write checks): the centre is enough, whatever the company. */
async function testLineEditableValues(f: Fixture): Promise<void> {
  const editable = async (company: string | null, centre: string | null) =>
    (await q(`SELECT data_access_line_editable($1::uuid, $2::uuid, NULL, NULL) AS e, data_access_placable_line($1::uuid, $2::uuid) AS p`, [company, centre]))[0];
  await apply(f, 'p');
  assert.deepEqual(await editable(f.a, f.x), { e: true, p: false }, 'P: (A, X) editable, not placable');
  assert.deepEqual(await editable(f.b, f.x), { e: true, p: true }, 'P: (B, X) editable and placable');
  assert.deepEqual(await editable(f.a, null), { e: false, p: false }, 'P: (A, no centre) neither');
  assert.deepEqual(await editable(f.c, f.z), { e: false, p: false }, 'P: (C, Z) neither');
  await apply(f, 'q');
  assert.deepEqual(await editable(f.a, f.x), { e: false, p: false }, 'Q: (A, X) neither (read only)');
  await apply(f, 'ulla');
  assert.equal((await editable(f.a, f.x)).e, true, 'mode all: editable');
  console.log('  data_access_line_editable on values: the centre is enough, placing is not: OK');
}

async function run(): Promise<void> {
  client = await connect(APP_URL);
  try {
    if (!(await roleExists(client))) {
      if (process.env.CI) assert.fail(`CI installs ${LIMITED_ROLE} before the migrations (infra/scripts/data-access-role.sql)`);
      console.log(`data access edit by centre: ${LIMITED_ROLE} not installed, skipped`);
      return;
    }
    console.log('data access edit by centre');
    await client.query('BEGIN');
    try {
      const f = await seedFixture();
      await testLineEditableValues(f);
      await testLines(f);
      await testContracts(f);
      await testLinks(f);
      await testTaskMoves(f);
    } finally {
      await client.query('ROLLBACK');
    }
    console.log('data access edit by centre: all scenarios passed');
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
