import { QueryRunner } from 'typeorm';
import { PREFLIGHT_STALE } from '../budget-file/import-file';
import { loadBudgetFile } from './budget-file.fixtures';
import { itemService, lineBody, seedCompany } from './cost-center.fixtures';
import { Kind } from './round-inputs.fixtures';
import { assert, assertClean, assertSucceeded, describe, httpStatus, progress, Race, settle, sql, withRace } from './race-harness';

// Races of the line update (`SpendItemsService.update`, `CapexItemsService.update`),
// shared by the OPEX and CAPEX race specs (not a spec itself).
//
// An update used to read the line without a lock, merge the body into it and
// call TypeORM `save()`, which reloads the row and writes back every column
// that differs from that reload. A column another request committed between
// the read and the save was put back to the value read first (Annexe A #2;
// plan section 3.4, rows 2 and 3), and a change committed between the reload
// and the UPDATE escaped the chart-of-accounts check (Annexe A #12).
//
// Fixed in lot 3B (`item-locked-update.ts`): the line is locked
// `FOR NO KEY UPDATE`, read again under the lock, and only the columns
// received are updated; `resolveItemWrite` checks the locked row.
//
// The budget file load (Annexe A #3, the OPEX line import before it) writes
// lines through the same update, after its own line lock, and refuses the
// whole file when a line changed after the preflight.

// The lines of both natures live in spend_items since lot Z1.
const TABLE: Record<Kind, string> = { opex: 'spend_items', capex: 'spend_items' };

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

/** The line's item number, for a budget file row: a CAPEX line's CPX number is its `legacy_number` since lot Z1. */
async function fileRef(race: Race, kind: Kind, itemId: string): Promise<string> {
  const row = await race.readOne(
    `SELECT item_number::int AS n, legacy_number FROM ${TABLE[kind]} WHERE tenant_id = $1 AND id = $2 AND nature = $3`,
    [race.tenantId, itemId, kind],
  );
  return kind === 'opex' ? `OPX-${row.n}` : row.legacy_number;
}

/**
 * Annexe A #3: a budget file load writes only the columns its file changes.
 * The load holds the line; a user's supplier change waits for it, then
 * commits over a line whose notes came from the file. Neither is put back.
 */
async function budgetFileVersusEdit(kind: Kind) {
  await withRace(`${kind}-file-edit`, async (race) => {
    const { itemId, newSupplier } = await race.seedWith(async (runner) => {
      const { companyId } = await seedCompany(runner, race.tenantId, 'Race company');
      const oldSupplier = await seedSupplier(runner, race.tenantId, 'Old supplier');
      const newSupplier = await seedSupplier(runner, race.tenantId, 'New supplier');
      const itemId = await seedLine(runner, kind, { paying_company_id: companyId, supplier_id: oldSupplier, notes: 'Start' });
      return { itemId, newSupplier };
    });
    const file = `item_number,name,notes\n${await fileRef(race, kind, itemId)},Race line,From the file\n`;
    const importer = await race.open('budget file load');
    const user = await race.open('user (supplier)');

    const importHolds = race.gate(importer, { label: 'lock the line', when: 'after', match: sql.lockOn(TABLE[kind]) });
    const importWork = race.start(importer, (manager) => loadBudgetFile(manager, kind, race.tenantId, file));
    assert.equal(await progress(importWork, { party: importer, gate: importHolds }), 'gated', 'harness: the load must pause holding the line');

    const userWork = race.start(user, (manager) => itemService(kind).update(itemId, { supplier_id: newSupplier }, undefined, { manager }));
    assert.equal(await progress(userWork, { party: user }), 'blocked', 'the user\'s save waits for the load\'s line lock');
    importHolds.release();
    const [importDone, userDone] = await Promise.all([settle(importWork), settle(userWork)]);
    assertSucceeded(importDone, 'the load');
    assert.equal((importDone as any).value?.updated, 1, `the load result: ${JSON.stringify((importDone as any).value?.errors)}`);
    assertSucceeded(userDone, 'the user\'s supplier change');

    const stored = await race.readOne(`SELECT notes, supplier_id FROM ${TABLE[kind]} WHERE tenant_id = $1 AND id = $2`, [race.tenantId, itemId]);
    assert.equal(stored?.notes, 'From the file', 'the file\'s notes are loaded');
    assert.equal(stored?.supplier_id, newSupplier, 'the user\'s supplier stays');
  });
}

/**
 * A line changed after the preflight (3B review, the blank company case of
 * the old import): a user moves the line to another company while the load
 * has read the file but not yet locked anything. The load is refused (409,
 * run the preflight again) and writes nothing; the user's company stays.
 * Loaded again, a blank company cell keeps that company and the account
 * resolves in its chart.
 */
async function budgetFileAfterChange(kind: Kind) {
  await withRace(`${kind}-file-stale`, async (race) => {
    const s = await race.seedWith(async (runner) => {
      const one = await seedCompany(runner, race.tenantId, 'Company one', 6000);
      const two = await seedCompany(runner, race.tenantId, 'Company two', 6000);
      const itemId = await seedLine(runner, kind, { paying_company_id: one.companyId, account_id: one.accountId, notes: 'Start' });
      return { itemId, two };
    });
    // Company cell blank: "keep the line's company".
    const file = `item_number,name,company_name,account_number,notes\n${await fileRef(race, kind, s.itemId)},Race line,,6000,From the file\n`;
    const importer = await race.open('budget file load');
    const user = await race.open('user (company)');

    const beforeLock = race.gate(importer, { label: 'take the tenant lock', when: 'before', match: (text) => /pg_try_advisory_xact_lock/.test(text) });
    const importWork = race.start(importer, (manager) => loadBudgetFile(manager, kind, race.tenantId, file));
    assert.equal(await progress(importWork, { party: importer, gate: beforeLock }), 'gated', 'harness: the load must pause after its preflight, before its locks');

    assertSucceeded(await settle(race.start(user, (manager) => itemService(kind).update(
      s.itemId, { paying_company_id: s.two.companyId, account_id: s.two.accountId }, undefined, { manager },
    ))), 'the user\'s company change');
    beforeLock.release();
    const importDone = await settle(importWork);
    assert.ok(!importDone.ok && httpStatus(importDone.error) === 409, `the load must be refused with a 409; it ${describe(importDone)}`);
    assert.equal((importDone.error as Error).message, PREFLIGHT_STALE);

    const read = () => race.readOne(
      `SELECT c.name AS company, i.account_id, i.notes FROM ${TABLE[kind]} i
         LEFT JOIN companies c ON c.tenant_id = i.tenant_id AND c.id = i.paying_company_id
        WHERE i.tenant_id = $1 AND i.id = $2`,
      [race.tenantId, s.itemId],
    );
    assert.deepEqual(await read(), { company: 'Company two', account_id: s.two.accountId, notes: 'Start' }, 'the refused load wrote nothing; the user\'s company stays');

    const again = await settle(race.start(importer, (manager) => loadBudgetFile(manager, kind, race.tenantId, file)));
    assertSucceeded(again, 'the load after a new preflight');
    assert.deepEqual(
      await read(),
      { company: 'Company two', account_id: s.two.accountId, notes: 'From the file' },
      'a blank company cell keeps the line\'s company and the account resolves in its chart',
    );
  });
}

export function itemUpdateRaceTests(kind: Kind): Array<[string, () => Promise<void>]> {
  const label = kind.toUpperCase();
  return [
    [`${label} Annexe A #2: a notes save keeps the supplier committed meanwhile (3B)`, () => supplierVersusNotes(kind)],
    [`${label} Annexe A #2: a notes save keeps the end of validity committed meanwhile (3B)`, () => endOfValidityVersusNotes(kind)],
    [`${label} Annexe A #12: company and account always from the same chart (3B)`, () => companyVersusAccount(kind)],
    [`${label} Annexe A #3: a budget file load keeps a column a user changed meanwhile (3B)`, () => budgetFileVersusEdit(kind)],
    [`${label} a budget file load refuses a line changed after its preflight; a blank company keeps the user's company (3B review)`, () => budgetFileAfterChange(kind)],
  ];
}
