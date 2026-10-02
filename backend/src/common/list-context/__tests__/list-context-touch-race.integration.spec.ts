import { assert, progress, runRaceSpecs, sql, withRace } from '../../../spend/__tests__/race-harness';
import { ListContextsService } from '../list-contexts.service';

// Saved list states (lot 2B, PR B2, review fix): reading a context unused for
// a day moves its use date inside the request's transaction. Two requests of
// the same list (the page and its footer totals, or two tabs) read the same
// stale context: the first moves the date and keeps its transaction open for
// the rest of its request. The second must not wait for it, neither on its own
// read nor when it saves the same state again (the use date is then left to
// the first request). Before the fix, the second request's UPDATE (and the
// save's ON CONFLICT DO UPDATE) waited on the first one's row lock until that
// whole request ended.

const svc = new ListContextsService();
const FILTERS = { supplier_name: { filterType: 'set', values: Array.from({ length: 200 }, (_, i) => `Supplier ${String(i).padStart(3, '0')}`) } };

async function staleContextReadsDoNotWait() {
  await withRace('ctx-touch', async (race) => {
    const { id } = await race.seedWith(async (runner) => {
      const saved = await svc.save(runner.manager, race.tenantId, 'spend-items', { filters: FILTERS });
      await runner.query(
        `UPDATE list_contexts SET last_used_at = now() - interval '2 days' WHERE tenant_id = $1 AND id = $2`,
        [race.tenantId, saved.id],
      );
      return saved;
    });

    // Request A (a page of the list) reads the context, moves its use date, and is still running.
    const first = await race.open('page request');
    const firstHolds = race.gate(first, { label: 'use date moved, request still running', when: 'after', match: sql.update('list_contexts') });
    const firstWork = race.start(first, (manager) => svc.find(manager, race.tenantId, id));
    assert.equal(await progress(firstWork, { party: first, gate: firstHolds }), 'gated', 'harness: the page request must pause after moving the use date');

    // Request B (the footer totals of the same list) reads it too, then saves the same state again.
    const second = await race.open('totals request');
    const secondWork = race.start(second, async (manager) => {
      const found = await svc.find(manager, race.tenantId, id);
      const saved = await svc.save(manager, race.tenantId, 'spend-items', { filters: FILTERS });
      return { found, saved };
    });
    assert.equal(await progress(secondWork, { party: second }), 'settled', 'the second request must not wait for the first one to end');
    const { found, saved } = await secondWork;
    assert.equal(found?.id, id);
    assert.deepEqual(found?.state, { filters: FILTERS });
    assert.equal(saved.id, id);

    firstHolds.release();
    assert.equal((await firstWork)?.id, id);
    const row = await race.readOne<{ fresh: boolean; rows: number }>(
      `SELECT bool_and(last_used_at > now() - interval '1 hour') AS fresh, count(*)::int AS rows FROM list_contexts WHERE tenant_id = $1`,
      [race.tenantId],
    );
    assert.deepEqual(row, { fresh: true, rows: 1 }, 'one row, its use date moved by the first request');
  });
}

void runRaceSpecs('list context use date (lot 2B, PR B2)', [
  ['a request reading a stale context never waits for another one moving its use date', staleContextReadsDoNotWait],
]);
