import { replaceItemApplications } from '../item-applications';
import { captureAudit, Kind, seedItem } from './round-inputs.fixtures';
import { assert, assertSucceeded, progress, runRaceSpecs, settle, sql, withRace } from './race-harness';

// Race (plan planning/perf-scale, step 0.3, Annexe A #15), fixed before lot
// 3A by migration 1853690000000 (unique key on both link tables) and the line
// lock of `replaceItemApplications`. Runs in CI.
//
// `replaceItemApplications` deletes the line's links and inserts the new set
// (`item-applications.ts:74-77`). Two saves of the relations panel: B's DELETE
// cannot see A's uncommitted links, so both insert the same application.
// - OPEX: the second insert waits for A, then hits `uq_app_spend` (23505), a 500.
// - CAPEX: `application_capex_items` has no unique index (the file header
//   says replacing the whole set "cannot create duplicates"): both inserts
//   go through and the line keeps the same application twice.
// Target: idempotent link writes (unit add and remove, `ON CONFLICT DO
// NOTHING`, and a unique index on the CAPEX link table): no error, no
// duplicate, the line ends with the applications both users wanted.

const LINKS: Record<Kind, { table: string; itemFk: string }> = {
  opex: { table: 'application_spend_items', itemFk: 'spend_item_id' },
  capex: { table: 'application_capex_items', itemFk: 'capex_item_id' },
};

async function twoPanelSaves(kind: Kind) {
  await withRace(`${kind}-applications`, async (race) => {
    const { itemId, crm, erp } = await race.seedWith(async (runner) => {
      const itemId = await seedItem(runner, kind, race.tenantId, 1);
      const [crm] = await runner.query(`INSERT INTO applications (tenant_id, name) VALUES ($1, 'Race CRM') RETURNING id`, [race.tenantId]);
      const [erp] = await runner.query(`INSERT INTO applications (tenant_id, name) VALUES ($1, 'Race ERP') RETURNING id`, [race.tenantId]);
      return { itemId, crm: crm.id as string, erp: erp.id as string };
    });
    const item = { id: itemId, tenant_id: race.tenantId };
    const save = (ids: string[]) => (manager: any) => replaceItemApplications({ manager, audit: captureAudit() as any }, kind, item, ids, null);
    const a = await race.open('A (CRM)');
    const b = await race.open('B (CRM and ERP)');

    const aInserted = race.gate(a, { label: 'insert the links', when: 'after', match: sql.insertInto(LINKS[kind].table) });
    const aWork = race.start(a, save([crm]));
    assert.equal(await progress(aWork, { party: a, gate: aInserted }), 'gated', 'harness: A must pause after inserting its links');

    const bWork = race.start(b, save([crm, erp]));
    await progress(bWork, { party: b }); // OPEX: B waits on A's CRM link (unique index); CAPEX: B finishes
    aInserted.release();
    const [aDone, bDone] = await Promise.all([settle(aWork), settle(bWork)]);
    assertSucceeded(aDone, 'A');
    assertSucceeded(bDone, 'B');

    const rows: Array<{ name: string }> = await race.read(
      `SELECT a.name FROM ${LINKS[kind].table} l JOIN applications a ON a.id = l.application_id
       WHERE l.${LINKS[kind].itemFk} = $1 ORDER BY a.name`,
      [itemId],
    );
    assert.deepEqual(
      rows.map((r) => r.name), ['Race CRM', 'Race ERP'],
      `the line must link each application once; it has: ${rows.map((r) => r.name).join(', ') || 'none'}`,
    );
  });
}

void runRaceSpecs('Item application link races', [
  ['Annexe A #15: two OPEX relations panel saves (3A)', () => twoPanelSaves('opex')],
  ['Annexe A #15: two CAPEX relations panel saves, no duplicate link (3A, unique index)', () => twoPanelSaves('capex')],
]);
