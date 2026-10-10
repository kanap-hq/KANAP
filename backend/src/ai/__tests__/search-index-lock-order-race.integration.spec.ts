import { randomUUID } from 'node:crypto';
import { assert, assertSucceeded, Outcome, pgCode, progress, Race, runRaceSpecs, settle, sql, withRace } from '../../spend/__tests__/race-harness';

// The search index triggers of the analytics values (migration 1853940000000, lot S review) and
// the lock order of the budget lines (`spend/budget-locks.ts`): every writer of a line's search
// entry holds the line first. A value renamed while an import holds some of its lines must wait
// for the import. Before the fix, the rename's trigger wrote the entries of the lines it reached
// first, in id order, without holding the lines: an import holding both lines (locked in id
// order) that had rewritten the second line of its file (the higher id) then needed the entry of
// the first one, held by the rename, which waited for the entry the import held. PostgreSQL
// aborted one of them (40P01), the import as often as not.
// Fixed: `search_index_refresh_budget_lines` locks the lines it refreshes in id order
// (FOR NO KEY UPDATE) before writing their entries, so the rename waits for the import.

async function seedTwoLines(race: Race) {
  return race.seedWith(async (runner) => {
    const [axis] = await runner.query(
      `INSERT INTO analytics_axes (tenant_id, code, name, sort_order) VALUES ($1, 'nature', 'Nature', 1) RETURNING id`,
      [race.tenantId],
    );
    const [value] = await runner.query(
      `INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, 'Matériel') RETURNING id`,
      [race.tenantId, axis.id],
    );
    // Inserted in id order: the rename's refresh reaches the lower id first, whatever its plan.
    const [low, high] = [randomUUID(), randomUUID()].sort();
    for (const [index, id] of [low, high].entries()) {
      await runner.query(
        `INSERT INTO spend_items (id, tenant_id, product_name, currency, effective_start, item_number)
         VALUES ($1, $2, $3, 'EUR', '2026-01-01', $4)`,
        [id, race.tenantId, `Race line ${index + 1}`, index + 1],
      );
      await runner.query(
        `INSERT INTO spend_item_analytics_values (tenant_id, item_id, axis_id, category_id) VALUES ($1, $2, $3, $4)`,
        [race.tenantId, id, axis.id, value.id],
      );
    }
    return { valueId: value.id as string, low, high };
  });
}

async function renameWhileImportHoldsTheLines() {
  await withRace('search-lock', async (race) => {
    const { valueId, low, high } = await seedTwoLines(race);
    const importer = await race.open('import');
    const renamer = await race.open('value rename');

    // The import locks both lines in id order, rewrites the higher one first (its file order),
    // and pauses holding it and its search entry.
    const importHolds = race.gate(importer, { label: 'first line written', when: 'after', match: sql.update('spend_items'), nth: 1 });
    const importWork = race.start(importer, async (manager) => {
      await manager.query(
        `SELECT id FROM spend_items WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR NO KEY UPDATE`,
        [race.tenantId, [low, high]],
      );
      await manager.query(`UPDATE spend_items SET notes = 'import row 1' WHERE id = $1`, [high]);
      await manager.query(`UPDATE spend_items SET notes = 'import row 2' WHERE id = $1`, [low]);
    });
    assert.equal(await progress(importWork, { party: importer, gate: importHolds }), 'gated', 'harness: the import must pause holding both lines');

    const renameWork = race.start(renamer, (manager) =>
      manager.query(`UPDATE analytics_categories SET name = 'Équipement' WHERE id = $1`, [valueId]));
    assert.equal(await progress(renameWork, { party: renamer }), 'blocked', 'the rename waits for the import');

    importHolds.release();
    const [imported, renamed] = await Promise.all([settle(importWork), settle(renameWork)]);
    const deadlocked = (outcome: Outcome) => !outcome.ok && pgCode(outcome.error) === '40P01';
    assert.ok(
      !deadlocked(imported) && !deadlocked(renamed),
      `a value rename and an import holding its lines deadlocked: the ${deadlocked(imported) ? 'import' : 'rename'} was aborted with 40P01`,
    );
    assertSucceeded(imported, 'the import');
    assertSucceeded(renamed, 'the value rename');

    const rows = await race.read(
      `SELECT si.id::text AS id, si.notes, x.extra_json->>'analytics' AS analytics
         FROM spend_items si
         JOIN search_index x ON x.tenant_id = si.tenant_id AND x.entity_type = 'spend_items' AND x.entity_id = si.id
        WHERE si.id = ANY($1::uuid[]) ORDER BY si.id`,
      [[low, high]],
    );
    assert.deepEqual(
      rows.map((row) => [row.id, row.notes, row.analytics]),
      [[low, 'import row 2', 'Nature: Équipement'], [high, 'import row 1', 'Nature: Équipement']],
      'both writes went through and both entries carry the new name',
    );
  });
}

void runRaceSpecs('Search index lock order races', [
  ['lot S review: a value renamed while an import holds its lines waits for it, no deadlock', renameWhileImportHoldsTheLines],
]);
