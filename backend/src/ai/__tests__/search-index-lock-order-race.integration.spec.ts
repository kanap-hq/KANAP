import { randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { services } from '../../analytics/__tests__/analytics-test-helpers';
import { lockBudgetLines } from '../../spend/budget-locks';
import { updateItemUnderLock } from '../../spend/item-locked-update';
import {
  assert, assertSucceeded, describe, Outcome, pgCode, progress, Race, runRaceSpecs, settle, sql, withRace,
} from '../../spend/__tests__/race-harness';

// The search index of the budget lines and the edits of analytics values and dimensions
// (migration 1853940000000, lot S review). A first version of the migration refreshed, on a value
// renamed or a dimension changed, the entries of every line holding it, without holding those
// lines. Locking them in id order first (to wait for an import instead of racing it on the
// entries) closed another cycle: the value's edit locks the value FOR UPDATE, then its trigger
// waited for the lines an import held, while the import, on its next row, asked for that value
// FOR KEY SHARE to link it. PostgreSQL aborted one of them (40P01).
// Fixed by dropping that cascade: only the line's own values refresh its entry, written under the
// line's lock. A value or dimension edit touches no line, never waits for an import, and the
// lines catch up at their next write or at the reindex. The edits here go through their services
// (`AnalyticsCategoriesService.update`, `AnalyticsAxesService.update`), the import through the
// line locks and the locked line update of the item imports.

type Seeded = { axisId: string; valueId: string; low: string; high: string };

/** "Nature" holding "Matériel"; two OPEX lines in id order, the higher one holding the value. */
async function seedTwoLines(race: Race): Promise<Seeded> {
  return race.seedWith(async (runner) => {
    const [axis] = await runner.query(
      `INSERT INTO analytics_axes (tenant_id, code, name, sort_order) VALUES ($1, 'nature', 'Nature', 1) RETURNING id`,
      [race.tenantId],
    );
    const [value] = await runner.query(
      `INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, 'Matériel') RETURNING id`,
      [race.tenantId, axis.id],
    );
    // A line update checks the line as a whole: an OPEX line needs its paying company.
    const [company] = await runner.query(
      `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Race company', 'FR', 'Lyon') RETURNING id`,
      [race.tenantId],
    );
    const [low, high] = [randomUUID(), randomUUID()].sort();
    for (const [index, id] of [low, high].entries()) {
      await runner.query(
        `INSERT INTO spend_items (id, tenant_id, product_name, currency, effective_start, item_number, paying_company_id)
         VALUES ($1, $2, $3, 'EUR', '2026-01-01', $4, $5)`,
        [id, race.tenantId, `Race line ${index + 1}`, index + 1, company.id],
      );
    }
    await runner.query(
      `INSERT INTO spend_item_analytics_values (tenant_id, item_id, axis_id, category_id) VALUES ($1, $2, $3, $4)`,
      [race.tenantId, high, axis.id, value.id],
    );
    return { axisId: axis.id as string, valueId: value.id as string, low, high };
  });
}

/**
 * An import of two rows holding both lines (locked in id order), paused after its first row (the
 * higher line, its file order) is written; the edit runs there. The second row then sets the
 * lower line's value: the locked update takes the value FOR KEY SHARE, writes the line, then its
 * value, whose trigger refreshes the line under the import's lock.
 * Returns the `extra_json.analytics` of both lines once both parties ended.
 */
async function editWhileImportHoldsTheLines(
  race: Race,
  seeded: Seeded,
  what: string,
  edit: (manager: EntityManager) => Promise<unknown>,
): Promise<{ low: string | null; high: string | null }> {
  const { axisId, valueId, low, high } = seeded;
  const importer = await race.open('import');
  const editor = await race.open(what);

  const importHolds = race.gate(importer, { label: 'first row written', when: 'after', match: sql.update('spend_items'), nth: 1 });
  const importWork = race.start(importer, async (manager) => {
    await lockBudgetLines(manager, 'opex', race.tenantId, [low, high]);
    await updateItemUnderLock(manager, 'opex', race.tenantId, high, { notes: 'import row 1' });
    await updateItemUnderLock(manager, 'opex', race.tenantId, low, { notes: 'import row 2', analytics_values: { [axisId]: valueId } });
  });
  assert.equal(await progress(importWork, { party: importer, gate: importHolds }), 'gated', 'harness: the import must pause holding both lines');

  const editWork = race.start(editor, edit);
  const editState = await progress(editWork, { party: editor });

  importHolds.release();
  const [imported, edited] = await Promise.all([settle(importWork), settle(editWork)]);
  const deadlocked = (outcome: Outcome) => !outcome.ok && pgCode(outcome.error) === '40P01';
  assert.ok(
    !deadlocked(imported) && !deadlocked(edited),
    `the ${what} and an import holding the lines deadlocked: the ${deadlocked(imported) ? 'import' : what} was aborted with 40P01`,
  );
  assertSucceeded(edited, `the ${what}`);
  assert.ok(imported.ok, `the import must succeed; it ended with ${describe(imported)}`);
  assert.equal(editState, 'settled', `the ${what} touches no line: it ends without waiting for the import`);

  const rows = await race.read(
    `SELECT si.id::text AS id, x.extra_json->>'analytics' AS analytics
       FROM spend_items si
       JOIN search_index x ON x.tenant_id = si.tenant_id AND x.entity_type = 'spend_items' AND x.entity_id = si.id
      WHERE si.id = ANY($1::uuid[])`,
    [[low, high]],
  );
  const byId = new Map(rows.map((row) => [row.id, row.analytics as string | null]));
  return { low: byId.get(low) ?? null, high: byId.get(high) ?? null };
}

async function valueRenamedWhileImportHoldsTheLines() {
  await withRace('search-value', async (race) => {
    const seeded = await seedTwoLines(race);
    const shown = await editWhileImportHoldsTheLines(race, seeded, 'value rename', (manager) =>
      services(manager).values.update(seeded.valueId, { name: 'Équipement' }, null, { manager, tenantId: race.tenantId }));
    assert.deepEqual(shown, { low: 'Nature: Équipement', high: 'Nature: Matériel' },
      'the line the import wrote after the rename carries the new name; the line written before keeps the old one until its next write or the reindex');
  });
}

async function dimensionChangedWhileImportHoldsTheLines() {
  await withRace('search-dimension', async (race) => {
    const seeded = await seedTwoLines(race);
    const shown = await editWhileImportHoldsTheLines(race, seeded, 'dimension update', (manager) =>
      services(manager).axes.update(seeded.axisId, { name: 'Nature de coût' }, { manager, tenantId: race.tenantId, userId: null }));
    assert.deepEqual(shown, { low: 'Nature de coût: Matériel', high: 'Nature: Matériel' },
      'the line the import wrote after the change carries the new name; the line written before keeps the old one until its next write or the reindex');
  });
}

void runRaceSpecs('Search index and analytics edits races', [
  ['lot S review: a value renamed through its service while an import holds its lines commits, no deadlock', valueRenamedWhileImportHoldsTheLines],
  ['lot S review: a dimension updated through its service while an import holds its lines commits, no deadlock', dimensionChangedWhileImportHoldsTheLines],
]);
