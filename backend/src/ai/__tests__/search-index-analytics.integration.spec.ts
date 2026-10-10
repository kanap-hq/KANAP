import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import { AiEntityService } from '../ai-entity.service';
import { syncTableLifecycleStatus } from '../../cleanup/lifecycle-status-sync.service';
import {
  SEARCH_INDEX_ANALYTICS_FUNCTIONS,
  SEARCH_INDEX_ANALYTICS_TRIGGERS,
  SearchIndexAnalyticsValues1853940000000 as Migration,
} from '../../migrations/1853940000000-search-index-analytics-values';
import { writeItemAnalyticsValues } from '../../spend/item-analytics.util';
import { linkValue, runSpecs, seedLine, seedTenant, setCurrentTenant, withRollback } from '../../analytics/__tests__/analytics-test-helpers';

// Migration 1853940000000 (lot S), against a real database, each test in a transaction rolled back
// at the end: an OPEX or CAPEX line's search entry carries the names of the values it holds on the
// enabled dimensions that apply to its type (vector weight B, accent-insensitive search, never the
// dimension names) and `extra_json.analytics` ("Nature de coût: Matériel; Récurrence: Récurrent",
// dimension order, absent without a value); the statement triggers keep it fresh: a value set,
// changed or cleared, a value renamed (lines of both types), a dimension renamed, disabled, past
// its end of validity (through the hourly lifecycle sync) or restricted to the other type, each
// line refreshed once per statement and type, the writer's tenant only. A value's order, line types
// or own state refresh nothing, and a held value that is disabled stays indexed. The migration
// reruns to the same functions and triggers, reindexes existing lines, and down() puts back the
// previous refresh bodies, byte for byte.
// @database-spec (the data source opens in analytics-test-helpers).

type Kind = 'opex' | 'capex';
const KINDS: Kind[] = ['opex', 'capex'];
const ENTITY: Record<Kind, 'spend_items' | 'capex_items'> = { opex: 'spend_items', capex: 'capex_items' };
const LINKS: Record<Kind, string> = { opex: 'spend_item_analytics_values', capex: 'capex_item_analytics_values' };

/** md5 of the refresh bodies of 1853000000000 (OPEX, generated) and 1853220000000 (CAPEX). */
const PREVIOUS_BODIES = {
  spend_items: '7335d167980a8b5829d99c591b7680b8',
  capex_items: '093a72462f956b26b0117de1171d5a89',
};

const migration = new Migration();

function entityService() {
  return new AiEntityService(
    {
      search: async () => ({ items: [], total: 0 }),
      searchMentionOptions: async () => ({ items: [], total: 0 }),
      listReadableLibraryIdsForUser: async () => null,
      getKnowledgeContextForEntity: async () => ({ access: 'granted', total: 0, groups: [] }),
    } as any,
    {
      listReadableEntityTypes: async (_context: unknown, requested: string[]) => requested,
      canReadKnowledge: async () => true,
      assertEntityTypeReadAccess: async () => undefined,
    } as any,
  );
}

/** The budget lines `searchAll` returns for `query` in the tenant, with their metadata. */
async function search(runner: QueryRunner, tenantId: string, query: string): Promise<Array<{ id: string; metadata: any }>> {
  await setCurrentTenant(runner, tenantId);
  const context = {
    tenantId, userId: randomUUID(), isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const, manager: runner.manager,
  };
  const result = await entityService().searchAll(context as any, { query, entity_types: ['spend_items', 'capex_items'], limit: 50 });
  return result.items.map((item: any) => ({ id: item.id, metadata: item.metadata }));
}

const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);

let axisCounter = 0;

async function seedAxis(
  runner: QueryRunner,
  tenantId: string,
  name: string | null,
  opts: { sortOrder?: number; isDefault?: boolean } = {},
): Promise<string> {
  axisCounter += 1;
  const [row] = await runner.query(
    `INSERT INTO analytics_axes (tenant_id, code, name, sort_order, is_default) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, opts.isDefault ? 'default' : `si-axis-${axisCounter}`, name, opts.sortOrder ?? axisCounter, opts.isDefault === true],
  );
  return row.id;
}

async function seedValue(runner: QueryRunner, tenantId: string, axisId: string, name: string): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, axisId, name],
  );
  return row.id;
}

/** The line's `extra_json.analytics`; undefined when the key is absent. Reads in the current tenant. */
async function analytics(runner: QueryRunner, kind: Kind, itemId: string): Promise<string | undefined> {
  const [row] = await runner.query(
    `SELECT extra_json AS extra FROM search_index WHERE tenant_id = app_current_tenant() AND entity_type = $1 AND entity_id = $2`,
    [ENTITY[kind], itemId],
  );
  assert.ok(row, `${kind}: the line has a search entry`);
  return row.extra && 'analytics' in row.extra ? row.extra.analytics : undefined;
}

/** Whether the line's vector holds `text`, at the weights given (both configurations, as the search). */
async function inVector(runner: QueryRunner, kind: Kind, itemId: string, text: string, weights = '{a,b,c,d}'): Promise<boolean> {
  const [row] = await runner.query(
    `SELECT ts_filter(search_vector, $4::"char"[]) @@ (plainto_tsquery('kanap_fr', $3) || plainto_tsquery('kanap_en', $3)) AS found
       FROM search_index WHERE tenant_id = app_current_tenant() AND entity_type = $1 AND entity_id = $2`,
    [ENTITY[kind], itemId, text, weights],
  );
  return row?.found === true;
}

type RefreshCall = { type: string; tenant: string; ids: string[] };

/**
 * From now on, every call of the two line refresh functions is logged in a temporary table: their
 * bodies are rewritten with an INSERT in front, inside the test's transaction. The returned
 * function reads the calls since the previous read.
 */
async function recordRefreshes(runner: QueryRunner): Promise<() => Promise<RefreshCall[]>> {
  await runner.query(`CREATE TEMP TABLE IF NOT EXISTS refresh_calls (n serial, type text, tenant uuid, ids uuid[]) ON COMMIT DROP`);
  for (const type of Object.values(ENTITY)) {
    const [{ body }] = await runner.query(
      `SELECT prosrc AS body FROM pg_proc WHERE proname = $1 AND pronamespace = 'public'::regnamespace`,
      [`search_index_refresh_${type}`],
    );
    await runner.query(`
      CREATE OR REPLACE FUNCTION search_index_refresh_${type}(p_tenant uuid, p_ids uuid[] DEFAULT NULL)
      RETURNS void AS $fn$
        INSERT INTO pg_temp.refresh_calls (type, tenant, ids) VALUES ('${type}', p_tenant, p_ids);
        ${body}
      $fn$ LANGUAGE sql`);
  }
  return async () => {
    const rows: RefreshCall[] = await runner.query(
      `SELECT type, tenant::text AS tenant, ids::text[] AS ids FROM pg_temp.refresh_calls ORDER BY n`,
    );
    await runner.query('TRUNCATE pg_temp.refresh_calls');
    return rows.map((row) => ({ ...row, ids: [...(row.ids ?? [])].sort() }));
  };
}

const call = (kind: Kind, tenant: string, lines: string[]): RefreshCall => ({ type: ENTITY[kind], tenant, ids: [...lines].sort() });

/** A tenant with "Nature de coût" (Matériel, Logiciel) and "Récurrence" (Récurrent), in that order. */
async function seedDimensions(runner: QueryRunner, tag: string) {
  const tenantId = await seedTenant(runner, tag);
  const nature = await seedAxis(runner, tenantId, 'Nature de coût', { sortOrder: 10 });
  const recurrence = await seedAxis(runner, tenantId, 'Récurrence', { sortOrder: 30 });
  return {
    tenantId,
    nature,
    recurrence,
    materiel: await seedValue(runner, tenantId, nature, 'Matériel'),
    logiciel: await seedValue(runner, tenantId, nature, 'Logiciel'),
    recurrent: await seedValue(runner, tenantId, recurrence, 'Récurrent'),
  };
}

const BOTH = 'Nature de coût: Matériel; Récurrence: Récurrent';

async function testLinkedValuesAreIndexed() {
  await withRollback(async (runner) => {
    const d = await seedDimensions(runner, 'si-indexed');
    const defaultAxis = await seedAxis(runner, d.tenantId, null, { isDefault: true, sortOrder: 0 });
    const infrastructure = await seedValue(runner, d.tenantId, defaultAxis, 'Infrastructure');
    for (const kind of KINDS) {
      const bare = await seedLine(runner, kind, d.tenantId);
      assert.equal(await analytics(runner, kind, bare), undefined, `${kind}: a line without values has no analytics key`);

      const line = await seedLine(runner, kind, d.tenantId);
      // Written in another order than the dimensions'.
      await linkValue(runner, kind, d.tenantId, line, d.recurrence, d.recurrent);
      await linkValue(runner, kind, d.tenantId, line, d.nature, d.materiel);
      assert.equal(await analytics(runner, kind, line), BOTH, `${kind}: the values in dimension order`);
      assert.equal(await inVector(runner, kind, line, 'Matériel', '{b}'), true, `${kind}: the value name at weight B`);
      assert.equal(await inVector(runner, kind, line, 'Nature'), false, `${kind}: the dimension name is not indexed`);

      const found = await search(runner, d.tenantId, 'materiel');
      assert.deepEqual(ids(found).filter((id) => id === line || id === bare), [line], `${kind}: found by the value name, without its accent`);
      assert.equal(found.find((row) => row.id === line)?.metadata?.analytics, BOTH, `${kind}: Plaid reads the values in the metadata`);
      assert.equal(ids(await search(runner, d.tenantId, 'nature')).includes(line), false, `${kind}: not found by the dimension name`);

      // The default dimension without a name reads as the app labels it.
      await linkValue(runner, kind, d.tenantId, line, defaultAxis, infrastructure);
      assert.equal(await analytics(runner, kind, line), `Analytics dimension: Infrastructure; ${BOTH}`, `${kind}: the default dimension first`);
    }
  });
}

async function testValueWritesRefreshTheirLines() {
  await withRollback(async (runner) => {
    const d = await seedDimensions(runner, 'si-writes');
    const calls = await recordRefreshes(runner);
    for (const kind of KINDS) {
      const line = await seedLine(runner, kind, d.tenantId);
      await calls();
      const write = (axis: string, value: string | null) =>
        writeItemAnalyticsValues(runner.manager, kind, d.tenantId, line, [{ axis_id: axis, category_id: value }]);

      await write(d.nature, d.materiel);
      assert.equal(await analytics(runner, kind, line), 'Nature de coût: Matériel', `${kind}: a value set refreshes the line`);
      assert.deepEqual(await calls(), [call(kind, d.tenantId, [line])], `${kind}: once`);

      await write(d.nature, d.materiel);
      assert.deepEqual(await calls(), [], `${kind}: the same value written again refreshes nothing`);

      await write(d.nature, d.logiciel);
      assert.equal(await analytics(runner, kind, line), 'Nature de coût: Logiciel', `${kind}: another value refreshes the line`);
      assert.deepEqual(await calls(), [call(kind, d.tenantId, [line])], `${kind}: once, for the upsert's update`);

      await runner.query(`UPDATE ${LINKS[kind]} SET updated_at = now() + interval '1 second' WHERE item_id = $1`, [line]);
      assert.deepEqual(await calls(), [], `${kind}: an update of updated_at alone refreshes nothing`);

      await write(d.nature, null);
      assert.equal(await analytics(runner, kind, line), undefined, `${kind}: a cleared value leaves the entry`);
      assert.deepEqual(await calls(), [call(kind, d.tenantId, [line])], `${kind}: once, for the delete`);

      // Two lines, two dimensions each, one statement: each line refreshed once, by one call.
      const first = await seedLine(runner, kind, d.tenantId);
      const second = await seedLine(runner, kind, d.tenantId);
      await calls();
      await runner.query(
        `INSERT INTO ${LINKS[kind]} (tenant_id, item_id, axis_id, category_id)
         SELECT $1, x.item_id, x.axis_id, x.category_id
           FROM unnest($2::uuid[], $3::uuid[], $4::uuid[]) AS x(item_id, axis_id, category_id)`,
        [d.tenantId, [first, first, second, second], [d.nature, d.recurrence, d.nature, d.recurrence], [d.materiel, d.recurrent, d.logiciel, d.recurrent]],
      );
      assert.deepEqual(await calls(), [call(kind, d.tenantId, [first, second])], `${kind}: one call for both lines`);
      assert.equal(await analytics(runner, kind, first), BOTH, `${kind}: first line refreshed`);
      assert.equal(await analytics(runner, kind, second), 'Nature de coût: Logiciel; Récurrence: Récurrent', `${kind}: second line refreshed`);

      await runner.query(`UPDATE ${LINKS[kind]} SET category_id = $2 WHERE item_id = ANY($1::uuid[]) AND axis_id = $3`, [[first, second], d.logiciel, d.nature]);
      assert.deepEqual(await calls(), [call(kind, d.tenantId, [first])], `${kind}: an update refreshes the lines whose value changed`);
      assert.equal(await analytics(runner, kind, first), 'Nature de coût: Logiciel; Récurrence: Récurrent', `${kind}: changed in place`);

      // A line deleted with its values: its own trigger removes the entry, the values' trigger refreshes nothing.
      await runner.query(`DELETE FROM ${ENTITY[kind]} WHERE id = $1`, [second]);
      assert.deepEqual(await calls(), [], `${kind}: a line deleted with its values is not refreshed`);
      const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM search_index WHERE entity_id = $1`, [second]);
      assert.equal(n, 0, `${kind}: the deleted line has no entry`);
    }
  });
}

async function testValueChanges() {
  await withRollback(async (runner) => {
    const d = await seedDimensions(runner, 'si-value');
    const lines = { opex: await seedLine(runner, 'opex', d.tenantId), capex: await seedLine(runner, 'capex', d.tenantId) };
    for (const kind of KINDS) await linkValue(runner, kind, d.tenantId, lines[kind], d.nature, d.materiel);
    const calls = await recordRefreshes(runner);

    await runner.query(`UPDATE analytics_categories SET name = 'Équipement' WHERE id = $1`, [d.materiel]);
    assert.deepEqual(await calls(), [call('opex', d.tenantId, [lines.opex]), call('capex', d.tenantId, [lines.capex])],
      'a value renamed: its lines of both types, one call each');
    for (const kind of KINDS) {
      assert.equal(await analytics(runner, kind, lines[kind]), 'Nature de coût: Équipement', `${kind}: the new name`);
    }
    assert.deepEqual(ids(await search(runner, d.tenantId, 'equipement')).sort(), [lines.opex, lines.capex].sort(), 'found by the new name');
    assert.deepEqual(ids(await search(runner, d.tenantId, 'materiel')), [], 'not by the old one');

    await runner.query(`UPDATE analytics_categories SET sort_order = sort_order + 5 WHERE axis_id = $1`, [d.nature]);
    await runner.query(`UPDATE analytics_categories SET applies_to = 'opex' WHERE id = $1`, [d.materiel]);
    await runner.query(`UPDATE analytics_categories SET status = 'disabled', disabled_at = now() - interval '1 day' WHERE id = $1`, [d.materiel]);
    assert.deepEqual(await calls(), [], "a value's order, line types or state refresh nothing");

    // A disabled value, and one now for OPEX only, that a CAPEX line still holds: shown on the line, indexed.
    await runner.query(`SELECT search_index_refresh_spend_items($1, NULL), search_index_refresh_capex_items($1, NULL)`, [d.tenantId]);
    for (const kind of KINDS) {
      assert.equal(await analytics(runner, kind, lines[kind]), 'Nature de coût: Équipement', `${kind}: a disabled value held stays indexed`);
    }
  });
}

async function testDimensionChanges() {
  await withRollback(async (runner) => {
    const d = await seedDimensions(runner, 'si-dimension');
    const lines = { opex: await seedLine(runner, 'opex', d.tenantId), capex: await seedLine(runner, 'capex', d.tenantId) };
    for (const kind of KINDS) {
      await linkValue(runner, kind, d.tenantId, lines[kind], d.nature, d.materiel);
      await linkValue(runner, kind, d.tenantId, lines[kind], d.recurrence, d.recurrent);
    }
    const calls = await recordRefreshes(runner);
    const expect = async (shown: Record<Kind, string | undefined>, message: string) => {
      for (const kind of KINDS) assert.equal(await analytics(runner, kind, lines[kind]), shown[kind], `${kind}: ${message}`);
    };
    const nature = (sql: string) => runner.query(`UPDATE analytics_axes SET ${sql} WHERE id = $1`, [d.nature]);
    const recurrenceOnly = 'Récurrence: Récurrent';

    await nature(`status = 'disabled', disabled_at = now() - interval '1 day'`);
    await expect({ opex: recurrenceOnly, capex: recurrenceOnly }, 'a disabled dimension leaves the entry');
    assert.deepEqual(await calls(), [call('opex', d.tenantId, [lines.opex]), call('capex', d.tenantId, [lines.capex])], 'one call per type');
    assert.deepEqual(ids(await search(runner, d.tenantId, 'materiel')), [], 'not found by a value of a disabled dimension');
    await nature(`status = 'enabled', disabled_at = NULL`);
    await expect({ opex: BOTH, capex: BOTH }, 'enabled again: back');

    await nature(`disabled_at = now() - interval '1 hour'`);
    await expect({ opex: recurrenceOnly, capex: recurrenceOnly }, 'an end of validity in the past leaves the entry');
    await nature('disabled_at = NULL');
    await expect({ opex: BOTH, capex: BOTH }, 'no end of validity: back');

    await nature(`applies_to = 'capex'`);
    await expect({ opex: recurrenceOnly, capex: BOTH }, 'a dimension for CAPEX lines only leaves the OPEX entry');
    await nature(`applies_to = 'opex'`);
    await expect({ opex: BOTH, capex: recurrenceOnly }, 'for OPEX lines only');
    await nature('applies_to = NULL');
    await expect({ opex: BOTH, capex: BOTH }, 'both types again');

    await nature(`name = 'Nature'`);
    await expect({ opex: 'Nature: Matériel; Récurrence: Récurrent', capex: 'Nature: Matériel; Récurrence: Récurrent' }, 'a dimension renamed');
    await calls();
    await runner.query(`UPDATE analytics_axes SET sort_order = sort_order + 1, required = NOT required WHERE tenant_id = $1`, [d.tenantId]);
    assert.deepEqual(await calls(), [], "a dimension's order or required setting refreshes nothing");

    // An end of validity passing is no write: the hourly lifecycle sync sets the stored status, which refreshes.
    await runner.query('ALTER TABLE analytics_axes DISABLE TRIGGER analytics_axes_search_index_lines');
    await nature(`disabled_at = now() - interval '1 minute'`);
    await runner.query('ALTER TABLE analytics_axes ENABLE TRIGGER analytics_axes_search_index_lines');
    await expect({ opex: 'Nature: Matériel; Récurrence: Récurrent', capex: 'Nature: Matériel; Récurrence: Récurrent' }, 'the date passed, no write yet');
    assert.deepEqual(await syncTableLifecycleStatus(runner.manager, d.tenantId, 'analytics_axes'), { disabled: 1, enabled: 0 }, 'the sync disables the dimension');
    await expect({ opex: recurrenceOnly, capex: recurrenceOnly }, 'the lifecycle sync refreshes the lines');
  });
}

async function testTenantIsolation() {
  await withRollback(async (runner) => {
    const a = await seedDimensions(runner, 'si-tenant-a');
    const lineA = await seedLine(runner, 'opex', a.tenantId);
    await linkValue(runner, 'opex', a.tenantId, lineA, a.nature, a.materiel);
    const b = await seedDimensions(runner, 'si-tenant-b');
    const lineB = await seedLine(runner, 'opex', b.tenantId);
    await linkValue(runner, 'opex', b.tenantId, lineB, b.nature, b.materiel);
    const capexB = await seedLine(runner, 'capex', b.tenantId);
    await linkValue(runner, 'capex', b.tenantId, capexB, b.nature, b.materiel);

    assert.deepEqual(ids(await search(runner, a.tenantId, 'materiel')), [lineA], "tenant A finds its line, not B's");
    assert.deepEqual(ids(await search(runner, b.tenantId, 'materiel')).sort(), [lineB, capexB].sort(), 'tenant B finds its lines');

    await setCurrentTenant(runner, a.tenantId);
    const calls = await recordRefreshes(runner);
    await runner.query(`UPDATE analytics_categories SET name = 'Équipement' WHERE id = $1`, [a.materiel]);
    await runner.query(`UPDATE analytics_axes SET name = 'Nature' WHERE id = $1`, [a.nature]);
    await writeItemAnalyticsValues(runner.manager, 'opex', a.tenantId, lineA, [{ axis_id: a.recurrence, category_id: a.recurrent }]);
    const made = await calls();
    assert.equal(made.length, 3, 'three refreshes in tenant A');
    assert.deepEqual([...new Set(made.map((c) => c.tenant))], [a.tenantId], "the triggers refresh the writer's tenant only");
    assert.equal(await analytics(runner, 'opex', lineA), 'Nature: Équipement; Récurrence: Récurrent', "tenant A's line follows");

    await setCurrentTenant(runner, b.tenantId);
    assert.equal(await analytics(runner, 'opex', lineB), 'Nature de coût: Matériel', "tenant B's line is untouched");
    assert.deepEqual(ids(await search(runner, b.tenantId, 'equipement')), [], 'and not found by the name tenant A gave its value');
  });
}

type Definitions = { functions: Array<string | null>; refresh: string[]; triggers: Array<{ name: string; def: string }> };

async function definitions(runner: QueryRunner): Promise<Definitions> {
  const functions: Array<{ def: string | null }> = await runner.query(
    `SELECT CASE WHEN to_regprocedure(f) IS NULL THEN NULL ELSE pg_get_functiondef(to_regprocedure(f)) END AS def
       FROM unnest($1::text[]) WITH ORDINALITY AS x(f, n) ORDER BY n`,
    [SEARCH_INDEX_ANALYTICS_FUNCTIONS],
  );
  const refresh: Array<{ def: string }> = await runner.query(
    `SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p
      WHERE p.proname IN ('search_index_refresh_spend_items', 'search_index_refresh_capex_items')
        AND p.pronamespace = 'public'::regnamespace ORDER BY p.proname`,
  );
  const triggers: Array<{ name: string; def: string }> = await runner.query(
    `SELECT t.tgname::text AS name, pg_get_triggerdef(t.oid) AS def FROM pg_trigger t
      WHERE NOT t.tgisinternal AND t.tgname = ANY($1::text[]) ORDER BY t.tgname`,
    [SEARCH_INDEX_ANALYTICS_TRIGGERS.map((trigger) => trigger.name)],
  );
  return { functions: functions.map((row) => row.def), refresh: refresh.map((row) => row.def), triggers };
}

async function bodies(runner: QueryRunner): Promise<Record<string, string>> {
  const rows: Array<{ type: string; md5: string }> = await runner.query(
    `SELECT replace(proname, 'search_index_refresh_', '') AS type, md5(prosrc) AS md5 FROM pg_proc
      WHERE proname IN ('search_index_refresh_spend_items', 'search_index_refresh_capex_items')
        AND pronamespace = 'public'::regnamespace`,
  );
  return Object.fromEntries(rows.map((row) => [row.type, row.md5]));
}

/** Runs a migration step as a migration runs: no tenant; returns what it logged. */
async function asMigration(runner: QueryRunner, step: () => Promise<void>): Promise<string[]> {
  await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    await step();
  } finally {
    console.log = original;
  }
  const [{ tenant }] = await runner.query(`SELECT current_setting('app.current_tenant', true) AS tenant`);
  assert.equal(tenant, '', 'the migration puts back the tenant setting it found');
  return lines;
}

async function testMigration() {
  await withRollback(async (runner) => {
    const d = await seedDimensions(runner, 'si-migration');
    const lines = { opex: await seedLine(runner, 'opex', d.tenantId), capex: await seedLine(runner, 'capex', d.tenantId) };
    for (const kind of KINDS) await linkValue(runner, kind, d.tenantId, lines[kind], d.nature, d.materiel);

    const before = await definitions(runner);
    assert.ok(before.functions.every((def) => def !== null), 'every function exists');
    assert.equal(before.triggers.length, SEARCH_INDEX_ANALYTICS_TRIGGERS.length, 'every trigger exists');
    const settings: Array<{ name: string; config: string[] | null; definer: boolean; volatility: string }> = await runner.query(
      `SELECT proname::text AS name, proconfig AS config, prosecdef AS definer, provolatile::text AS volatility FROM pg_proc
        WHERE oid = ANY (ARRAY(SELECT to_regprocedure(f) FROM unnest($1::text[]) f)) ORDER BY proname`,
      [SEARCH_INDEX_ANALYTICS_FUNCTIONS],
    );
    for (const fn of settings) {
      assert.equal(fn.definer, false, `${fn.name}: SECURITY INVOKER`);
      if (fn.name === 'search_index_line_analytics') {
        assert.deepEqual([fn.config, fn.volatility], [null, 's'], 'the line helper stays inlinable: no SET clause, STABLE');
      } else {
        assert.deepEqual(fn.config, ['search_path=public, pg_temp', 'plan_cache_mode=force_custom_plan'], `${fn.name}: the settings of the budget statement triggers`);
      }
    }

    // The entries as a database that never ran the migration holds them.
    await runner.query(
      `UPDATE search_index SET extra_json = extra_json - 'analytics', search_vector = ''::tsvector
        WHERE tenant_id = $1 AND entity_id = ANY($2::uuid[])`,
      [d.tenantId, Object.values(lines)],
    );
    const rerun = await asMigration(runner, () => migration.up(runner));
    assert.equal(rerun.length, 1, 'one line logged');
    assert.match(rerun[0], /^\[Migration\] SearchIndexAnalyticsValues: .*every tenant's lines reindexed in \d+ ms$/);
    assert.deepEqual(await definitions(runner), before, 'a rerun gives the same functions and triggers');
    await setCurrentTenant(runner, d.tenantId);
    for (const kind of KINDS) {
      assert.equal(await analytics(runner, kind, lines[kind]), 'Nature de coût: Matériel', `${kind}: the reindex fills an existing line`);
      assert.equal(await inVector(runner, kind, lines[kind], 'Matériel', '{b}'), true, `${kind}: and its vector`);
    }

    await asMigration(runner, () => migration.down(runner));
    const after = await definitions(runner);
    assert.deepEqual(after.functions, before.functions.map(() => null), 'down(): the new functions are gone');
    assert.deepEqual(after.triggers, [], 'down(): the triggers are gone');
    assert.deepEqual(await bodies(runner), PREVIOUS_BODIES, 'down(): the refresh bodies of 1853000000000 and 1853220000000');
    await setCurrentTenant(runner, d.tenantId);
    for (const kind of KINDS) {
      assert.equal(await analytics(runner, kind, lines[kind]), undefined, `${kind}: down() reindexes without the values`);
    }

    await asMigration(runner, () => migration.up(runner));
    assert.deepEqual(await definitions(runner), before, 'up() after down(): the same functions and triggers');
    await setCurrentTenant(runner, d.tenantId);
    for (const kind of KINDS) {
      assert.equal(await analytics(runner, kind, lines[kind]), 'Nature de coût: Matériel', `${kind}: indexed again`);
    }
  });
}

void runSpecs('search-index-analytics.integration.spec', [
  testLinkedValuesAreIndexed,
  testValueWritesRefreshTheirLines,
  testValueChanges,
  testDimensionChanges,
  testTenantIsolation,
  testMigration,
]);
