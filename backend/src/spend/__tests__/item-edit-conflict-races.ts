import { QueryRunner } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { EDIT_CONFLICT_CODE, EditConflict } from '../../common/edit-conflicts';
import { ITEM_TABLE, itemService, lineBody, seedCompany } from './cost-center.fixtures';
import { Kind } from './round-inputs.fixtures';
import { Outcome, Race, assert, assertSucceeded, describe, httpStatus, progress, settle, sql, withRace } from './race-harness';

// Field-level edit conflicts of the line update (plan planning/perf-scale,
// lot 3C; contract in `common/edit-conflicts.ts`), shared by the OPEX and
// CAPEX race specs (not a spec itself).
//
// Annexe A #1: A and B edit the same field of a line; before 3C the last
// write won without a word. Now each PATCH carries the value its edit started
// from (`base`); under the line's row lock the server compares it with the
// stored value and refuses a field someone else changed meanwhile with 409
// `edit_conflict` (who, when, their value, yours), nothing written. Two
// edits of different fields never conflict (decision D2).
//
// The parties are two people of the tenant (Marie Dupont and Jean Martin)
// whose saves go through the real audit trail: the 409 names who changed the
// field, from it.

type Setup = {
  itemId: string;
  marie: string;
  jean: string;
  companyId: string;
  oldSupplier: string;
  newSupplier: string;
  otherSupplier: string;
  nature: string;
  region: string;
  /** Values of the Nature dimension. */
  licences: string;
  services: string;
  /** A value of the Region dimension. */
  europe: string;
};

const realAudit = () => new AuditService(undefined as any);

async function seedPerson(runner: QueryRunner, tenantId: string, first: string, last: string): Promise<string> {
  const [role] = await runner.query(
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, $2, 'Edit conflict race role', false, false, now(), now()) RETURNING id`,
    [tenantId, `Edit conflict role ${first}`],
  );
  const [user] = await runner.query(
    `INSERT INTO users (tenant_id, role_id, email, first_name, last_name, status) VALUES ($1, $2, $3, $4, $5, 'enabled') RETURNING id`,
    [tenantId, role.id, `${first.toLowerCase()}.${last.toLowerCase()}@races.example`, first, last],
  );
  return user.id;
}

async function seedSupplier(runner: QueryRunner, tenantId: string, name: string): Promise<string> {
  const [row] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, name]);
  return row.id;
}

async function seedAxis(runner: QueryRunner, tenantId: string, code: string, name: string, sortOrder: number): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO analytics_axes (tenant_id, code, name, sort_order, status) VALUES ($1, $2, $3, $4, 'enabled') RETURNING id`,
    [tenantId, code, name, sortOrder],
  );
  return row.id;
}

async function seedValue(runner: QueryRunner, tenantId: string, axisId: string, name: string): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO analytics_categories (tenant_id, axis_id, name, status) VALUES ($1, $2, $3, 'enabled') RETURNING id`,
    [tenantId, axisId, name],
  );
  return row.id;
}

/** Two people, three suppliers, two dimensions and one line created by Marie (through the service: its audit row). */
async function setup(race: Race, kind: Kind, values: Record<string, unknown> = {}): Promise<Setup> {
  return race.seedWith(async (runner) => {
    const tenantId = race.tenantId;
    const marie = await seedPerson(runner, tenantId, 'Marie', 'Dupont');
    const jean = await seedPerson(runner, tenantId, 'Jean', 'Martin');
    const { companyId } = await seedCompany(runner, tenantId, 'Conflict company');
    const oldSupplier = await seedSupplier(runner, tenantId, 'Old supplier');
    const newSupplier = await seedSupplier(runner, tenantId, 'New supplier');
    const otherSupplier = await seedSupplier(runner, tenantId, 'Other supplier');
    const nature = await seedAxis(runner, tenantId, 'nature', 'Nature', 1);
    const region = await seedAxis(runner, tenantId, 'region', 'Region', 2);
    const licences = await seedValue(runner, tenantId, nature, 'Licences');
    const services = await seedValue(runner, tenantId, nature, 'Services');
    const europe = await seedValue(runner, tenantId, region, 'Europe');
    const line = await itemService(kind, realAudit()).create(
      lineBody(kind, 'Conflict line', { paying_company_id: companyId, supplier_id: oldSupplier, notes: 'Start', ...values }),
      marie,
      { manager: runner.manager },
    );
    return { itemId: line.id, marie, jean, companyId, oldSupplier, newSupplier, otherSupplier, nature, region, licences, services, europe };
  });
}

/** One update of the line by `userId`, on the party's request transaction. */
function update(race: Race, party: Parameters<Race['start']>[0], kind: Kind, s: Setup, userId: string, body: Record<string, unknown>) {
  return race.start(party, (manager) => itemService(kind, realAudit()).update(s.itemId, body, userId, { manager }));
}

/** The 409 `edit_conflict` answer of a refused party. */
function editConflictOf(outcome: Outcome, who: string): { conflicts: EditConflict[]; row_version: number } {
  assert.ok(!outcome.ok, `${who} must be refused with 409 edit_conflict; it succeeded`);
  assert.equal(httpStatus(outcome.error), 409, `${who}: ${describe(outcome)}`);
  const body = (outcome.error as any).getResponse() as { code: string; conflicts: EditConflict[]; row_version: number };
  assert.equal(body.code, EDIT_CONFLICT_CODE, `${who}: ${describe(outcome)}`);
  return body;
}

async function line(race: Race, kind: Kind, itemId: string) {
  return race.readOne(
    `SELECT notes, supplier_id, paying_company_id, currency, effective_start::text AS effective_start, disabled_at, updated_at, row_version
       FROM ${ITEM_TABLE[kind]} WHERE id = $1`,
    [itemId],
  );
}

/** A refused request: its HTTP status and message. */
function refusalOf(outcome: Outcome, who: string): { status: number; message: string } {
  assert.ok(!outcome.ok, `${who} must be refused; it succeeded`);
  const error = outcome.error as any;
  const body = typeof error?.getResponse === 'function' ? error.getResponse() : null;
  return { status: httpStatus(error) as number, message: String(body?.message ?? error?.message ?? '') };
}

/**
 * A holds the line (paused right after its UPDATE, lock held, not committed)
 * while B's request waits for the lock; then A commits and B goes on. B reads
 * the line under the lock after A's commit, as two people saving at the same
 * moment.
 */
async function aThenB(race: Race, kind: Kind, s: Setup, aBody: Record<string, unknown>, bBody: Record<string, unknown>) {
  const a = await race.open('A (Marie)');
  const b = await race.open('B (Jean)');
  const aWrote = race.gate(a, { label: 'updated the line', when: 'after', match: sql.update(ITEM_TABLE[kind]) });
  const aWork = update(race, a, kind, s, s.marie, aBody);
  assert.equal(await progress(aWork, { party: a, gate: aWrote }), 'gated', 'harness: A must pause after its UPDATE');
  const bWork = update(race, b, kind, s, s.jean, bBody);
  assert.equal(await progress(bWork, { party: b }), 'blocked', 'B waits for the line A holds');
  aWrote.release();
  const aDone = await settle(aWork);
  const bDone = await settle(bWork);
  return { aDone, bDone };
}

/**
 * Annexe A #1: A and B edit the notes of the same line. B's save, which
 * started from the notes A replaced, is refused with who and when; B's other
 * field of the same request is not written either (all or nothing). Then B
 * keeps A's notes and saves the supplier alone, or applies his own notes over
 * A's (base = A's value).
 */
async function sameFieldConflict(kind: Kind) {
  await withRace(`${kind}-edit-same`, async (race) => {
    const s = await setup(race, kind);
    const { aDone, bDone } = await aThenB(
      race, kind, s,
      { notes: 'Notes from Marie', base: { notes: 'Start' } },
      { notes: 'Notes from Jean', supplier_id: s.newSupplier, base: { notes: 'Start', supplier_id: s.oldSupplier } },
    );
    assertSucceeded(aDone, 'A (Marie, notes)');
    const answer = editConflictOf(bDone, 'B (Jean, notes and supplier)');
    assert.equal(answer.conflicts.length, 1, 'only the notes conflict: nobody else changed the supplier');
    const [conflict] = answer.conflicts;
    assert.equal(conflict.field, 'notes');
    assert.equal(conflict.base, 'Start');
    assert.equal(conflict.current, 'Notes from Marie');
    assert.equal(conflict.mine, 'Notes from Jean');
    assert.deepEqual(conflict.changed_by, { id: s.marie, name: 'Marie Dupont' }, 'the 409 names who changed the notes');
    const audit = await race.readOne(
      `SELECT created_at FROM audit_log WHERE tenant_id = $1 AND record_id = $2 AND user_id = $3 AND action = 'update' ORDER BY created_at DESC LIMIT 1`,
      [race.tenantId, s.itemId, s.marie],
    );
    assert.equal(conflict.changed_at, new Date(audit.created_at).toISOString(), 'and when, from her audit row');

    let stored = await line(race, kind, s.itemId);
    assert.equal(stored.notes, 'Notes from Marie', 'A\'s notes stay');
    assert.equal(stored.supplier_id, s.oldSupplier, 'B\'s supplier, in the refused request, is not written');
    assert.equal(answer.row_version, stored.row_version, 'the 409 carries the current row_version');
    const jeanRows = await race.read(`SELECT 1 FROM audit_log WHERE tenant_id = $1 AND record_id = $2 AND user_id = $3`, [race.tenantId, s.itemId, s.jean]);
    assert.equal(jeanRows.length, 0, 'nothing of the refused request reached the audit trail');

    // "Keep her value": the notes are dropped, the rest goes again.
    const b = await race.open('B again');
    assertSucceeded(await settle(update(race, b, kind, s, s.jean, { supplier_id: s.newSupplier, base: { supplier_id: s.oldSupplier } })), 'B keeps her notes');
    stored = await line(race, kind, s.itemId);
    assert.equal(stored.notes, 'Notes from Marie');
    assert.equal(stored.supplier_id, s.newSupplier);

    // "Apply mine": the base is now her value.
    assertSucceeded(await settle(update(race, b, kind, s, s.jean, { notes: 'Notes from Jean', base: { notes: 'Notes from Marie' } })), 'B applies his notes');
    stored = await line(race, kind, s.itemId);
    assert.equal(stored.notes, 'Notes from Jean');
  });
}

/** D2 (and Annexe A #2): A changes the supplier, B the notes, at the same moment. Both are saved. */
async function differentFieldsMerge(kind: Kind) {
  await withRace(`${kind}-edit-different`, async (race) => {
    const s = await setup(race, kind);
    const { aDone, bDone } = await aThenB(
      race, kind, s,
      { supplier_id: s.newSupplier, base: { supplier_id: s.oldSupplier } },
      { notes: 'Notes from Jean', base: { notes: 'Start' } },
    );
    assertSucceeded(aDone, 'A (Marie, supplier)');
    assertSucceeded(bDone, 'B (Jean, notes)');
    const stored = await line(race, kind, s.itemId);
    assert.equal(stored.supplier_id, s.newSupplier);
    assert.equal(stored.notes, 'Notes from Jean');
  });
}

/**
 * The same value is no conflict: A saves the notes the line already has (a
 * write that changes nothing), so B's base is still the stored value; and A
 * and B both pick the same new supplier.
 */
async function sameValueNoConflict(kind: Kind) {
  await withRace(`${kind}-edit-same-value`, async (race) => {
    const s = await setup(race, kind);
    let { aDone, bDone } = await aThenB(
      race, kind, s,
      { notes: 'Start', base: { notes: 'Start' } },
      { notes: 'Notes from Jean', base: { notes: 'Start' } },
    );
    assertSucceeded(aDone, 'A saves the same notes');
    assertSucceeded(bDone, 'B, whose base is still the stored notes');
    assert.equal((await line(race, kind, s.itemId)).notes, 'Notes from Jean');

    ({ aDone, bDone } = await aThenB(
      race, kind, s,
      { supplier_id: s.newSupplier, base: { supplier_id: s.oldSupplier } },
      { supplier_id: s.newSupplier, base: { supplier_id: s.oldSupplier } },
    ));
    assertSucceeded(aDone, 'A picks the new supplier');
    assertSucceeded(bDone, 'B picks the same one: the stored value is already his');
    assert.equal((await line(race, kind, s.itemId)).supplier_id, s.newSupplier);
  });
}

/** An id field: the 409 names the values (the suppliers' names), not their ids. */
async function referenceConflictLabels(kind: Kind) {
  await withRace(`${kind}-edit-labels`, async (race) => {
    const s = await setup(race, kind);
    const { aDone, bDone } = await aThenB(
      race, kind, s,
      { supplier_id: s.newSupplier, base: { supplier_id: s.oldSupplier } },
      { supplier_id: s.otherSupplier, base: { supplier_id: s.oldSupplier } },
    );
    assertSucceeded(aDone, 'A (Marie, supplier)');
    const [conflict] = editConflictOf(bDone, 'B (Jean, another supplier)').conflicts;
    assert.equal(conflict.field, 'supplier_id');
    assert.deepEqual(conflict.labels, { base: 'Old supplier', current: 'New supplier', mine: 'Other supplier' });
    assert.equal(conflict.changed_by?.name, 'Marie Dupont');
  });
}

/** Analytics values, dimension by dimension: two dimensions merge, the same one conflicts. */
async function analyticsPerDimension(kind: Kind) {
  await withRace(`${kind}-edit-analytics`, async (race) => {
    const s = await setup(race, kind);
    let { aDone, bDone } = await aThenB(
      race, kind, s,
      { analytics_values: { [s.nature]: s.licences }, base: { analytics_values: { [s.nature]: null } } },
      { analytics_values: { [s.region]: s.europe }, base: { analytics_values: { [s.region]: null } } },
    );
    assertSucceeded(aDone, 'A (Nature)');
    assertSucceeded(bDone, 'B (Region): another dimension');

    ({ aDone, bDone } = await aThenB(
      race, kind, s,
      { analytics_values: { [s.nature]: s.services }, base: { analytics_values: { [s.nature]: s.licences } } },
      { analytics_values: { [s.nature]: null }, base: { analytics_values: { [s.nature]: s.licences } } },
    ));
    assertSucceeded(aDone, 'A (Nature: Services)');
    const [conflict] = editConflictOf(bDone, 'B (Nature: cleared)').conflicts;
    assert.equal(conflict.field, `analytics_values.${s.nature}`);
    assert.deepEqual(conflict.labels, { base: 'Licences', current: 'Services', mine: null });
    assert.equal(conflict.changed_by?.name, 'Marie Dupont', 'from the analytics values of her audit row');
    const links = await race.read(
      `SELECT axis_id, category_id FROM ${kind === 'opex' ? 'spend_item_analytics_values' : 'capex_item_analytics_values'} WHERE item_id = $1 ORDER BY axis_id`,
      [s.itemId],
    );
    assert.equal(links.find((row: any) => row.axis_id === s.nature)?.category_id, s.services, 'A\'s value stays');
    assert.equal(links.find((row: any) => row.axis_id === s.region)?.category_id, s.europe);
  });
}

/**
 * The comparison is type-aware: a stored null and a blank base, an id in
 * capitals, a calendar date, an end of validity sent in another offset, an
 * empty dimension are the values the screen showed. A base that differs,
 * an empty base for a field someone filled, or a past end of validity is a
 * conflict.
 */
async function equalityEdges(kind: Kind) {
  await withRace(`${kind}-edit-equality`, async (race) => {
    const s = await setup(race, kind, { notes: null, disabled_at: '2027-06-30T12:00:00.000Z' });
    const party = await race.open('A (Marie)');
    const ok = async (label: string, body: Record<string, unknown>) => assertSucceeded(await settle(update(race, party, kind, s, s.marie, body)), label);
    const refused = async (label: string, body: Record<string, unknown>) => editConflictOf(await settle(update(race, party, kind, s, s.marie, body)), label).conflicts;

    await ok('a blank base for stored null notes', { notes: 'First notes', base: { notes: '' } });
    await ok('a supplier id in capitals', { supplier_id: s.newSupplier, base: { supplier_id: s.oldSupplier.toUpperCase() } });
    await ok('a calendar date', { effective_start: '2026-02-01', base: { effective_start: '2026-01-01' } });
    await ok('the same instant in another offset', {
      disabled_at: '2027-12-31T12:00:00.000Z', status: 'enabled', base: { disabled_at: '2027-06-30T14:00:00+02:00' },
    });
    await ok('an empty dimension', { analytics_values: { [s.nature]: s.licences }, base: { analytics_values: { [s.nature]: null } } });
    await ok('a base for a field the request does not change is ignored', { notes: 'Second notes', base: { notes: 'First notes', supplier_id: s.otherSupplier } });
    // A currency is a code: its case does not make it another one (the column only stores the
    // capitals of `currencies`; a client may send its base in small letters).
    await ok('a currency base in small letters', { currency: 'USD', base: { currency: 'eur' } });

    let conflicts = await refused('an older end of validity', { disabled_at: '2028-01-31T12:00:00.000Z', base: { disabled_at: '2027-06-30T12:00:00.000Z' } });
    assert.deepEqual(conflicts.map((c) => c.field), ['disabled_at']);
    assert.equal(new Date(conflicts[0].current as string).toISOString(), '2027-12-31T12:00:00.000Z');
    conflicts = await refused('an empty base for notes someone wrote', { notes: 'Third notes', base: { notes: null } });
    assert.deepEqual(conflicts.map((c) => c.field), ['notes']);
    conflicts = await refused('an older calendar date', { effective_start: '2026-03-01', base: { effective_start: '2026-01-01' } });
    assert.deepEqual(conflicts.map((c) => c.field), ['effective_start']);
    assert.equal(conflicts[0].current, '2026-02-01');

    // The status is derived from the end of validity: never compared (enabled clears the date).
    await ok('status carries no base of its own', { status: 'enabled', base: { status: 'disabled' } });

    conflicts = await refused('another currency, whatever its case', { currency: 'GBP', base: { currency: 'eur' } });
    assert.deepEqual(conflicts.map((c) => c.field), ['currency']);

    const stored = await line(race, kind, s.itemId);
    assert.equal(stored.notes, 'Second notes');
    assert.equal(stored.effective_start, '2026-02-01');
    assert.equal(stored.disabled_at, null);
    assert.equal(stored.currency, 'USD');
  });
}

/**
 * Who changed it: a value no audit row explains was written outside the
 * audit trail (a script; a supplier deleted, which empties the lines that
 * name it): nobody is named, never the line's last editor, who did not touch
 * the field, and the time is the line's last update. A request without a
 * base still writes as before (last write wins), for clients that do not
 * send one.
 */
async function authorFallbackAndNoBase(kind: Kind) {
  await withRace(`${kind}-edit-fallback`, async (race) => {
    const s = await setup(race, kind);
    const party = await race.open('A');
    assertSucceeded(await settle(update(race, party, kind, s, s.marie, { notes: 'Notes from Marie' })), 'Marie, no base');
    assertSucceeded(await settle(update(race, party, kind, s, s.jean, { description: 'Description from Jean' })), 'Jean, no base');
    await race.seedWith((runner) => runner.query(`UPDATE ${ITEM_TABLE[kind]} SET notes = 'From a script' WHERE id = $1`, [s.itemId]));
    const lastUpdate = new Date((await line(race, kind, s.itemId)).updated_at).toISOString();

    const [conflict] = editConflictOf(
      await settle(update(race, party, kind, s, s.marie, { notes: 'Again', base: { notes: 'Notes from Marie' } })),
      'Marie, whose notes a script replaced',
    ).conflicts;
    assert.equal(conflict.current, 'From a script');
    assert.equal(conflict.changed_by, null, 'nobody named: Jean, the line\'s last editor, never touched the notes');
    assert.equal(conflict.changed_at, lastUpdate, 'the line\'s last update');

    // The supplier is deleted: an OPEX line's supplier becomes empty (ON DELETE SET NULL), with no
    // audit row of the line. (A CAPEX line has no foreign key there: it keeps the deleted id.)
    if (kind === 'opex') {
      await race.seedWith((runner) => runner.query(`DELETE FROM suppliers WHERE id = $1`, [s.oldSupplier]));
      assert.equal((await line(race, kind, s.itemId)).supplier_id, null, 'ON DELETE SET NULL');
      const [emptied] = editConflictOf(
        await settle(update(race, party, kind, s, s.jean, { supplier_id: s.newSupplier, base: { supplier_id: s.oldSupplier } })),
        'Jean, whose supplier was deleted',
      ).conflicts;
      assert.equal(emptied.field, 'supplier_id');
      assert.equal(emptied.current, null);
      assert.deepEqual(emptied.labels, { base: null, current: null, mine: 'New supplier' }, 'the deleted supplier has no name left');
      assert.equal(emptied.changed_by, null, 'nobody named for a delete elsewhere');
      assert.equal(emptied.changed_at, lastUpdate);
    }

    assertSucceeded(await settle(update(race, party, kind, s, s.marie, { notes: 'Without base' })), 'no base: as before');
    assert.equal((await line(race, kind, s.itemId)).notes, 'Without base');
  });
}

/**
 * The author is the latest audit row that changed the field, however many
 * later rows of the line changed other fields only (one indexed lookup).
 */
async function authorBehindOtherChanges(kind: Kind) {
  await withRace(`${kind}-edit-author-depth`, async (race) => {
    const s = await setup(race, kind);
    const party = await race.open('A');
    assertSucceeded(await settle(update(race, party, kind, s, s.marie, { notes: 'Notes from Marie', base: { notes: 'Start' } })), 'Marie, notes');
    const marieRow = await race.readOne(
      `SELECT created_at FROM audit_log WHERE tenant_id = $1 AND record_id = $2 AND user_id = $3 AND action = 'update' ORDER BY created_at DESC LIMIT 1`,
      [race.tenantId, s.itemId, s.marie],
    );
    // 2,000 later audit rows of the line by Jean, each changing the description only.
    await race.seedWith((runner) => runner.query(
      `INSERT INTO audit_log (tenant_id, table_name, record_id, action, before_json, after_json, user_id, created_at)
       SELECT $1, $2, $3, 'update',
              jsonb_build_object('notes', 'Notes from Marie', 'description', 'd' || g),
              jsonb_build_object('notes', 'Notes from Marie', 'description', 'd' || (g + 1)),
              $4, clock_timestamp() + (g || ' ms')::interval
         FROM generate_series(1, 2000) g`,
      [race.tenantId, ITEM_TABLE[kind], s.itemId, s.jean],
    ));
    const [conflict] = editConflictOf(
      await settle(update(race, party, kind, s, s.jean, { notes: 'Notes from Jean', base: { notes: 'Start' } })),
      'Jean, from the first notes',
    ).conflicts;
    assert.deepEqual(conflict.changed_by, { id: s.marie, name: 'Marie Dupont' }, 'Marie, behind 2,000 changes of the description');
    assert.equal(conflict.changed_at, new Date(marieRow.created_at).toISOString());
  });
}

/**
 * A request is checked before it is compared: a field the server refuses
 * (the paying company cleared) answers 400 even when another field of the
 * same request conflicts, and nothing is written. The workspace therefore
 * never sends an edit waiting for a choice with another field (lot 3C
 * review): a refusal of the other field would drop it.
 */
async function refusalBeforeConflict(kind: Kind) {
  await withRace(`${kind}-edit-refused-first`, async (race) => {
    const s = await setup(race, kind);
    const party = await race.open('A');
    assertSucceeded(await settle(update(race, party, kind, s, s.marie, { notes: 'Notes from Marie', base: { notes: 'Start' } })), 'Marie, notes');
    const refused = refusalOf(await settle(update(race, party, kind, s, s.jean, {
      notes: 'Notes from Jean', paying_company_id: null, base: { notes: 'Start', paying_company_id: s.companyId },
    })), 'Jean, stale notes and no company');
    assert.equal(refused.status, 400, refused.message);
    assert.match(refused.message, /Paying company is required/);
    const stored = await line(race, kind, s.itemId);
    assert.equal(stored.notes, 'Notes from Marie', 'nothing written');
    assert.equal(stored.paying_company_id, s.companyId);
  });
}

export function itemEditConflictRaceTests(kind: Kind): Array<[string, () => Promise<void>]> {
  const label = kind === 'opex' ? 'OPEX' : 'CAPEX';
  return [
    [`${label} Annexe A #1: the same field edited by two people, the second gets 409 with who and when (3C)`, () => sameFieldConflict(kind)],
    [`${label} D2: two fields edited at the same moment are both saved (3C)`, () => differentFieldsMerge(kind)],
    [`${label} the same value on both sides is no conflict (3C)`, () => sameValueNoConflict(kind)],
    [`${label} an id field conflict names the values (3C)`, () => referenceConflictLabels(kind)],
    [`${label} analytics values conflict per dimension (3C)`, () => analyticsPerDimension(kind)],
    [`${label} null, id, date and instant equality edges (3C)`, () => equalityEdges(kind)],
    [`${label} author fallback and requests without base (3C)`, () => authorFallbackAndNoBase(kind)],
    [`${label} the author is found behind many changes of other fields (3C review)`, () => authorBehindOtherChanges(kind)],
    [`${label} a refused field answers 400 before any conflict, nothing written (3C review)`, () => refusalBeforeConflict(kind)],
  ];
}
