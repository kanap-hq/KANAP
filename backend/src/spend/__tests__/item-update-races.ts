import { QueryRunner } from 'typeorm';
import { itemService, lineBody, seedCompany } from './cost-center.fixtures';
import { Kind } from './round-inputs.fixtures';
import { assert, assertClean, assertSucceeded, progress, settle, sql, withRace } from './race-harness';

// Races of the line update (`SpendItemsService.update`, `CapexItemsService.update`),
// shared by the OPEX and CAPEX race specs (not a spec itself).
//
// Today an update reads the line without a lock, merges the body into it and
// calls TypeORM `save()`, which reloads the row and writes back every column
// that differs from that reload. A column another request committed between
// the read and the save is therefore put back to the value read first
// (Annexe A #2; plan section 3.4, rows 2 and 3), and a change committed
// between the reload and the UPDATE escapes the chart-of-accounts check
// (Annexe A #12).
//
// Target (lot 3B): the line is read `FOR NO KEY UPDATE`, re-read under the
// lock, and only the columns received are updated; `resolveItemWrite` checks
// the locked row. Each test below must then pass unchanged.

const TABLE: Record<Kind, string> = { opex: 'spend_items', capex: 'capex_items' };

async function seedSupplier(runner: QueryRunner, tenantId: string, name: string): Promise<string> {
  const [row] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, name]);
  return row.id;
}

/** One line of the kind, created through the service, committed. */
async function seedLine(runner: QueryRunner, kind: Kind, values: Record<string, unknown>): Promise<string> {
  const line = await itemService(kind).create(lineBody(kind, 'Race line', values), undefined, { manager: runner.manager });
  return line.id;
}

/**
 * Annexe A #2 (section 3.4, row 2): A changes the supplier while B saves its
 * notes. B read the line before A committed; B's save must not put the old
 * supplier back.
 */
async function supplierVersusNotes(kind: Kind) {
  await withRace(`${kind}-supplier`, async (race) => {
    const { itemId, oldSupplier, newSupplier } = await race.seedWith(async (runner) => {
      const { companyId } = await seedCompany(runner, race.tenantId, 'Race company');
      const oldSupplier = await seedSupplier(runner, race.tenantId, 'Old supplier');
      const newSupplier = await seedSupplier(runner, race.tenantId, 'New supplier');
      const itemId = await seedLine(runner, kind, { paying_company_id: companyId, supplier_id: oldSupplier, notes: 'Start' });
      return { itemId, oldSupplier, newSupplier };
    });
    const svc = itemService(kind);
    const a = await race.open('A (supplier)');
    const b = await race.open('B (notes)');

    const bRead = race.gate(b, { label: 'read the line', when: 'after', match: sql.select(TABLE[kind]) });
    const bWork = race.start(b, (manager) => svc.update(itemId, { notes: 'Notes from B' }, undefined, { manager }));
    assert.equal(await progress(bWork, { party: b, gate: bRead }), 'gated', 'harness: B must pause after reading the line');

    const aWork = race.start(a, (manager) => svc.update(itemId, { supplier_id: newSupplier }, undefined, { manager }));
    await progress(aWork, { party: a }); // finishes today; waits for B's row lock once the update locks the line (3B)
    bRead.release();
    const [aDone, bDone] = await Promise.all([settle(aWork), settle(bWork)]);
    assertSucceeded(aDone, 'A (supplier change)');
    assertSucceeded(bDone, 'B (notes save)');

    const row = await race.readOne(
      `SELECT i.supplier_id, s.name AS supplier, i.notes FROM ${TABLE[kind]} i LEFT JOIN suppliers s ON s.id = i.supplier_id WHERE i.id = $1`,
      [itemId],
    );
    assert.equal(row?.notes, 'Notes from B', 'B\'s notes are saved');
    assert.ok(
      row?.supplier_id === newSupplier,
      row?.supplier_id === oldSupplier
        ? `B's notes save put "${row?.supplier}" back over the "New supplier" A had committed (lost update, both requests succeeded)`
        : `unexpected supplier "${row?.supplier}"`,
    );
  });
}

/**
 * Annexe A #2 (section 3.4, row 3): A sets an end of validity while B saves
 * its notes. B's save must not reactivate the line.
 */
async function endOfValidityVersusNotes(kind: Kind) {
  await withRace(`${kind}-validity`, async (race) => {
    const itemId = await race.seedWith(async (runner) => {
      const { companyId } = await seedCompany(runner, race.tenantId, 'Race company');
      return seedLine(runner, kind, { paying_company_id: companyId, notes: 'Start' });
    });
    const svc = itemService(kind);
    const a = await race.open('A (end of validity)');
    const b = await race.open('B (notes)');
    const endOfValidity = '2025-06-30T12:00:00.000Z';

    const bRead = race.gate(b, { label: 'read the line', when: 'after', match: sql.select(TABLE[kind]) });
    const bWork = race.start(b, (manager) => svc.update(itemId, { notes: 'Notes from B' }, undefined, { manager }));
    assert.equal(await progress(bWork, { party: b, gate: bRead }), 'gated', 'harness: B must pause after reading the line');

    const aWork = race.start(a, (manager) => svc.update(itemId, { disabled_at: endOfValidity }, undefined, { manager }));
    await progress(aWork, { party: a });
    bRead.release();
    const [aDone, bDone] = await Promise.all([settle(aWork), settle(bWork)]);
    assertSucceeded(aDone, 'A (end of validity)');
    assertSucceeded(bDone, 'B (notes save)');

    const row = await race.readOne(
      `SELECT disabled_at, status::text AS status, notes FROM ${TABLE[kind]} WHERE id = $1`,
      [itemId],
    );
    assert.equal(row?.notes, 'Notes from B', 'B\'s notes are saved');
    const stored = row?.disabled_at ? new Date(row.disabled_at).toISOString() : null;
    assert.deepEqual(
      [stored, row?.status], [endOfValidity, 'disabled'],
      stored === null
        ? `B's notes save reactivated the line: end of validity back to empty, status ${row?.status} (A's end of validity lost)`
        : `unexpected end of validity ${stored} / status ${row?.status}`,
    );
  });
}

/**
 * Annexe A #12: A moves the line to a company of another chart of
 * accounts while B picks an account of the old chart. Whatever the order, the
 * line must never end with a company and an account of different charts; a
 * refused write is a 400.
 */
async function companyVersusAccount(kind: Kind) {
  await withRace(`${kind}-chart`, async (race) => {
    const seeded = await race.seedWith(async (runner) => {
      const oldCompany = await seedCompany(runner, race.tenantId, 'Company on chart X', 6000);
      const [oldChartAccount] = await runner.query(
        `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name) VALUES ($1, $2, 6100, 'Chart X account') RETURNING id`,
        [race.tenantId, oldCompany.chartId],
      );
      const newCompany = await seedCompany(runner, race.tenantId, 'Company on chart Y', 7000);
      const itemId = await seedLine(runner, kind, { paying_company_id: oldCompany.companyId });
      return { itemId, oldCompany, newCompany, oldChartAccount: oldChartAccount.id as string };
    });
    const { itemId, newCompany, oldChartAccount } = seeded;
    const svc = itemService(kind);
    const a = await race.open('A (company)');
    const b = await race.open('B (account)');

    // B passed the chart check against the company it read and TypeORM's
    // reload; it pauses right before writing the line.
    const bWrite = race.gate(b, { label: 'write the line', when: 'before', match: sql.update(TABLE[kind]) });
    const bWork = race.start(b, (manager) => svc.update(itemId, { account_id: oldChartAccount }, undefined, { manager }));
    assert.equal(await progress(bWork, { party: b, gate: bWrite }), 'gated', 'harness: B must pause before writing the line');

    const aWork = race.start(a, (manager) => svc.update(itemId, { paying_company_id: newCompany.companyId }, undefined, { manager }));
    await progress(aWork, { party: a });
    bWrite.release();
    const [aDone, bDone] = await Promise.all([settle(aWork), settle(bWork)]);
    assertClean(aDone, 'A (company change)', [400]);
    assertClean(bDone, 'B (account choice)', [400]);

    const row = await race.readOne(
      `SELECT c.name AS company, c.coa_id AS company_chart, a.account_name AS account, a.coa_id AS account_chart
       FROM ${TABLE[kind]} i
       JOIN companies c ON c.id = i.paying_company_id
       LEFT JOIN accounts a ON a.id = i.account_id
       WHERE i.id = $1`,
      [itemId],
    );
    assert.ok(
      row && (row.account_chart === null || row.account_chart === row.company_chart),
      `the line ended with "${row?.company}" and the account "${row?.account}" of another chart of accounts `
      + `(A ${aDone.ok ? 'succeeded' : 'was refused'}, B ${bDone.ok ? 'succeeded' : 'was refused'})`,
    );
  });
}

export function itemUpdateRaceTests(kind: Kind): Array<[string, () => Promise<void>]> {
  const label = kind.toUpperCase();
  return [
    [`${label} Annexe A #2: a notes save keeps the supplier committed meanwhile (3B)`, () => supplierVersusNotes(kind)],
    [`${label} Annexe A #2: a notes save keeps the end of validity committed meanwhile (3B)`, () => endOfValidityVersusNotes(kind)],
    [`${label} Annexe A #12: company and account always from the same chart (3B)`, () => companyVersusAccount(kind)],
  ];
}
