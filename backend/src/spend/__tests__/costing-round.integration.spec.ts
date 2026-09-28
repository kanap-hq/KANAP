import 'dotenv/config';
import 'reflect-metadata';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { SpendVersionsController } from '../spend-versions.controller';
import { CapexVersionsController } from '../../capex/capex-versions.controller';
import { roundRecipe, upsertRoundInput, versionRoundInputs } from '../round-inputs.util';
import {
  amountsService,
  assert,
  budgetOperations,
  captureAudit,
  findVersion,
  FRANCE_218_2026,
  freezeColumn,
  inRolledBackTransaction,
  itemCsvImporter,
  Kind,
  period,
  readMeasure,
  readRecords,
  realFreeze,
  repeat,
  runSpecs,
  seedCalendar,
  seedItem,
  seedLine,
  seedTenant,
  setTenant,
} from './round-inputs.fixtures';

// Costed rounds through the amounts services (bulk-upsert `kind: 'computed'`
// and compute-preview), on OPEX and CAPEX: what is written, the recipe kept by
// hand edits, spreads and copies, the preview's comparisons, disabled and
// foreign calendars, against the database behind `dataSource`.

const YEAR = 2026;
const KINDS: Kind[] = ['opex', 'capex'];

const SFR_MONTHS = ['0.00', '7200.00', '8000.00', '8000.00', '6000.00', '8000.00', '6000.00', '6400.00', '8000.00', '7600.00', '0.00', '0.00'];

type Ctx = { runner: QueryRunner; tenantId: string; versionId: string; itemId: string; calendarId: string };

async function withCalendarLine(kind: Kind, fn: (ctx: Ctx) => Promise<void>, values: Parameters<typeof seedLine>[4] = {}) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-cost`);
    const calendarId = await seedCalendar(runner, tenantId, { code: 'FR218', name: 'France 218', days_by_year: { [YEAR]: FRANCE_218_2026 } });
    const { itemId, versionId } = await seedLine(runner, kind, tenantId, YEAR, values);
    await fn({ runner, tenantId, versionId, itemId, calendarId });
  });
}

/** The SFR row: February to October, per day, quantity 1, 400 a day, counts as FTE. */
function sfrPayload(calendarId: string, overrides: Record<string, unknown> = {}) {
  return {
    kind: 'computed',
    year: YEAR,
    measure: 'planned',
    period_start: `${YEAR}-02-01`,
    period_end: `${YEAR}-10-30`,
    pricing_basis: 'per_day',
    quantity: '1',
    unit_price: '400',
    price_index_pct: '0',
    working_day_profile_id: calendarId,
    counts_as_fte: true,
    ...overrides,
  };
}

const roundAudits = (audit: ReturnType<typeof captureAudit>) => audit.entries.filter((e) => e.table.endsWith('_round_inputs'));

/** The item + year preview route's body: the computed payload with the item instead of a version. */
const previewBody = (itemId: string, payload: Record<string, unknown>) => ({ ...payload, item_id: itemId });

/** A computation writes its column's twelve months, keeps the other columns, and stores the recipe and what it used. */
async function testComputedWrite(kind: Kind) {
  await withCalendarLine(kind, async ({ runner, versionId, calendarId }) => {
    const audit = captureAudit();
    const svc = amountsService(kind, audit);
    const response = await svc.bulkUpsert(versionId, sfrPayload(calendarId), null, { manager: runner.manager });
    assert.equal(response.updated, 12, `${kind}: twelve months written`);
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'planned', YEAR), SFR_MONTHS, `${kind}: February 7 200 … October 7 600`);
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'committed', YEAR), repeat('6.00', 12), `${kind}: other columns untouched`);

    const { planned } = await readRecords(runner, kind, versionId);
    assert.deepEqual(
      [planned.method, planned.period_start, planned.period_end, planned.spread_profile_name],
      ['computed', `${YEAR}-02-01`, `${YEAR}-10-30`, null],
    );
    assert.deepEqual(
      [planned.pricing_basis, planned.quantity, planned.unit_price, planned.price_index_pct, planned.working_day_profile_id, planned.counts_as_fte],
      ['per_day', '1.000', '400.0000', '0.0000', calendarId, true],
      `${kind}: the recipe in its columns`,
    );
    assert.deepEqual(planned.last_calculation, {
      kind: 'computed',
      pricing_basis: 'per_day',
      quantity: '1',
      unit_price: '400',
      price_index_pct: '0',
      working_day_profile_code: 'FR218',
      working_day_profile_name: 'France 218',
      active_months: [2, 3, 4, 5, 6, 7, 8, 9, 10],
      day_counts: FRANCE_218_2026,
      total_days: '163',
      month_amounts: SFR_MONTHS,
      total: '65200.00',
      counts_as_fte: true,
    }, `${kind}: the explanation carries the day counts used`);

    const { updated_at, ...returned } = response.round_inputs[0];
    assert.deepEqual(returned, {
      measure: 'planned',
      period_start: `${YEAR}-02-01`,
      period_end: `${YEAR}-10-30`,
      method: 'computed',
      spread_profile_name: null,
      last_calculation: planned.last_calculation,
      pricing_basis: 'per_day',
      quantity: '1',
      unit_price: '400',
      price_index_pct: '0',
      working_day_profile_id: calendarId,
      working_day_profile_code: 'FR218',
      working_day_profile_name: 'France 218',
      counts_as_fte: true,
      updated_by: null,
    }, `${kind}: the API record, decimals without trailing zeros, calendar code and name`);
    assert.ok(!Number.isNaN(Date.parse(updated_at)));

    const amountsTable = kind === 'opex' ? 'spend_amounts' : 'capex_amounts';
    assert.equal(audit.entries.filter((e) => e.table === amountsTable).length, 1, `${kind}: the amounts are audited`);
    assert.deepEqual(roundAudits(audit).map((e) => [e.action, e.after?.method]), [['create', 'computed']], `${kind}: the record is audited`);
  }, { committed: repeat('6', 12) });
}

/** Actuals are computed like any column; a per-month line over the year. */
async function testComputedActuals(kind: Kind) {
  await withCalendarLine(kind, async ({ runner, versionId }) => {
    const svc = amountsService(kind);
    await svc.bulkUpsert(
      versionId,
      { kind: 'computed', year: YEAR, measure: 'actual', pricing_basis: 'per_month', quantity: '10', unit_price: '200' },
      null,
      { manager: runner.manager },
    );
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'actual', YEAR), repeat('2000.00', 12));
    const { actual } = await readRecords(runner, kind, versionId);
    assert.deepEqual(
      [actual.method, actual.period_start, actual.period_end, actual.pricing_basis, actual.working_day_profile_id, actual.counts_as_fte],
      ['computed', `${YEAR}-01-01`, `${YEAR}-12-31`, 'per_month', null, false],
      `${kind}: without a period the whole year; FTE off by default`,
    );
    assert.deepEqual([actual.last_calculation.day_counts, actual.last_calculation.total_days, actual.last_calculation.total], [null, null, '24000.00']);
    // A hand edit of Actuals marks it manual and keeps the recipe, like any column.
    await svc.bulkUpsert(versionId, { kind: 'monthly', year: YEAR, months: [{ period: period(3, YEAR), actual: 1 }] }, null, { manager: runner.manager });
    const edited = (await readRecords(runner, kind, versionId)).actual;
    assert.deepEqual([edited.method, edited.pricing_basis, edited.quantity], ['manual', 'per_month', '10.000']);
  });
}

/** A frozen column refuses the computation before anything is written. */
async function testComputedRespectsFreeze(kind: Kind) {
  await withCalendarLine(kind, async ({ runner, tenantId, versionId, itemId, calendarId }) => {
    await freezeColumn(runner, kind, tenantId, YEAR, 'budget');
    await assert.rejects(
      () => amountsService(kind, captureAudit(), realFreeze()).bulkUpsert(versionId, sfrPayload(calendarId), null, { manager: runner.manager }),
      (err: any) => err instanceof ForbiddenException && /is frozen/.test(err.message),
    );
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'planned', YEAR), repeat('0.00', 12), `${kind}: no month written`);
    assert.deepEqual(Object.keys(await readRecords(runner, kind, versionId)), [], `${kind}: no record written`);
    // The preview checks no freeze.
    const preview = await amountsService(kind, captureAudit(), realFreeze()).computePreview(previewBody(itemId, sfrPayload(calendarId)), { manager: runner.manager });
    assert.equal(preview.total, '65200.00');
  });
}

/** D9: a hand edit, a spread, the legacy item CSV and the recipe survive; only a computation sets it. */
async function testRecipeSurvivesOtherWrites(kind: Kind) {
  await withCalendarLine(kind, async ({ runner, tenantId, versionId, calendarId }) => {
    const svc = amountsService(kind);
    await svc.bulkUpsert(versionId, sfrPayload(calendarId), null, { manager: runner.manager });
    const computed = (await readRecords(runner, kind, versionId)).planned;
    const recipeOf = (r: typeof computed) => [r.pricing_basis, r.quantity, r.unit_price, r.price_index_pct, r.working_day_profile_id, r.counts_as_fte];

    // Hand edit of March: manual, period, explanation and recipe kept.
    await svc.bulkUpsert(versionId, { kind: 'monthly', year: YEAR, months: [{ period: period(3, YEAR), planned: 1 }] }, null, { manager: runner.manager });
    const manual = (await readRecords(runner, kind, versionId)).planned;
    assert.equal(manual.method, 'manual', `${kind}: edited by hand`);
    assert.deepEqual([manual.period_start, manual.period_end], [computed.period_start, computed.period_end]);
    assert.deepEqual(manual.last_calculation, computed.last_calculation, `${kind}: the explanation is kept`);
    assert.deepEqual(recipeOf(manual), recipeOf(computed), `${kind}: the recipe is kept by a hand edit`);

    // A spread over the column: spread, recipe kept.
    await svc.bulkUpsert(versionId, { kind: 'annual', year: YEAR, totals: { planned: 1200 }, period_start: `${YEAR}-01-01`, period_end: `${YEAR}-06-30` }, null, { manager: runner.manager });
    const spread = (await readRecords(runner, kind, versionId)).planned;
    assert.deepEqual([spread.method, spread.last_calculation.kind], ['spread', 'annual']);
    assert.deepEqual(recipeOf(spread), recipeOf(computed), `${kind}: the recipe is kept by a spread`);

    // A quarterly spread, then the legacy item CSV: still kept.
    await svc.bulkUpsert(versionId, { kind: 'quarterly', year: YEAR, measure: 'planned', Q1: 30 }, null, { manager: runner.manager });
    assert.deepEqual(recipeOf((await readRecords(runner, kind, versionId)).planned), recipeOf(computed), `${kind}: kept by a quarterly spread`);
    await itemCsvImporter(kind).writeImportedTotals(runner.manager, { id: versionId, tenant_id: tenantId, budget_year: YEAR }, YEAR, { planned: 2400 });
    const csv = (await readRecords(runner, kind, versionId)).planned;
    assert.deepEqual([csv.method, csv.last_calculation.source], ['spread', 'item_csv']);
    assert.deepEqual(recipeOf(csv), recipeOf(computed), `${kind}: kept by the item CSV`);

    // Recompute: computed again from the stored recipe, months back to the SFR vector.
    await svc.bulkUpsert(versionId, sfrPayload(calendarId), null, { manager: runner.manager });
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'planned', YEAR), SFR_MONTHS);
    assert.equal((await readRecords(runner, kind, versionId)).planned.method, 'computed');
  });
}

/** An identical resubmit writes no record; a difference in the recipe alone is written. */
async function testNoOpAndRecipeOnlyChange(kind: Kind) {
  await withCalendarLine(kind, async ({ runner, tenantId, versionId, calendarId }) => {
    const audit = captureAudit();
    const svc = amountsService(kind, audit);
    await svc.bulkUpsert(versionId, sfrPayload(calendarId), null, { manager: runner.manager });
    const first = (await readRecords(runner, kind, versionId)).planned;
    await svc.bulkUpsert(versionId, sfrPayload(calendarId, { quantity: '1.000', unit_price: 400 }), null, { manager: runner.manager });
    const again = (await readRecords(runner, kind, versionId)).planned;
    assert.equal(again.updated_at.getTime(), first.updated_at.getTime(), `${kind}: an identical computation writes no record`);
    assert.equal(roundAudits(audit).length, 1, `${kind}: and audits none`);

    // Same period, method, profile and explanation; only counts_as_fte differs in the recipe.
    const version = { id: versionId, tenant_id: tenantId, budget_year: YEAR };
    const [stored] = await versionRoundInputs(runner.manager, kind, version);
    const recipe = roundRecipe(stored)!;
    const rctx = { manager: runner.manager, scope: kind, version, userId: null, audit };
    const saved = await upsertRoundInput(rctx, 'planned', {
      period_start: stored.period_start,
      period_end: stored.period_end,
      method: stored.method,
      spread_profile_name: stored.spread_profile_name,
      last_calculation: stored.last_calculation,
      recipe: { ...recipe, counts_as_fte: false },
    });
    assert.equal(saved!.counts_as_fte, false, `${kind}: a recipe-only change is written`);
    assert.equal(roundAudits(audit).length, 2);
    // The recipe is checked against the column limits on every write, whoever builds it.
    await assert.rejects(
      () => upsertRoundInput(rctx, 'planned', { ...stored, recipe: { ...recipe, quantity: '1.0001' } }),
      (err: any) => err instanceof BadRequestException && err.message === 'Quantity accepts at most 3 decimals.',
    );
  });
}

/** Refusals are readable 400s and write nothing. */
async function testComputedRefusals(kind: Kind) {
  await withCalendarLine(kind, async ({ runner, versionId, itemId, calendarId }) => {
    const svc = amountsService(kind);
    const refused = async (overrides: Record<string, unknown>, message: string | RegExp) => {
      const calls = [
        (body: Record<string, unknown>) => svc.bulkUpsert(versionId, body, null, { manager: runner.manager }),
        (body: Record<string, unknown>) => svc.computePreview(previewBody(itemId, body), { manager: runner.manager }),
      ];
      for (const call of calls) {
        await assert.rejects(
          () => call(sfrPayload(calendarId, overrides)),
          (err: any) => err instanceof BadRequestException && (typeof message === 'string' ? err.message === message : message.test(err.message)),
          `${kind}: ${String(message)}`,
        );
      }
    };
    await refused({ quantity: '1.0001' }, 'Quantity accepts at most 3 decimals.');
    await refused({ quantity: '-1' }, 'Quantity cannot be negative.');
    await refused({ unit_price: '400.00001' }, 'Unit price accepts at most 4 decimals.');
    await refused({ price_index_pct: '-101' }, 'The price index cannot be below -100%.');
    await refused({ working_day_profile_id: null }, 'Choose a working-day calendar for a price per day.');
    await refused({ pricing_basis: 'per_month' }, 'A calendar is used only with a price per day.');
    await refused({ working_day_profile_id: '6f1c1b1e-0000-4000-8000-000000000000' }, 'The calendar was not found.');
    await refused({ working_day_profile_id: 'not-a-uuid' }, 'The calendar was not found.');
    // The version's route checks the year against the version; the preview reads the year it is given.
    await assert.rejects(
      () => svc.bulkUpsert(versionId, sfrPayload(calendarId, { year: YEAR + 1 }), null, { manager: runner.manager }),
      (err: any) => err instanceof BadRequestException && err.message === `The year ${YEAR + 1} does not match this version's year ${YEAR}.`,
    );
    await refused({ measure: 'budget' }, /^Unknown amount 'budget'\./);
    await refused({ period_end: undefined }, 'Send both period_start and period_end, or neither for the whole year.');
    await refused({ period_start: `${YEAR}-02-16`, period_end: `${YEAR}-03-14` }, /^No month of the period counts/);
    await refused({ pricing_basis: 'weekly' }, "Unknown pricing basis 'weekly'. Use per_day, per_month, per_period.");
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'planned', YEAR), repeat('0.00', 12), `${kind}: nothing written`);
    assert.deepEqual(Object.keys(await readRecords(runner, kind, versionId)), [], `${kind}: no record written`);
  });
}

/** The preview writes nothing; after a calendar edit it lists the months whose days and amounts changed. */
async function testPreviewAfterCalendarEdit(kind: Kind) {
  await withCalendarLine(kind, async ({ runner, versionId, itemId, calendarId }) => {
    const svc = amountsService(kind);
    const preview = (payload: Record<string, unknown>) => svc.computePreview(previewBody(itemId, payload), { manager: runner.manager });
    const fresh = await preview(sfrPayload(calendarId));
    assert.deepEqual(fresh, {
      active_months: [2, 3, 4, 5, 6, 7, 8, 9, 10],
      day_counts: FRANCE_218_2026,
      total_days: '163',
      month_amounts: SFR_MONTHS,
      total: '65200.00',
      fte: '0.75',
      calendar: { id: calendarId, code: 'FR218', name: 'France 218', disabled: false },
      stored: { month_amounts: repeat('0.00', 12), method: null, last_calculation: null },
      changed_months: [2, 3, 4, 5, 6, 7, 8, 9, 10],
      calendar_changed_months: [],
      warnings: [],
    }, `${kind}: the live line`);
    assert.deepEqual(Object.keys(await readRecords(runner, kind, versionId)), [], `${kind}: the preview writes no record`);
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'planned', YEAR), repeat('0.00', 12), `${kind}: nor months`);

    await svc.bulkUpsert(versionId, sfrPayload(calendarId), null, { manager: runner.manager });
    const explanation = (await readRecords(runner, kind, versionId)).planned.last_calculation;
    const same = await preview(sfrPayload(calendarId));
    assert.deepEqual([same.changed_months, same.calendar_changed_months, same.stored.method], [[], [], 'computed']);

    // March 2026 goes from 20 to 19 days: the stored explanation and amounts do not move.
    const days = [...FRANCE_218_2026];
    days[2] = '19';
    await runner.query(`UPDATE working_day_profiles SET days_by_year = $2::jsonb WHERE id = $1`, [calendarId, JSON.stringify({ [YEAR]: days })]);
    assert.deepEqual((await readRecords(runner, kind, versionId)).planned.last_calculation, explanation, `${kind}: explanation unchanged`);
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'planned', YEAR), SFR_MONTHS, `${kind}: amounts unchanged`);
    const after = await preview(sfrPayload(calendarId));
    assert.deepEqual(
      [after.changed_months, after.calendar_changed_months, after.month_amounts[2], after.stored.month_amounts[2], after.total_days],
      [[3], [3], '7600.00', '8000.00', '162'],
      `${kind}: Recompute shows the difference`,
    );
    assert.deepEqual(after.stored.last_calculation.day_counts[2], '20', `${kind}: what the last computation used`);
    // A day change outside the period is no difference.
    days[11] = '18';
    await runner.query(`UPDATE working_day_profiles SET days_by_year = $2::jsonb WHERE id = $1`, [calendarId, JSON.stringify({ [YEAR]: days })]);
    assert.deepEqual((await preview(sfrPayload(calendarId))).calendar_changed_months, [3]);
  });
}

/** A disabled calendar cannot be newly assigned; the round that uses it recomputes with a warning. */
async function testDisabledCalendar(kind: Kind) {
  await withCalendarLine(kind, async ({ runner, tenantId, versionId, itemId, calendarId }) => {
    const svc = amountsService(kind);
    const retired = await seedCalendar(runner, tenantId, { code: 'OLD', name: 'Old calendar', days_by_year: { [YEAR]: FRANCE_218_2026 }, status: 'disabled' });
    for (const call of [
      () => svc.bulkUpsert(versionId, sfrPayload(retired), null, { manager: runner.manager }),
      () => svc.computePreview(previewBody(itemId, sfrPayload(retired)), { manager: runner.manager }),
    ]) {
      await assert.rejects(call, (err: any) => err instanceof BadRequestException && err.message === 'Old calendar is disabled. Pick an enabled calendar.');
    }
    assert.deepEqual(Object.keys(await readRecords(runner, kind, versionId)), [], `${kind}: nothing written`);

    await svc.bulkUpsert(versionId, sfrPayload(calendarId), null, { manager: runner.manager });
    await runner.query(`UPDATE working_day_profiles SET status = 'disabled', disabled_at = '2020-01-01T12:00:00Z' WHERE id = $1`, [calendarId]);
    const preview = await svc.computePreview(previewBody(itemId, sfrPayload(calendarId, { quantity: '2' })), { manager: runner.manager });
    assert.deepEqual([preview.calendar.disabled, preview.warnings], [true, ['This calendar is disabled. The computation still uses it.']]);
    await svc.bulkUpsert(versionId, sfrPayload(calendarId, { quantity: '2' }), null, { manager: runner.manager });
    assert.equal((await readMeasure(runner, kind, versionId, 'planned', YEAR))[1], '14400.00', `${kind}: the round that uses it recomputes`);
    // Another column of the same line did not use it: refused there.
    await assert.rejects(
      () => svc.bulkUpsert(versionId, sfrPayload(calendarId, { measure: 'committed' }), null, { manager: runner.manager }),
      (err: any) => err instanceof BadRequestException && err.message === 'France 218 is disabled. Pick an enabled calendar.',
    );
  });
}

/** Tenant B cannot compute with tenant A's calendar: not found, nothing written. */
async function testForeignCalendar(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantA = await seedTenant(runner, `${kind}-cal-a`);
    const calendarA = await seedCalendar(runner, tenantA, { code: 'FR218', name: 'France 218', days_by_year: { [YEAR]: FRANCE_218_2026 } });
    const tenantB = await seedTenant(runner, `${kind}-cal-b`);
    await setTenant(runner, tenantB);
    const { versionId, itemId } = await seedLine(runner, kind, tenantB, YEAR);
    const svc = amountsService(kind);
    for (const call of [
      () => svc.bulkUpsert(versionId, sfrPayload(calendarA), null, { manager: runner.manager }),
      () => svc.computePreview(previewBody(itemId, sfrPayload(calendarA)), { manager: runner.manager }),
    ]) {
      await assert.rejects(call, (err: any) => err instanceof BadRequestException && err.message === 'The calendar was not found.');
    }
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'planned', YEAR), repeat('0.00', 12), `${kind}: no month written`);
    assert.deepEqual(Object.keys(await readRecords(runner, kind, versionId)), [], `${kind}: no record written`);
  });
}

/** D12: a copy carries the recipe as it is (index never re-applied); recompute for the new year is explicit; clear deletes it. */
async function testCopyCarriesTheRecipe(kind: Kind) {
  await withCalendarLine(kind, async ({ runner, versionId, itemId, calendarId }) => {
    const svc = amountsService(kind);
    await svc.bulkUpsert(versionId, sfrPayload(calendarId, { price_index_pct: '2' }), null, { manager: runner.manager });
    const source = (await readRecords(runner, kind, versionId)).planned;
    await budgetOperations(kind).copyBudgetColumn(
      { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR + 1, destinationColumn: 'budget', percentageIncrease: '5', overwrite: false, dryRun: false },
      null,
      { manager: runner.manager },
    );
    const destination = await findVersion(runner, kind, itemId, YEAR + 1);
    const copied = (await readRecords(runner, kind, destination!.id)).planned;
    assert.deepEqual(
      [copied.method, copied.period_start, copied.period_end, copied.last_calculation.kind, copied.last_calculation.source_method, copied.last_calculation.uplift_pct],
      ['copied', `${YEAR + 1}-02-01`, `${YEAR + 1}-10-30`, 'copy', 'computed', '5'],
    );
    assert.deepEqual(
      [copied.pricing_basis, copied.quantity, copied.unit_price, copied.price_index_pct, copied.working_day_profile_id, copied.counts_as_fte],
      [source.pricing_basis, source.quantity, source.unit_price, '2.0000', calendarId, true],
      `${kind}: the recipe as it is, the index unchanged by the uplift`,
    );

    // Recompute for the new year: refused readably while the calendar has no days for it.
    const next = (overrides: Record<string, unknown> = {}) => sfrPayload(calendarId, {
      year: YEAR + 1, period_start: `${YEAR + 1}-02-01`, period_end: `${YEAR + 1}-10-30`, price_index_pct: '2', ...overrides,
    });
    await assert.rejects(
      () => svc.computePreview(previewBody(itemId, next()), { manager: runner.manager }),
      (err: any) => err instanceof BadRequestException
        && err.message === `France 218 has no working days for ${YEAR + 1}. Add them on the Working-day calendars page.`,
    );
    await runner.query(
      `UPDATE working_day_profiles SET days_by_year = $2::jsonb WHERE id = $1`,
      [calendarId, JSON.stringify({ [YEAR]: FRANCE_218_2026, [YEAR + 1]: FRANCE_218_2026 })],
    );
    await svc.bulkUpsert(destination!.id, next(), null, { manager: runner.manager });
    const recomputed = await readMeasure(runner, kind, destination!.id, 'planned', YEAR + 1);
    assert.deepEqual([recomputed[1], recomputed[9]], ['7344.00', '7752.00'], `${kind}: 408 a day over ${YEAR + 1}`);
    assert.equal((await readRecords(runner, kind, destination!.id)).planned.method, 'computed');

    // A copy replaces the whole destination column: a source without a recipe leaves none.
    await svc.bulkUpsert(versionId, { kind: 'monthly', year: YEAR, months: [{ period: period(1, YEAR), committed: 5 }] }, null, { manager: runner.manager });
    await budgetOperations(kind).copyBudgetColumn(
      { sourceYear: YEAR, sourceColumn: 'revision', destinationYear: YEAR + 1, destinationColumn: 'budget', percentageIncrease: 0, overwrite: true, dryRun: false },
      null,
      { manager: runner.manager },
    );
    const overwritten = (await readRecords(runner, kind, destination!.id)).planned;
    assert.deepEqual(
      [overwritten.method, overwritten.last_calculation.source_method,
        overwritten.pricing_basis, overwritten.quantity, overwritten.unit_price, overwritten.price_index_pct, overwritten.working_day_profile_id, overwritten.counts_as_fte],
      ['copied', 'manual', null, null, null, null, null, false],
      `${kind}: the destination loses its recipe`,
    );

    await budgetOperations(kind).clearBudgetColumn({ year: YEAR + 1, column: 'budget' }, null, { manager: runner.manager });
    assert.equal((await readRecords(runner, kind, destination!.id)).planned, undefined, `${kind}: clear deletes the record and its recipe`);
    // The source round still uses the calendar: deleting it is refused (RESTRICT).
    await runner.query('SAVEPOINT in_use');
    await assert.rejects(() => runner.query(`DELETE FROM working_day_profiles WHERE id = $1`, [calendarId]), /working_day_profile_fk/);
    await runner.query('ROLLBACK TO SAVEPOINT in_use');
  });
}

/** A preview of a year without a version: computed against nothing stored, and nothing is created (no version, round or month). */
async function testPreviewWithoutVersion(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-nover`);
    const calendarId = await seedCalendar(runner, tenantId, { code: 'FR218', name: 'France 218', days_by_year: { [YEAR]: FRANCE_218_2026 } });
    const itemId = await seedItem(runner, kind, tenantId);
    const preview = await amountsService(kind).computePreview(previewBody(itemId, sfrPayload(calendarId)), { manager: runner.manager });
    assert.deepEqual(preview, {
      active_months: [2, 3, 4, 5, 6, 7, 8, 9, 10],
      day_counts: FRANCE_218_2026,
      total_days: '163',
      month_amounts: SFR_MONTHS,
      total: '65200.00',
      fte: '0.75',
      calendar: { id: calendarId, code: 'FR218', name: 'France 218', disabled: false },
      stored: { month_amounts: repeat('0.00', 12), method: null, last_calculation: null },
      changed_months: [2, 3, 4, 5, 6, 7, 8, 9, 10],
      calendar_changed_months: [],
      warnings: [],
    }, `${kind}: the SFR vector against nothing stored`);
    assert.equal(await findVersion(runner, kind, itemId, YEAR), undefined, `${kind}: no version created`);
    const itemFk = kind === 'opex' ? 'spend_item_id' : 'capex_item_id';
    const [counts] = await runner.query(
      `SELECT (SELECT count(*)::int FROM ${kind === 'opex' ? 'spend_versions' : 'capex_versions'} WHERE ${itemFk} = $1) AS versions,
              (SELECT count(*)::int FROM ${kind === 'opex' ? 'spend_round_inputs' : 'capex_round_inputs'} WHERE tenant_id = $2) AS rounds,
              (SELECT count(*)::int FROM ${kind === 'opex' ? 'spend_amounts' : 'capex_amounts'} WHERE tenant_id = $2) AS amounts`,
      [itemId, tenantId],
    );
    assert.deepEqual(counts, { versions: 0, rounds: 0, amounts: 0 }, `${kind}: nothing written`);
    // Year and item are required; a year without calendar days is refused as on the version's route.
    await assert.rejects(
      () => amountsService(kind).computePreview(previewBody(itemId, sfrPayload(calendarId, { year: undefined })), { manager: runner.manager }),
      (err: any) => err instanceof BadRequestException && err.message === 'A budget year is required.',
    );
    await assert.rejects(
      () => amountsService(kind).computePreview(
        previewBody(itemId, sfrPayload(calendarId, { year: YEAR + 1, period_start: `${YEAR + 1}-02-01`, period_end: `${YEAR + 1}-10-30` })),
        { manager: runner.manager },
      ),
      (err: any) => err instanceof BadRequestException && err.message === `France 218 has no working days for ${YEAR + 1}. Add them on the Working-day calendars page.`,
    );
  });
}

/** Another tenant's item, an unknown item or a malformed id: 404, whatever the rest of the body. */
async function testPreviewForeignItem(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantA = await seedTenant(runner, `${kind}-item-a`);
    const { itemId: itemA } = await seedLine(runner, kind, tenantA, YEAR);
    const tenantB = await seedTenant(runner, `${kind}-item-b`);
    const calendarB = await seedCalendar(runner, tenantB, { code: 'FR218', name: 'France 218', days_by_year: { [YEAR]: FRANCE_218_2026 } });
    for (const item of [itemA, '6f1c1b1e-0000-4000-8000-000000000000', 'OPX-1', undefined]) {
      await assert.rejects(
        () => amountsService(kind).computePreview(previewBody(item as string, sfrPayload(calendarB)), { manager: runner.manager }),
        (err: any) => err instanceof NotFoundException && err.message === 'Item not found.',
        `${kind}: ${String(item)}`,
      );
    }
    await setTenant(runner, tenantA);
    assert.equal((await findVersion(runner, kind, itemA, YEAR + 1)), undefined);
  });
}

/**
 * D-N2: the computed write takes its calendar FOR KEY SHARE when it reads it,
 * before the months and the round, so a delete (FOR UPDATE) cannot count zero
 * rounds in between. The writer is held between the two (another transaction
 * holds the line's months) while the delete's lock is tried; the preview,
 * which writes nothing, takes no lock.
 */
async function testComputedWriteLocksItsCalendar() {
  const seed = dataSource.createQueryRunner();
  await seed.connect();
  await seed.startTransaction();
  const tenantId = await seedTenant(seed, 'cal-lock');
  const calendarId = await seedCalendar(seed, tenantId, { code: 'FR218', name: 'France 218', days_by_year: { [YEAR]: FRANCE_218_2026 } });
  const { itemId, versionId } = await seedLine(seed, 'opex', tenantId, YEAR, { committed: repeat('1', 12) });
  await seed.commitTransaction();
  await seed.release();

  const open = async () => {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    await setTenant(runner, tenantId);
    return runner;
  };
  const holder = await open();
  const writer = await open();
  const deleter = await open();
  // The delete's lock, tried without waiting; always rolled back, so the probe never holds it.
  const tryLock = async () => {
    await deleter.query('SAVEPOINT try_lock');
    try {
      await deleter.query(`SELECT id FROM working_day_profiles WHERE tenant_id = $1 AND id = $2 FOR UPDATE NOWAIT`, [tenantId, calendarId]);
      return 'free';
    } catch (err: any) {
      if (err?.code === '55P03' || err?.driverError?.code === '55P03') return 'held';
      throw err;
    } finally {
      await deleter.query('ROLLBACK TO SAVEPOINT try_lock');
    }
  };
  let write: Promise<unknown> | null = null;
  try {
    await amountsService('opex').computePreview(previewBody(itemId, sfrPayload(calendarId)), { manager: writer.manager });
    assert.equal(await tryLock(), 'free', 'the preview takes no lock');

    await holder.query(`SELECT id FROM spend_amounts WHERE tenant_id = $1 AND version_id = $2 FOR UPDATE`, [tenantId, versionId]);
    const [{ pid }] = await writer.query(`SELECT pg_backend_pid() AS pid`);
    write = amountsService('opex').bulkUpsert(versionId, sfrPayload(calendarId), null, { manager: writer.manager });
    write.catch(() => undefined);
    const deadline = Date.now() + 5000;
    for (;;) {
      const [row] = await dataSource.query(`SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`, [pid]);
      if (row?.wait_event_type === 'Lock') break;
      if (Date.now() > deadline) throw new Error('the computed write never waited for the months');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(await tryLock(), 'held', 'read, not yet written: the calendar is already held');
    await holder.rollbackTransaction();
    await write;
    assert.equal((await readRecords(writer, 'opex', versionId)).planned.method, 'computed');
    await writer.rollbackTransaction();
    assert.equal(await tryLock(), 'free', 'released with the transaction');
  } finally {
    for (const runner of [holder, writer, deleter]) {
      if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
    }
    await write?.catch(() => undefined);
    for (const runner of [holder, writer, deleter]) await runner.release();
    await dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      for (const table of ['spend_round_inputs', 'spend_amounts', 'spend_versions', 'spend_items', 'working_day_profiles']) {
        await manager.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
      }
    });
    await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  }
}

/** Both preview routes need member on their item type, like bulk-upsert. */
async function testPreviewRoutePermissions() {
  assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, SpendVersionsController.prototype.computePreview), { resource: 'opex', level: 'member' });
  assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, CapexVersionsController.prototype.computePreview), { resource: 'capex', level: 'member' });
  assert.equal(Reflect.getMetadata('path', SpendVersionsController.prototype.computePreview), 'spend-versions/compute-preview');
  assert.equal(Reflect.getMetadata('path', CapexVersionsController.prototype.computePreview), 'capex-versions/compute-preview');
  // The version-scoped preview routes are gone: one preview route per item type.
  for (const controller of [SpendVersionsController, CapexVersionsController]) {
    const paths = Object.getOwnPropertyNames(controller.prototype).map((name) => Reflect.getMetadata('path', (controller.prototype as any)[name]));
    assert.equal(paths.filter((path) => typeof path === 'string' && path.includes('compute-preview')).length, 1, `${controller.name}: one preview route`);
  }
}

void runSpecs('costing-round.integration.spec', [
  ['testPreviewRoutePermissions', testPreviewRoutePermissions],
  ['testComputedWriteLocksItsCalendar', testComputedWriteLocksItsCalendar],
  ...KINDS.flatMap((kind) => [
    [`testComputedWrite(${kind})`, () => testComputedWrite(kind)],
    [`testComputedActuals(${kind})`, () => testComputedActuals(kind)],
    [`testComputedRespectsFreeze(${kind})`, () => testComputedRespectsFreeze(kind)],
    [`testRecipeSurvivesOtherWrites(${kind})`, () => testRecipeSurvivesOtherWrites(kind)],
    [`testNoOpAndRecipeOnlyChange(${kind})`, () => testNoOpAndRecipeOnlyChange(kind)],
    [`testComputedRefusals(${kind})`, () => testComputedRefusals(kind)],
    [`testPreviewAfterCalendarEdit(${kind})`, () => testPreviewAfterCalendarEdit(kind)],
    [`testPreviewWithoutVersion(${kind})`, () => testPreviewWithoutVersion(kind)],
    [`testPreviewForeignItem(${kind})`, () => testPreviewForeignItem(kind)],
    [`testDisabledCalendar(${kind})`, () => testDisabledCalendar(kind)],
    [`testForeignCalendar(${kind})`, () => testForeignCalendar(kind)],
    [`testCopyCarriesTheRecipe(${kind})`, () => testCopyCarriesTheRecipe(kind)],
  ] as Array<[string, () => Promise<void>]>),
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
