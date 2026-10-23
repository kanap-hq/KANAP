// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  APP_URL,
  LIMITED_ROLE,
  NodeSpec,
  PgClient,
  appRoleName,
  connect,
  roleExists,
  seedNodes,
  seedPerson,
  seedRole,
  sqlStateIn,
} from './data-access-test-helpers';

/**
 * Data-scoped access, lot 2 run 2A (planning/data-scoped-access/spec.md §2.2-2.5, §4.1, §6.4,
 * §6.5, §10.1, §10.2, §10.4): the policies of the budget lines and of the tables that follow a
 * line, the placement trigger and the SECURITY DEFINER trigger functions, as the application role
 * taking the limited role through data_access_apply(). One transaction, rolled back; each write
 * under a savepoint.
 *
 * Reference example: companies Alpha France (FR) and Alpha Espagne (ES); group Infrastructure
 * (INF) with INF-FR (FR) and INF-ES (ES). Lines:
 *   L1 FR / INF-FR   L2 FR / INF-ES   L3 ES / INF-FR (paid by another company than its centre's)
 *   L4 ES / INF-ES   L5 ES / no centre   L6 no company, no centre, Nina owner
 * Persons (limited unless said): Marta (ES edit), Paul (INF read), Rita (INF-FR edit + INF read),
 * Claire (all, edit), Rob (all, read), Nina (no node), an Administrator (limited mode, role
 * Administrator: everything), Ulla (mode all).
 *
 * Needs the role kanap_data_limited (CI installs it); skipped without it, failed in CI.
 */

type Label = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';
const LABELS: Label[] = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];

type Seed = {
  tenantId: string;
  fr: string;
  es: string;
  inf: string;
  infFr: string;
  infEs: string;
  lines: Record<Label, string>;
  versions: Record<Label, string>;
  roundInputs: Record<Label, string>;
  contact2: string;
  axis2: string;
  category2: string;
  persons: Record<'marta' | 'paul' | 'rita' | 'claire' | 'rob' | 'nina' | 'admin' | 'ulla', string>;
};

let client: PgClient;
let itemNumber = 1000;

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

async function apply(userId: string): Promise<string> {
  return (await q(`SELECT data_access_apply($1) AS mode`, [userId]))[0].mode;
}

async function seed(): Promise<Seed> {
  const tenantId = randomUUID();
  const tag = tenantId.slice(0, 8);
  await q(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `da-lines-${tag}`, `Data access lines ${tag}`],
  );
  await q(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const company = async (name: string) => (await q(
    `INSERT INTO companies (tenant_id, name, country_iso, city, status) VALUES ($1, $2, 'FR', 'Lyon', 'enabled') RETURNING id`,
    [tenantId, `${name} ${tag}`],
  ))[0].id as string;
  const fr = await company('Alpha France');
  const es = await company('Alpha Espagne');
  const node = async (code: string, kind: string, parent: string | null, companyId: string | null) => (await q(
    `INSERT INTO cost_centers (tenant_id, code, kind, name, parent_id, company_id, status)
     VALUES ($1, $2, $3, $2, $4, $5, 'enabled') RETURNING id`,
    [tenantId, code, kind, parent, companyId],
  ))[0].id as string;
  const inf = await node('INF', 'group', null, null);
  const infFr = await node('INF-FR', 'cost_center', inf, fr);
  const infEs = await node('INF-ES', 'cost_center', inf, es);

  const member = await seedRole(client, tenantId, 'Budget member');
  const administrator = await seedRole(client, tenantId, 'Administrator');
  const limited = (nodes: NodeSpec[]) => async () => {
    const id = await seedPerson(client, tenantId, 'limited', member);
    await seedNodes(client, tenantId, id, nodes);
    return id;
  };
  const persons = {
    marta: await limited([{ type: 'company', id: es, access: 'edit' }])(),
    paul: await limited([{ type: 'cost_center', id: inf, access: 'read' }])(),
    rita: await limited([
      { type: 'cost_center', id: infFr, access: 'edit' },
      { type: 'cost_center', id: inf, access: 'read' },
    ])(),
    claire: await limited([{ type: 'all', access: 'edit' }])(),
    rob: await limited([{ type: 'all', access: 'read' }])(),
    nina: await limited([])(),
    admin: await seedPerson(client, tenantId, 'limited', administrator),
    ulla: await seedPerson(client, tenantId, 'all', member),
  };

  const contact = async (n: number) => (await q(
    `INSERT INTO contacts (tenant_id, email) VALUES ($1, $2) RETURNING id`, [tenantId, `c${n}-${tag}@example.invalid`],
  ))[0].id as string;
  const contact1 = await contact(1);
  const contact2 = await contact(2);
  const axis = async (code: string) => {
    const axisId = (await q(`INSERT INTO analytics_axes (tenant_id, code, name) VALUES ($1, $2, $2) RETURNING id`, [tenantId, `${code}-${tag}`]))[0].id;
    const categoryId = (await q(`INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, $3) RETURNING id`, [tenantId, axisId, `${code} value`]))[0].id;
    return { axisId: axisId as string, categoryId: categoryId as string };
  };
  const axis1 = await axis('a1');
  const axis2 = await axis('a2');

  const place: Record<Label, [string | null, string | null]> = {
    L1: [fr, infFr], L2: [fr, infEs], L3: [es, infFr], L4: [es, infEs], L5: [es, null], L6: [null, null],
  };
  const lines = {} as Record<Label, string>;
  const versions = {} as Record<Label, string>;
  const roundInputs = {} as Record<Label, string>;
  for (const label of LABELS) {
    const [companyId, centreId] = place[label];
    const line = (await q(
      `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, paying_company_id, cost_center_id, owner_it_id)
       VALUES ($1, $2, 'EUR', '2026-01-01', $3, $4, $5, $6) RETURNING id`,
      [tenantId, `DA line ${label} ${tag}`, itemNumber++, companyId, centreId, label === 'L6' ? persons.nina : null],
    ))[0].id as string;
    lines[label] = line;
    const version = (await q(
      `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, as_of_date, budget_year)
       VALUES ($1, $2, 'Budget 2026', '2026-01-01', 2026) RETURNING id`, [tenantId, line],
    ))[0].id as string;
    versions[label] = version;
    await q(`INSERT INTO spend_amounts (tenant_id, version_id, period, planned) VALUES ($1, $2, '2026-01-01', 100)`, [tenantId, version]);
    await q(`INSERT INTO spend_allocations (tenant_id, version_id, company_id, allocation_pct) VALUES ($1, $2, $3, 100)`, [tenantId, version, fr]);
    roundInputs[label] = (await q(
      `INSERT INTO spend_round_inputs (tenant_id, version_id, measure, period_start, period_end, method)
       VALUES ($1, $2, 'planned', '2026-01-01', '2026-12-31', 'manual') RETURNING id`, [tenantId, version],
    ))[0].id;
    await q(
      `INSERT INTO spend_round_input_lines (tenant_id, round_input_id, sort, label, quantity_unit, quantity, unit_price, price_basis, frequency, period_start, period_end)
       VALUES ($1, $2, 1, 'Piece', 'pieces', 1, 10, 'per_piece', 'once', '2026-01-01', '2026-12-31')`, [tenantId, roundInputs[label]],
    );
    await q(`INSERT INTO spend_item_analytics_values (tenant_id, item_id, axis_id, category_id) VALUES ($1, $2, $3, $4)`, [tenantId, line, axis1.axisId, axis1.categoryId]);
    await q(`INSERT INTO spend_item_contacts (tenant_id, spend_item_id, contact_id, role) VALUES ($1, $2, $3, 'commercial')`, [tenantId, line, contact1]);
    await q(`INSERT INTO spend_links (tenant_id, spend_item_id, url) VALUES ($1, $2, 'https://example.invalid')`, [tenantId, line]);
    await q(
      `INSERT INTO spend_attachments (tenant_id, spend_item_id, original_filename, stored_filename, storage_path)
       VALUES ($1, $2, 'a.pdf', 'a.pdf', 'spec/a.pdf')`, [tenantId, line],
    );
    await q(`INSERT INTO spend_tasks (tenant_id, item_id, title) VALUES ($1, $2, 'Follow up')`, [tenantId, line]);
  }
  const totals = await q(`SELECT count(*)::int AS n FROM spend_version_totals WHERE tenant_id = $1`, [tenantId]);
  assert.equal(totals[0].n, LABELS.length, 'the amounts trigger wrote one total per version');

  return {
    tenantId, fr, es, inf, infFr, infEs, lines, versions, roundInputs, contact2,
    axis2: axis2.axisId, category2: axis2.categoryId, persons,
  };
}

/** A table that follows a line: how its rows map to lines, and one write of each kind. */
type Child = {
  table: string;
  /** (k, line) of every row, read as the application role. */
  keys: string;
  /** k of the rows the current role sees. */
  visible: string;
  insert: ((s: Seed, line: Label) => [string, unknown[]]) | null;
  touch: string;
  remove: string;
};

const CHILDREN: Child[] = [
  {
    table: 'spend_versions',
    keys: `SELECT id::text AS k, spend_item_id::text AS line FROM spend_versions`,
    visible: `SELECT id::text AS k FROM spend_versions`,
    insert: (s, l) => [`INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, as_of_date, budget_year)
      VALUES (app_current_tenant(), $1, 'Budget 2027', '2027-01-01', 2027)`, [s.lines[l]]],
    touch: `UPDATE spend_versions SET notes = notes`,
    remove: `DELETE FROM spend_versions`,
  },
  {
    table: 'spend_amounts',
    keys: `SELECT a.id::text AS k, v.spend_item_id::text AS line FROM spend_amounts a JOIN spend_versions v ON v.id = a.version_id`,
    visible: `SELECT id::text AS k FROM spend_amounts`,
    insert: (s, l) => [`INSERT INTO spend_amounts (tenant_id, version_id, period, planned) VALUES (app_current_tenant(), $1, '2026-02-01', 5)`, [s.versions[l]]],
    touch: `UPDATE spend_amounts SET planned = planned`,
    remove: `DELETE FROM spend_amounts`,
  },
  {
    table: 'spend_allocations',
    keys: `SELECT a.id::text AS k, v.spend_item_id::text AS line FROM spend_allocations a JOIN spend_versions v ON v.id = a.version_id`,
    visible: `SELECT id::text AS k FROM spend_allocations`,
    insert: (s, l) => [`INSERT INTO spend_allocations (tenant_id, version_id, company_id, allocation_pct) VALUES (app_current_tenant(), $1, $2, 50)`, [s.versions[l], s.es]],
    touch: `UPDATE spend_allocations SET allocation_pct = allocation_pct`,
    remove: `DELETE FROM spend_allocations`,
  },
  {
    table: 'spend_round_inputs',
    keys: `SELECT r.id::text AS k, v.spend_item_id::text AS line FROM spend_round_inputs r JOIN spend_versions v ON v.id = r.version_id`,
    visible: `SELECT id::text AS k FROM spend_round_inputs`,
    insert: (s, l) => [`INSERT INTO spend_round_inputs (tenant_id, version_id, measure, period_start, period_end, method)
      VALUES (app_current_tenant(), $1, 'forecast', '2026-01-01', '2026-12-31', 'manual')`, [s.versions[l]]],
    touch: `UPDATE spend_round_inputs SET method = method`,
    remove: `DELETE FROM spend_round_inputs`,
  },
  {
    table: 'spend_round_input_lines',
    keys: `SELECT x.id::text AS k, v.spend_item_id::text AS line FROM spend_round_input_lines x
           JOIN spend_round_inputs r ON r.id = x.round_input_id JOIN spend_versions v ON v.id = r.version_id`,
    visible: `SELECT id::text AS k FROM spend_round_input_lines`,
    insert: (s, l) => [`INSERT INTO spend_round_input_lines (tenant_id, round_input_id, sort, label, quantity_unit, quantity, unit_price, price_basis, frequency, period_start, period_end)
      VALUES (app_current_tenant(), $1, 2, 'Piece 2', 'pieces', 1, 1, 'per_piece', 'once', '2026-01-01', '2026-12-31')`, [s.roundInputs[l]]],
    touch: `UPDATE spend_round_input_lines SET label = label`,
    remove: `DELETE FROM spend_round_input_lines`,
  },
  {
    table: 'spend_version_totals',
    keys: `SELECT t.version_id::text AS k, v.spend_item_id::text AS line FROM spend_version_totals t JOIN spend_versions v ON v.id = t.version_id`,
    visible: `SELECT version_id::text AS k FROM spend_version_totals`,
    // One total per version (primary key): written by the amounts' trigger, no second row.
    insert: null,
    touch: `UPDATE spend_version_totals SET planned = planned`,
    remove: `DELETE FROM spend_version_totals`,
  },
  {
    table: 'spend_item_analytics_values',
    keys: `SELECT item_id::text || ':' || axis_id::text AS k, item_id::text AS line FROM spend_item_analytics_values`,
    visible: `SELECT item_id::text || ':' || axis_id::text AS k FROM spend_item_analytics_values`,
    insert: (s, l) => [`INSERT INTO spend_item_analytics_values (tenant_id, item_id, axis_id, category_id) VALUES (app_current_tenant(), $1, $2, $3)`,
      [s.lines[l], s.axis2, s.category2]],
    touch: `UPDATE spend_item_analytics_values SET category_id = category_id`,
    remove: `DELETE FROM spend_item_analytics_values`,
  },
  {
    table: 'spend_item_contacts',
    keys: `SELECT id::text AS k, spend_item_id::text AS line FROM spend_item_contacts`,
    visible: `SELECT id::text AS k FROM spend_item_contacts`,
    insert: (s, l) => [`INSERT INTO spend_item_contacts (tenant_id, spend_item_id, contact_id, role) VALUES (app_current_tenant(), $1, $2, 'technical')`, [s.lines[l], s.contact2]],
    touch: `UPDATE spend_item_contacts SET role = role`,
    remove: `DELETE FROM spend_item_contacts`,
  },
  {
    table: 'spend_links',
    keys: `SELECT id::text AS k, spend_item_id::text AS line FROM spend_links`,
    visible: `SELECT id::text AS k FROM spend_links`,
    insert: (s, l) => [`INSERT INTO spend_links (tenant_id, spend_item_id, url) VALUES (app_current_tenant(), $1, 'https://example.invalid/2')`, [s.lines[l]]],
    touch: `UPDATE spend_links SET url = url`,
    remove: `DELETE FROM spend_links`,
  },
  {
    table: 'spend_attachments',
    keys: `SELECT id::text AS k, spend_item_id::text AS line FROM spend_attachments`,
    visible: `SELECT id::text AS k FROM spend_attachments`,
    insert: (s, l) => [`INSERT INTO spend_attachments (tenant_id, spend_item_id, original_filename, stored_filename, storage_path)
      VALUES (app_current_tenant(), $1, 'b.pdf', 'b.pdf', 'spec/b.pdf')`, [s.lines[l]]],
    touch: `UPDATE spend_attachments SET original_filename = original_filename`,
    remove: `DELETE FROM spend_attachments`,
  },
  {
    table: 'spend_tasks',
    keys: `SELECT id::text AS k, item_id::text AS line FROM spend_tasks`,
    visible: `SELECT id::text AS k FROM spend_tasks`,
    insert: (s, l) => [`INSERT INTO spend_tasks (tenant_id, item_id, title) VALUES (app_current_tenant(), $1, 'Second')`, [s.lines[l]]],
    touch: `UPDATE spend_tasks SET title = title`,
    remove: `DELETE FROM spend_tasks`,
  },
];

const TABLES_2A = ['spend_items', ...CHILDREN.map((c) => c.table)];

type Expectation = { readable: Label[]; modifiable: Label[] };
const ALL: Label[] = [...LABELS];
const EXPECTED: Record<'marta' | 'paul' | 'rita' | 'claire' | 'rob' | 'nina', Expectation> = {
  // Company ES: the lines it pays, and those of its centre INF-ES (L2); modifies what it pays.
  marta: { readable: ['L2', 'L3', 'L4', 'L5'], modifiable: ['L3', 'L4', 'L5'] },
  // Group INF in read: its centres' lines, not the Spanish line without centre, nothing to modify.
  paul: { readable: ['L1', 'L2', 'L3', 'L4'], modifiable: [] },
  // INF-FR edit inside INF read: the widest access wins on L1; L3 (paid by ES on INF-FR) is read only.
  rita: { readable: ['L1', 'L2', 'L3', 'L4'], modifiable: ['L1'] },
  claire: { readable: ALL, modifiable: ALL },
  rob: { readable: ALL, modifiable: [] },
  // No node: only the line it owns (responsible: read and edit), even without a company.
  nina: { readable: ['L6'], modifiable: ['L6'] },
};

function linesOf(s: Seed, labels: Label[]): Set<string> {
  return new Set(labels.map((l) => s.lines[l]));
}

async function lineInsert(s: Seed, company: string | null, centre: string | null, owner: string | null = null): Promise<string> {
  const sql = `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, paying_company_id, cost_center_id, owner_it_id)
               VALUES (app_current_tenant(), 'New line', 'EUR', '2026-01-01', $1, $2, $3, $4)`;
  const params = [itemNumber++, company, centre, owner];
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

/** §10.1 and §10.4 for one limited person: every table of 2A. */
async function checkPerson(s: Seed, name: keyof typeof EXPECTED, keyMaps: Map<string, Map<string, string>>): Promise<void> {
  const exp = EXPECTED[name];
  const readable = linesOf(s, exp.readable);
  const modifiable = linesOf(s, exp.modifiable);
  assert.equal(await apply(s.persons[name]), 'limited', `${name}: limited`);

  const seen = new Set((await q(`SELECT id FROM spend_items`)).map((r) => r.id));
  assert.deepEqual([...seen].sort(), [...readable].sort(), `${name}: readable lines`);
  assert.equal(await affected(`UPDATE spend_items SET description = description`), modifiable.size, `${name}: modifiable lines`);
  assert.equal(await affected(`DELETE FROM spend_items`), 0, `${name}: deleting a line is refused, even in edit nodes`);

  for (const child of CHILDREN) {
    const map = keyMaps.get(child.table)!;
    const expectVisible = [...map].filter(([, line]) => readable.has(line)).map(([k]) => k).sort();
    const expectModifiable = [...map].filter(([, line]) => modifiable.has(line)).length;
    const visible = (await q(child.visible)).map((r) => r.k).sort();
    assert.deepEqual(visible, expectVisible, `${name}: ${child.table} visible rows follow the readable lines`);
    assert.equal(await affected(child.touch), expectModifiable, `${name}: ${child.table} update reaches the modifiable lines only`);
    assert.equal(await affected(child.remove), expectModifiable, `${name}: ${child.table} delete reaches the modifiable lines only`);
    if (child.insert) {
      for (const label of LABELS) {
        const [sql, params] = child.insert(s, label);
        const state = await write(sql, params);
        const allowed = exp.modifiable.includes(label);
        assert.equal(state, allowed ? 'ok' : '42501', `${name}: ${child.table} insert on ${label} ${allowed ? 'allowed' : 'refused'}`);
      }
    }
  }
}

async function testPersons(s: Seed): Promise<void> {
  const keyMaps = new Map<string, Map<string, string>>();
  for (const child of CHILDREN) {
    const rows = await q(child.keys);
    keyMaps.set(child.table, new Map(rows.map((r) => [r.k, r.line])));
    assert.equal(rows.length, LABELS.length, `${child.table}: one seeded row per line`);
  }
  for (const name of Object.keys(EXPECTED) as Array<keyof typeof EXPECTED>) {
    await checkPerson(s, name, keyMaps);
    assert.equal(await apply(s.persons.ulla), 'all', 'back to the application role');
  }
  console.log('  read, update and delete scope of the 12 tables, per person (§10.1, §10.4): OK');
}

async function testPlacement(s: Seed): Promise<void> {
  const cases: Array<[keyof Seed['persons'], string | null, string | null, string | null, string]> = [
    ['marta', s.es, s.infEs, null, 'ok'],
    ['marta', s.es, null, null, 'ok'],
    ['marta', s.fr, s.infEs, null, '42501'],
    ['marta', s.fr, null, null, '42501'],
    ['rita', s.fr, s.infFr, null, 'ok'],
    ['rita', s.es, s.infFr, null, '42501'], // a line of an edit centre paid by another company
    ['rita', s.fr, null, null, '42501'],
    ['paul', s.fr, s.infFr, null, '42501'],
    ['rob', s.fr, s.infFr, null, '42501'],
    ['nina', s.fr, s.infFr, s.persons.nina, '42501'], // a participation never creates
    ['nina', null, null, s.persons.nina, '42501'],
    ['claire', null, null, null, 'ok'],
  ];
  for (const [person, company, centre, owner, expected] of cases) {
    await apply(s.persons[person]);
    assert.equal(await lineInsert(s, company, centre, owner), expected, `${person}: create a line (${company === s.fr ? 'FR' : company === s.es ? 'ES' : '-'}, ${centre === s.infFr ? 'INF-FR' : centre === s.infEs ? 'INF-ES' : '-'})`);
    await apply(s.persons.ulla);
  }

  const moves: Array<[keyof Seed['persons'], Label, string, unknown, string]> = [
    ['marta', 'L4', 'paying_company_id', s.fr, '42501'],
    ['marta', 'L4', 'cost_center_id', null, 'ok'],
    ['marta', 'L3', 'cost_center_id', s.infEs, 'ok'],
    ['rita', 'L1', 'cost_center_id', s.infEs, '42501'],
    ['rita', 'L1', 'paying_company_id', s.es, '42501'],
    ['nina', 'L6', 'paying_company_id', s.fr, '42501'], // owner: the trigger refuses the move
    ['nina', 'L6', 'description', 'edited by its owner', 'ok'],
    ['claire', 'L6', 'paying_company_id', s.fr, 'ok'],
  ];
  for (const [person, label, column, value, expected] of moves) {
    await apply(s.persons[person]);
    await client.query('SAVEPOINT data_access_move');
    let state = 'ok';
    try {
      const result = (await client.query(`UPDATE spend_items SET ${column} = $2 WHERE id = $1`, [s.lines[label], value])) as unknown as { rowCount: number };
      if (result.rowCount !== 1) state = `rows ${result.rowCount}`;
    } catch (error: any) {
      state = String(error?.code ?? error);
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT data_access_move');
    }
    assert.equal(state, expected, `${person}: set ${column} of ${label}`);
    await apply(s.persons.ulla);
  }

  // Out of access, read only: 0 rows, no error.
  await apply(s.persons.paul);
  assert.equal(await affected(`UPDATE spend_items SET description = 'x' WHERE id = $1`, [s.lines.L5]), 0, 'paul: a line out of access is not updated');
  assert.equal(await affected(`UPDATE spend_items SET description = 'x' WHERE id = $1`, [s.lines.L1]), 0, 'paul: a read-only line is not updated');
  await apply(s.persons.rita);
  assert.equal(await affected(`UPDATE spend_items SET description = 'x' WHERE id = $1`, [s.lines.L3]), 0, 'rita: L3, paid by another company than its centre, is read only');
  await apply(s.persons.ulla);

  // The trigger does nothing outside the limited mode.
  assert.equal(await affected(`UPDATE spend_items SET paying_company_id = $2 WHERE id = $1`, [s.lines.L1, s.es]), 1, 'mode all: any move');
  console.log('  placement: create, move (trigger, owner included), read only, out of access (§2.3, §2.5): OK');
}

async function testAdministratorAndAll(s: Seed): Promise<void> {
  assert.equal(await apply(s.persons.admin), 'all', 'Administrator: everything');
  assert.equal((await q(`SELECT current_user AS u`))[0].u, appRoleName());
  assert.equal((await q(`SELECT count(*)::int AS n FROM spend_items`))[0].n, LABELS.length);
  assert.equal(await affected(`DELETE FROM spend_items WHERE id = $1`, [s.lines.L1]), 1, 'Administrator: deletes a line');
  console.log('  Administrator and mode all: everything, deletion included: OK');
}

async function testRoleWithoutContext(s: Seed): Promise<void> {
  await apply(s.persons.ulla);
  await client.query('SAVEPOINT data_access_no_context');
  try {
    await client.query(`SET LOCAL ROLE ${LIMITED_ROLE}`);
    for (const table of TABLES_2A) {
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${table}`);
      assert.equal(rows[0].n, 0, `no context: ${table} shows nothing`);
    }
    for (const child of CHILDREN) {
      assert.equal(await affected(child.touch), 0, `no context: ${child.table} update touches nothing`);
      if (child.insert) {
        const [sql, params] = child.insert(s, 'L1');
        assert.equal(await write(sql, params), '42501', `no context: ${child.table} insert refused`);
      }
    }
    assert.equal(await lineInsert(s, s.fr, s.infFr), '42501', 'no context: create a line refused');
    assert.equal(await affected(`UPDATE spend_items SET description = description`), 0, 'no context: update touches nothing');
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT data_access_no_context');
  }
  console.log('  role taken without context: nothing visible, nothing writable: OK');
}

async function testDefinerTriggers(s: Seed): Promise<void> {
  // Totals of a version of another line, hidden from Rita, made wrong by the application role.
  await q(`UPDATE spend_version_totals SET planned = 0 WHERE version_id = $1`, [s.versions.L5]);
  await apply(s.persons.rita);
  // Her own line: the amounts' statement trigger recalculates its total.
  assert.equal(await affected(`UPDATE spend_amounts SET planned = 250 WHERE version_id = $1`, [s.versions.L1]), 1);
  await client.query(`UPDATE spend_amounts SET planned = 250 WHERE version_id = $1`, [s.versions.L1]);
  assert.equal(Number((await q(`SELECT planned FROM spend_version_totals WHERE version_id = $1`, [s.versions.L1]))[0].planned), 250, 'rita: her line total recalculated');
  // The rebuild she triggers covers the whole tenant, the versions she cannot read included.
  await q(`SELECT * FROM budget_version_totals_rebuild($1)`, [s.tenantId]);
  // Renaming her line refreshes its search entry.
  await client.query(`UPDATE spend_items SET product_name = 'Renamed by Rita' WHERE id = $1`, [s.lines.L1]);
  await apply(s.persons.ulla);
  assert.equal(Number((await q(`SELECT planned FROM spend_version_totals WHERE version_id = $1`, [s.versions.L5]))[0].planned), 100, 'rebuild by a limited person: a hidden version total repaired');
  const entries = await q(`SELECT label FROM search_index WHERE entity_id = $1`, [s.lines.L1]);
  assert.ok(entries.length > 0 && entries.every((e) => String(e.label).includes('Renamed by Rita')), 'search entry of the renamed line refreshed');
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM pg_proc WHERE oid = ANY (ARRAY['budget_version_totals_rebuild'::regproc, 'spend_amounts_version_totals'::regproc, 'search_index_sync_spend_items'::regproc]) AND prosecdef`,
  );
  assert.equal(rows[0].n, 3, 'the trigger functions are SECURITY DEFINER');
  console.log('  definer trigger functions: totals and search entry recalculated over the tenant: OK');
}

/** The plan of a statement without costs: node types, relations, indexes, joins, conditions. */
function shape(node: any): any {
  return {
    t: node['Node Type'],
    r: node['Relation Name'] ?? null,
    i: node['Index Name'] ?? null,
    j: node['Join Type'] ?? null,
    f: node['Filter'] ?? null,
    c: node['Index Cond'] ?? null,
    p: (node.Plans ?? []).map(shape),
  };
}

/** A few statements of scripts/perf/sql/ (list, line page, amounts, aggregate), on the seed. */
function perfStatements(s: Seed): string[] {
  const t = `'${s.tenantId}'`;
  return [
    // fiche_amounts_5
    `SELECT c.spend_item_id AS item_id, i.nature FROM spend_versions c
       JOIN spend_items i ON i.tenant_id = c.tenant_id AND i.id = c.spend_item_id
      WHERE c.tenant_id = ${t} AND c.id = '${s.versions.L1}'`,
    // list_first_page, reduced to its joins
    `SELECT i.id, count(*) OVER () AS total FROM spend_items i
       LEFT JOIN spend_versions v ON v.tenant_id = ${t} AND v.spend_item_id = i.id AND v.budget_year = 2026
       LEFT JOIN spend_version_totals at ON at.tenant_id = ${t} AND at.version_id = v.id
      WHERE i.tenant_id = ${t} AND i.nature = 'opex' AND (i.disabled_at IS NULL OR i.disabled_at >= '2026-01-01')
      ORDER BY at.planned DESC NULLS LAST, i.created_at DESC, i.id DESC LIMIT 50`,
    // fiche amounts of a version
    `SELECT a.period, a.planned FROM spend_amounts a WHERE a.tenant_id = ${t} AND a.version_id = '${s.versions.L1}' ORDER BY a.period`,
    // agg by company
    `SELECT i.paying_company_id, sum(a.planned) FROM spend_amounts a
       JOIN spend_versions v ON v.id = a.version_id JOIN spend_items i ON i.id = v.spend_item_id
      WHERE i.tenant_id = ${t} GROUP BY 1`,
  ];
}

async function snapshot(s: Seed): Promise<string> {
  const counts: Record<string, number> = {};
  for (const table of TABLES_2A) counts[table] = (await q(`SELECT count(*)::int AS n FROM ${table}`))[0].n;
  const plans = [];
  for (const sql of perfStatements(s)) {
    const rows = await q(`EXPLAIN (FORMAT JSON) ${sql}`);
    plans.push(shape(rows[0]['QUERY PLAN'][0].Plan));
  }
  return JSON.stringify({ counts, plans });
}

async function testNothingChangesUnscoped(s: Seed): Promise<void> {
  assert.equal(await apply(s.persons.ulla), 'all');
  assert.equal((await q(`SELECT current_user AS u`))[0].u, appRoleName(), 'unscoped: the application role');
  const withPolicies = await snapshot(s);
  await client.query('SAVEPOINT data_access_no_policies');
  try {
    const policies = await q(`
      SELECT p.polname, c.relname FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      WHERE to_regrole($1)::oid = ANY (p.polroles)`, [LIMITED_ROLE]);
    assert.ok(policies.length > 0, 'the policies exist');
    for (const p of policies) await client.query(`DROP POLICY ${p.polname} ON ${p.relname}`);
    assert.equal(await snapshot(s), withPolicies, 'same rows and same plans with and without the data-access policies');
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT data_access_no_policies');
  }
  const { rows } = await client.query(`
    SELECT p.polname FROM pg_policy p
    WHERE p.polname ~ '_data_access_(select|insert|update|delete|all)$'
      AND p.polroles <> ARRAY[to_regrole($1)::oid]`, [LIMITED_ROLE]);
  assert.deepEqual(rows, [], 'no data-access policy targets another role');
  console.log('  unscoped: same rows and plans with the policies installed (§10.2): OK');
}

async function run(): Promise<void> {
  client = await connect(APP_URL);
  try {
    const hasRole = await roleExists(client);
    if (!hasRole) {
      if (process.env.CI) assert.fail(`CI installs ${LIMITED_ROLE} before the migrations (infra/scripts/data-access-role.sql)`);
      console.log(`data access line policies: ${LIMITED_ROLE} not installed, skipped`);
      return;
    }
    console.log('data access line policies');
    await client.query('BEGIN');
    try {
      const s = await seed();
      await testNothingChangesUnscoped(s);
      await testPersons(s);
      await testPlacement(s);
      await testRoleWithoutContext(s);
      await testDefinerTriggers(s);
      await testAdministratorAndAll(s);
    } finally {
      await client.query('ROLLBACK');
    }
    console.log('data access line policies: all scenarios passed');
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
