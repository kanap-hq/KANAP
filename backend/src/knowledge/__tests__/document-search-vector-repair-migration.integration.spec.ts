import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { DocumentSearchVectorRepair1856190000000 } from '../../migrations/1856190000000-document-search-vector-repair';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';

// Migration 1856190000000 against a real database, in a transaction that is rolled back: two tenants
// with missing and out-of-date document search vectors (and the search entries that copied them),
// seeded on the previous schema (down() first: the inline trigger function, no compute function).
// The first up() replaces the trigger function, repairs every vector and its search entry, logs one
// count per tenant, leaves current documents untouched and restores the tenant setting; a second
// up() updates no row.

const migration = new DocumentSearchVectorRepair1856190000000();

type Seeded = { tenantId: string; missing: string; stale: string; current: string };

async function seedTenantDocuments(runner: QueryRunner, tag: string): Promise<Seeded> {
  const tenantId = await seedTenant(runner, `docvec-repair-${tag}`);
  const libraryId = randomUUID();
  await runner.query(
    `INSERT INTO document_libraries (id, tenant_id, name, slug, is_system, display_order, created_at, updated_at)
     VALUES ($1, $2, 'Repair spec', 'repair-spec', false, 0, now(), now())`,
    [libraryId, tenantId],
  );
  const insert = async (itemNumber: number, title: string, body: string) => {
    const id = randomUUID();
    await runner.query(
      `INSERT INTO documents (
         id, tenant_id, item_number, title, content_markdown, content_plain, library_id,
         status, revision, current_version_number, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $5, $6, 'published', 1, 1, now(), now())`,
      [id, tenantId, itemNumber, title, body, libraryId],
    );
    return id;
  };
  const missing = await insert(1, `Fiche ${tag}`, `La présure coagule le lait ${tag}.`);
  const stale = await insert(2, `Note ${tag}`, `Le babeurre nourrit les veaux ${tag}.`);
  const current = await insert(3, `Guide ${tag}`, `Le sérac se mange frais ${tag}.`);
  // What the entity used to leave behind: an update naming only search_vector, which the vector
  // trigger ignores and the search_index trigger copies.
  await runner.query(`UPDATE documents SET search_vector = NULL WHERE id = $1`, [missing]);
  await runner.query(`UPDATE documents SET search_vector = to_tsvector('simple', 'ancien texte') WHERE id = $1`, [stale]);
  return { tenantId, missing, stale, current };
}

/** `migrated`: documents_search_vector_compute exists (after up()); before it, `current` is null. */
async function state(runner: QueryRunner, seeded: Seeded, migrated: boolean) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [seeded.tenantId]);
  const current = migrated
    ? `COALESCE(d.search_vector = documents_search_vector_compute(d.title, d.summary, d.content_plain), false)`
    : `NULL::boolean`;
  const rows: Array<{ id: string; ctid: string; vector: string | null; current: boolean | null; indexed: boolean }> = await runner.query(
    `SELECT d.id,
            d.ctid::text AS ctid,
            d.search_vector::text AS vector,
            ${current} AS current,
            COALESCE(si.search_vector @@ plainto_tsquery('kanap_fr', split_part(d.content_plain, ' ', 2)), false) AS indexed
       FROM documents d
       LEFT JOIN search_index si
         ON si.tenant_id = d.tenant_id AND si.entity_type = 'documents' AND si.entity_id = d.id
      WHERE d.tenant_id = $1`,
    [seeded.tenantId],
  );
  await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
  return new Map(rows.map((row) => [row.id, row]));
}

async function captureLog(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines;
}

async function testRepairsTenantByTenant() {
  await inRolledBackTransaction(async (runner) => {
    await migration.down(runner);
    const [helper] = await runner.query(
      `SELECT count(*)::int AS count FROM pg_proc WHERE proname = 'documents_search_vector_compute'`,
    );
    assert.equal(helper.count, 0, 'previous schema: no compute function');
    const a = await seedTenantDocuments(runner, 'a');
    const b = await seedTenantDocuments(runner, 'b');

    const seededState = new Map<string, Map<string, any>>();
    for (const seeded of [a, b]) {
      const before = await state(runner, seeded, false);
      seededState.set(seeded.tenantId, before);
      assert.equal(before.get(seeded.missing)!.vector, null, 'seeded: missing vector');
      assert.equal(before.get(seeded.missing)!.indexed, false, 'seeded: its search entry has no body');
      assert.equal(before.get(seeded.stale)!.vector, "'ancien':1 'texte':2", 'seeded: stale vector');
      assert.equal(before.get(seeded.stale)!.indexed, false, 'seeded: its search entry has the old body');
      assert.notEqual(before.get(seeded.current)!.vector, null, 'seeded: vector from the previous trigger');
      assert.equal(before.get(seeded.current)!.indexed, true, 'seeded: current search entry');
    }

    await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
    const firstLog = await captureLog(() => migration.up(runner));
    const [setting] = await runner.query(`SELECT current_setting('app.current_tenant', true) AS value`);
    assert.equal(setting.value, '', 'the tenant setting is restored');
    const [trigger] = await runner.query(
      `SELECT prosrc FROM pg_proc WHERE proname = 'documents_search_vector_sync'`,
    );
    assert.match(trigger.prosrc, /documents_search_vector_compute\(NEW\.title, NEW\.summary, NEW\.content_plain\)/,
      'the trigger function calls the compute function');

    for (const seeded of [a, b]) {
      const after = await state(runner, seeded, true);
      for (const id of [seeded.missing, seeded.stale, seeded.current]) {
        assert.equal(after.get(id)!.current, true, `repaired: vector of ${id}`);
        assert.equal(after.get(id)!.indexed, true, `repaired: search entry of ${id}`);
      }
      const before = seededState.get(seeded.tenantId)!;
      assert.equal(after.get(seeded.current)!.ctid, before.get(seeded.current).ctid, 'a current document is not updated');
      const line = firstLog.find((entry) => entry.includes(`tenant ${seeded.tenantId}:`));
      assert.ok(line, `a log line for tenant ${seeded.tenantId}`);
      assert.match(line!, /: 2 document search vector\(s\) repaired$/);
    }

    const snapshot = new Map<string, Map<string, any>>();
    for (const seeded of [a, b]) snapshot.set(seeded.tenantId, await state(runner, seeded, true));
    const secondLog = await captureLog(() => migration.up(runner));
    for (const seeded of [a, b]) {
      const again = await state(runner, seeded, true);
      for (const [id, row] of again) {
        assert.equal(row.ctid, snapshot.get(seeded.tenantId)!.get(id).ctid, `second run: ${id} is not updated`);
      }
      assert.equal(
        secondLog.some((entry) => entry.includes(`tenant ${seeded.tenantId}:`)),
        false,
        'second run: nothing to log for the tenant',
      );
    }

    // The trigger now calls the shared expression, and keeps a new document current.
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [a.tenantId]);
    await runner.query(`UPDATE documents SET content_plain = 'Le beurre de baratte' WHERE id = $1`, [a.current]);
    const [row] = await runner.query(
      `SELECT search_vector = documents_search_vector_compute(title, summary, content_plain) AS current,
              search_vector @@ plainto_tsquery('kanap_fr', 'baratte') AS hit
         FROM documents WHERE id = $1`,
      [a.current],
    );
    assert.equal(row.current, true);
    assert.equal(row.hit, true);
  });
}

async function testDownKeepsTheTrigger() {
  await inRolledBackTransaction(async (runner) => {
    await migration.down(runner);
    const [fn] = await runner.query(
      `SELECT count(*)::int AS count FROM pg_proc WHERE proname = 'documents_search_vector_compute'`,
    );
    assert.equal(fn.count, 0, 'down() drops the helper');
    const seeded = await seedTenantDocuments(runner, 'down');
    await runner.query(`UPDATE documents SET title = 'Fiche du lactosérum' WHERE id = $1`, [seeded.missing]);
    const [row] = await runner.query(
      `SELECT search_vector @@ plainto_tsquery('kanap_fr', 'lactosérum') AS hit FROM documents WHERE id = $1`,
      [seeded.missing],
    );
    assert.equal(row.hit, true, 'the trigger still computes the vector after down()');
  });
}

void runSpecs('document-search-vector-repair-migration.integration.spec', [
  ['testRepairsTenantByTenant', testRepairsTenantByTenant],
  ['testDownKeepsTheTrigger', testDownKeepsTheTrigger],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
