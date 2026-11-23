// @database-spec
import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import { UPDATED_AT_SEARCH_ENTITY_TYPES, UPDATED_AT_TABLES } from '../updated-at.inventory';
import { touchUpdatedAtMany } from '../updated-at-trigger';
import { SearchIndexDateOnly1856275000000 as Migration } from '../../migrations/1856275000000-search-index-date-only';
import { APP_URL, connect } from '../../data-access/__tests__/data-access-test-helpers';
import { applyPerson } from '../../data-access/__tests__/data-access-line-seed';
import { seedContracts } from '../../data-access/__tests__/data-access-contract-seed';
import { assert, inRolledBackTransaction, runSpecs } from '../../spend/__tests__/round-inputs.fixtures';

// The search entry of a record and its modification date (migration 1856275000000):
// - catalog: on every table of the modification date that the search index keeps, each
//   `trg_search_index*` trigger that fires on an update either carries the condition "not an
//   update of the date alone" or only fires on columns other than `updated_at`, and the date
//   trigger is there;
// - an update of the date alone computes nothing again (the entry is unchanged, byte for byte)
//   and moves `source_updated_at`; an update of a real column computes the entry as before;
// - under kanap_data_limited, the date of a record the person may modify reaches its entry;
// - down() then up(), twice.

const OLD = '2020-01-02T03:04:05.000Z';
const migration = new Migration();

type Trigger = { table: string; name: string; definition: string };

async function searchTriggers(runner: Pick<QueryRunner, 'query'>): Promise<Trigger[]> {
  return runner.query(
    `SELECT c.relname::text AS table, t.tgname::text AS name, pg_get_triggerdef(t.oid) AS definition
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace
        AND c.relname = ANY($1::text[]) AND t.tgname LIKE 'trg\\_search\\_index%'
      ORDER BY 1, 2`,
    [Object.keys(UPDATED_AT_TABLES)],
  );
}

/** The conditions as PostgreSQL prints them back in a trigger definition (`SEARCH_INDEX_DATE_ONLY`). */
const DATE_ONLY_EXPR = `(old.updated_at IS DISTINCT FROM new.updated_at) AND ((to_jsonb(old.*) - 'updated_at'::text) = (to_jsonb(new.*) - 'updated_at'::text))`;
const CHANGED = `WHEN ((NOT (${DATE_ONLY_EXPR})))`;
const DATE_MOVED = `WHEN ((old.updated_at IS DISTINCT FROM new.updated_at))`;

function checkCatalog(triggers: Trigger[]): string[] {
  const problems: string[] = [];
  const fix = 'call syncSearchIndexTriggers (common/updated-at-trigger.ts) for this table in your migration';
  for (const t of triggers) {
    const event = /AFTER (.+?) ON /.exec(t.definition)?.[1] ?? '';
    if (!/\bUPDATE\b/.test(event)) continue;
    const columns = /UPDATE OF (.+)$/.exec(event)?.[1]?.split(', ') ?? null;
    if (t.name === `trg_search_index_${t.table}_date`) {
      if (!(columns?.length === 1 && columns[0] === 'updated_at' && t.definition.includes(DATE_MOVED))) {
        problems.push(`${t.table}: ${t.name} is not the date trigger (${t.definition}): ${fix}`);
      }
      continue;
    }
    if (columns && !columns.includes('updated_at')) continue; // fires on named columns only, never on the date alone
    if (!t.definition.includes(CHANGED)) {
      problems.push(`${t.table}: ${t.name} runs the search index sync on an update of the date alone (${t.definition}): ${fix}`);
    }
  }
  for (const table of Object.keys(UPDATED_AT_SEARCH_ENTITY_TYPES)) {
    if (!triggers.some((t) => t.name === `trg_search_index_${table}_date`)) problems.push(`${table}: no trigger trg_search_index_${table}_date: ${fix}`);
  }
  for (const table of new Set(triggers.map((t) => t.table))) {
    if (!UPDATED_AT_SEARCH_ENTITY_TYPES[table]) problems.push(`${table}: has search index triggers but no entry in UPDATED_AT_SEARCH_ENTITY_TYPES (common/updated-at.inventory.ts)`);
  }
  return problems;
}

async function testCatalog() {
  await inRolledBackTransaction(async (runner) => {
    const triggers = await searchTriggers(runner);
    assert.deepEqual(checkCatalog(triggers), [], 'every search index trigger of the dated tables');
    // The entity types of the inventory are those the sync function writes.
    for (const [table, types] of Object.entries(UPDATED_AT_SEARCH_ENTITY_TYPES)) {
      const [fn] = await runner.query(`SELECT pg_get_functiondef(to_regprocedure($1)) AS body`, [`public.search_index_sync_${table}()`]);
      const written = Array.from(String(fn.body).matchAll(/search_index_delete\(OLD\.tenant_id, '([a-z_]+)'/g), (m) => m[1]).sort();
      assert.deepEqual([...types].sort(), written, `${table}: UPDATED_AT_SEARCH_ENTITY_TYPES names the entity types of search_index_sync_${table}()`);
    }
    // A migration that recreates the trigger for every update fails the check, with the fix named.
    await runner.query(`CREATE OR REPLACE TRIGGER trg_search_index_contracts AFTER INSERT OR DELETE OR UPDATE ON public.contracts FOR EACH ROW EXECUTE FUNCTION search_index_sync_contracts()`);
    const problems = checkCatalog(await searchTriggers(runner));
    assert.equal(problems.length, 1, JSON.stringify(problems));
    assert.match(problems[0], /^contracts: trg_search_index_contracts runs the search index sync on an update of the date alone .*call syncSearchIndexTriggers/);
  });
}

async function seedTenant(runner: Pick<QueryRunner, 'query'>): Promise<string> {
  const [{ id }] = await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES (gen_random_uuid(), 'si-date-' || substr(md5(random()::text), 1, 8), 'Search index date', 'active', '{}'::jsonb, '{}'::jsonb, now(), now()) RETURNING id`,
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [id]);
  return id;
}

const entry = (runner: Pick<QueryRunner, 'query'>, type: string, id: string) => runner.query(
  `SELECT label, summary, status, extra_json, search_vector::text AS vector, ref_prefix, ref_number,
          source_updated_at, indexed_at
     FROM search_index WHERE entity_type = $1 AND entity_id = $2`,
  [type, id],
).then((rows: any[]) => rows[0]);

async function testDateOnlyAndRealUpdate() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner);
    const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Fromagerie') RETURNING id`, [tenantId]);
    const [company] = await runner.query(`INSERT INTO companies (tenant_id, name, country_iso, city, item_number) VALUES ($1, 'Co', 'FR', 'Brest', 1) RETURNING id`, [tenantId]);
    const [contract] = await runner.query(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, item_number, notes) VALUES ($1, 'Maintenance', $2, $3, '2026-01-01', 1, 'first') RETURNING id`,
      [tenantId, company.id, supplier.id],
    );
    const [line] = await runner.query(
      `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, nature) VALUES ($1, 'Capex line', 'EUR', '2026-01-01', 1, 'capex') RETURNING id`,
      [tenantId],
    );
    await runner.query(`UPDATE contracts SET updated_at = $2 WHERE id = $1`, [contract.id, OLD]);
    await runner.query(`UPDATE spend_items SET updated_at = $2 WHERE id = $1`, [line.id, OLD]);
    // The entries marked by hand: a sync that runs again computes them back, a date copy leaves them.
    await runner.query(
      `UPDATE search_index SET label = 'marked ' || label, search_vector = to_tsvector('simple', 'marked'), indexed_at = $2
        WHERE entity_id = ANY($1::uuid[])`,
      [[contract.id, line.id], OLD],
    );
    const before = await entry(runner, 'contracts', contract.id);
    const beforeLine = await entry(runner, 'capex_items', line.id);
    assert.equal(new Date(before.source_updated_at).toISOString(), OLD, 'the backdate reached the entry');

    // The dating of a history entry: the entry is not computed again, only its date moves.
    assert.equal(await touchUpdatedAtMany(runner.manager, 'contracts', [contract.id]), 1);
    assert.equal(await touchUpdatedAtMany(runner.manager, 'spend_items', [line.id]), 1);
    const dated = await entry(runner, 'contracts', contract.id);
    const datedLine = await entry(runner, 'capex_items', line.id);
    const [now] = await runner.query(`SELECT now() AS now`);
    for (const [was, is, label] of [[before, dated, 'contract'], [beforeLine, datedLine, 'capex line']] as const) {
      const { source_updated_at: a, ...contentBefore } = was;
      const { source_updated_at: b, ...contentAfter } = is;
      assert.ok(String(contentBefore.label).startsWith('marked '), `${label}: marked`);
      assert.notEqual(new Date(a).toISOString(), new Date(b).toISOString(), `${label}: the date moved`);
      assert.deepEqual(contentAfter, contentBefore, `${label}: the entry is not computed again, indexed_at included`);
      assert.equal(new Date(b).toISOString(), new Date(now.now).toISOString(), `${label}: source_updated_at follows the date`);
    }

    // A real change computes the entry as before.
    await runner.query(`UPDATE contracts SET notes = 'second' WHERE id = $1`, [contract.id]);
    const changed = await entry(runner, 'contracts', contract.id);
    assert.equal(changed.summary, 'second', 'a real change computes the entry again');
    assert.equal(changed.label, 'Maintenance', 'the marked label is computed back');
    assert.match(changed.vector, /'second'/);
    // A row written back as it was runs the sync as before (the date did not move).
    await runner.query(`UPDATE search_index SET label = 'marked' WHERE entity_id = $1`, [contract.id]);
    await runner.query(`UPDATE contracts SET name = name WHERE id = $1`, [contract.id]);
    assert.equal((await entry(runner, 'contracts', contract.id)).label, 'Maintenance', 'a row written back as it was computes the entry');
    // A technical column alone (no new date) still reaches the entry: the status is indexed.
    await runner.query(`UPDATE contracts SET status = 'disabled' WHERE id = $1`, [contract.id]);
    assert.equal((await entry(runner, 'contracts', contract.id)).status, 'disabled', 'a status change computes the entry');
    // A backdate with a real change computes the entry, with the date written.
    await runner.query(`UPDATE contracts SET notes = 'third', updated_at = $2 WHERE id = $1`, [contract.id, OLD]);
    const third = await entry(runner, 'contracts', contract.id);
    assert.equal(third.summary, 'third');
    assert.equal(new Date(third.source_updated_at).toISOString(), OLD);
  });
}

async function testLimitedRole() {
  const client = await connect(APP_URL);
  // The pg client as the manager a service would pass (only `query` is used).
  const m = { query: async (sql: string, params?: unknown[]) => (await client.query(sql, params)).rows } as any;
  try {
    await client.query('BEGIN');
    const s = await seedContracts(client);
    await m.query(`UPDATE spend_items SET updated_at = $2 WHERE tenant_id = $1`, [s.tenantId, OLD]);
    assert.equal(await applyPerson(client, s.persons.rita), 'limited');
    assert.equal((await m.query(`SELECT current_user AS u`))[0].u, 'kanap_data_limited');
    // rita may modify L1 and only read L2: L1 is dated, and its entry takes the date.
    assert.equal(await touchUpdatedAtMany(m, 'spend_items', [s.lines.L1, s.lines.L2]), 1);
    const seen = await m.query(
      `SELECT entity_id::text AS id, source_updated_at = now() AS dated FROM search_index WHERE entity_id = ANY($1::uuid[])`,
      [[s.lines.L1, s.lines.L2]],
    );
    const dated = Object.fromEntries(seen.map((row: any) => [row.id, row.dated]));
    assert.deepEqual(dated, { [s.lines.L1]: true, [s.lines.L2]: false }, 'the entry of the line rita may modify takes the date, the other keeps it');
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

async function testDownThenUpTwice() {
  await inRolledBackTransaction(async (runner) => {
    for (const round of [1, 2]) {
      await migration.down(runner);
      await migration.down(runner);
      const restored = await searchTriggers(runner);
      for (const table of Object.keys(UPDATED_AT_SEARCH_ENTITY_TYPES)) {
        const own = restored.filter((t) => t.table === table && t.name.startsWith(`trg_search_index_${table}`) && !/_on_|_review_/.test(t.name));
        assert.deepEqual(own.map((t) => t.definition), [
          `CREATE TRIGGER trg_search_index_${table} AFTER INSERT OR DELETE OR UPDATE ON public.${table} FOR EACH ROW EXECUTE FUNCTION search_index_sync_${table}()`,
        ], `round ${round}: down() puts back the trigger of ${table}`);
      }
      const [fn] = await runner.query(`SELECT to_regprocedure('search_index_stamp_source()') IS NULL AS gone`);
      assert.equal(fn.gone, true, `round ${round}: down() drops the function`);
      await migration.up(runner);
      const placed = await searchTriggers(runner);
      assert.deepEqual(checkCatalog(placed), [], `round ${round}: up()`);
      await migration.up(runner);
      assert.deepEqual(await searchTriggers(runner), placed, `round ${round}: a second up() changes nothing`);
    }
  });
}

/** Imperfect database: a table without its sync function keeps its triggers, the others get theirs. */
async function testMissingSyncFunction() {
  await inRolledBackTransaction(async (runner) => {
    await migration.down(runner);
    await runner.query(`DROP FUNCTION search_index_sync_users() CASCADE`);
    const warnings: string[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')); };
    try {
      await migration.up(runner);
    } finally {
      console.warn = warn;
    }
    assert.deepEqual(warnings, ['[migration 1856275000000 search-index-date-only] users: no sync function, triggers left as they are']);
    const problems = checkCatalog(await searchTriggers(runner));
    assert.deepEqual(problems, ['users: no trigger trg_search_index_users_date: call syncSearchIndexTriggers (common/updated-at-trigger.ts) for this table in your migration']);
  });
}

void runSpecs('updated-at.search-index.integration.spec', [
  ['catalog', testCatalog],
  ['a date-only update and a real update', testDateOnlyAndRealUpdate],
  ['under the limited role', testLimitedRole],
  ['down then up, twice', testDownThenUpTwice],
  ['a missing sync function', testMissingSyncFunction],
]);
