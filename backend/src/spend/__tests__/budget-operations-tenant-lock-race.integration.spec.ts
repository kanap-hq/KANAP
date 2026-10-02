import { BUDGET_ROWS_HEADERS, BudgetRowsCsvService } from '../budget-rows-csv.service';
import { copyAllocations } from '../budget-allocation-operations';
import { clearBudgetColumn, copyBudgetColumn } from '../budget-column-operations';
import { BUDGET_OPERATION_RUNNING } from '../budget-locks';
import { csvService, seedCompany } from './cost-center.fixtures';
import { captureAudit, noFreeze, repeat, seedLine } from './round-inputs.fixtures';
import {
  assert,
  assertSucceeded,
  createRaceTenant,
  describe,
  dropRaceTenant,
  httpStatus,
  inRequest,
  Outcome,
  progress,
  runRaceSpecs,
  settle,
  withRace,
} from './race-harness';

// The tenant lock of the bulk budget operations (plan planning/perf-scale,
// lot 3B, moved from 3F): the column copy and clear, the allocation copy, the
// item CSV imports, the budget rows import and a freeze or unfreeze that pins
// or unpins FX rates (`budget-freeze-race.integration.spec.ts`) share one
// transaction advisory lock per tenant. While one runs, another is refused at
// once with a 409 (code `operation_running`, never the `retry` a client sends
// again at once) that says what runs; a dry run takes no lock; another tenant
// is never held up.

const YEAR = 2026;

const copyColumn = (manager: any, dryRun = false) => copyBudgetColumn(
  { manager, audit: captureAudit() as any, freeze: noFreeze },
  'opex',
  { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR, destinationColumn: 'revision', percentageIncrease: 0, overwrite: true, dryRun },
  null,
);

const months = (value: string) => Object.fromEntries(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].map((m) => [m, value]));

function budgetRowsFile(itemNumber: number) {
  const row: Record<string, string> = { item_type: 'opex', item_number: String(itemNumber), year: String(YEAR), measure: 'forecast', period_start: '', period_end: '', method: '', ...months('10') };
  return { buffer: Buffer.from(`﻿${BUDGET_ROWS_HEADERS.join(';')}\n${BUDGET_ROWS_HEADERS.map((h) => row[h] ?? '').join(';')}\n`, 'utf8') } as any;
}

function itemFile(kind: 'opex' | 'capex') {
  const csv = csvService(kind);
  const headers: string[] = csv.csvHeaders();
  const row: Record<string, string> = kind === 'opex'
    ? { product_name: 'Imported line', company_name: 'Race company', account_number: '6000', currency: 'EUR', status: 'enabled' }
    : { description: 'Imported CAPEX line', ppe_type: 'hardware', investment_type: 'replacement', priority: 'medium', company_name: 'Race company', currency: 'EUR', status: 'enabled' };
  return { csv, file: { buffer: Buffer.from(`${headers.join(';')}\n${headers.map((h) => row[h] ?? '').join(';')}\n`, 'utf8') } as any };
}

/** Refused at once with a 409 `operation_running` that names the running operation. */
function assertRefused(outcome: Outcome, who: string) {
  assert.ok(!outcome.ok && httpStatus(outcome.error) === 409, `${who} must be refused with a 409 while a bulk operation runs; it ${describe(outcome)}`);
  const body = (outcome.error as any).getResponse?.();
  assert.equal(body?.code, 'operation_running', `${who}: code operation_running`);
  assert.equal(body?.message, BUDGET_OPERATION_RUNNING, `${who}: the message says what runs`);
}

async function secondOperationRefused() {
  await withRace('tenant-lock', async (race) => {
    const line = await race.seedWith(async (runner) => {
      await seedCompany(runner, race.tenantId, 'Race company', 6000);
      return seedLine(runner, 'opex', race.tenantId, YEAR, { planned: repeat('100', 12) }, 1);
    });
    const copier = await race.open('column copy');
    const other = await race.open('second operation');

    const copyHolds = race.gate(copier, { label: 'take the tenant lock', when: 'after', match: (text) => /pg_try_advisory_xact_lock/.test(text) });
    const copyWork = race.start(copier, (manager) => copyColumn(manager));
    assert.equal(await progress(copyWork, { party: copier, gate: copyHolds }), 'gated', 'harness: the copy must pause holding the tenant lock');

    const attempts: Array<[string, (manager: any) => Promise<unknown>]> = [
      ['a column clear', (manager) => clearBudgetColumn({ manager, audit: captureAudit() as any, freeze: noFreeze }, 'opex', { year: YEAR, column: 'forecast' }, null)],
      ['a second column copy', (manager) => copyColumn(manager)],
      ['an allocation copy', (manager) => copyAllocations(
        { manager, audit: captureAudit() as any, calculator: { computeForVersions: async () => new Map() } },
        'opex', { sourceYear: YEAR, destinationYear: YEAR + 1, overwrite: true }, null,
      )],
      ['a budget rows import', (manager) => new BudgetRowsCsvService(captureAudit() as any, noFreeze as any).importCsv(
        { file: budgetRowsFile(1), dryRun: false, userId: null, access: { isAdmin: true, permissions: {} } },
        { manager, tenantId: race.tenantId },
      )],
      ['an OPEX line import', (manager) => { const { csv, file } = itemFile('opex'); return csv.importCsv({ file, dryRun: false, userId: null }, { manager }); }],
      ['a CAPEX line import', (manager) => { const { csv, file } = itemFile('capex'); return csv.importCsv({ file, dryRun: false, userId: null }, { manager }); }],
    ];
    for (const [who, attempt] of attempts) {
      const work = race.start(other, attempt);
      assert.equal(await progress(work, { party: other }), 'settled', `${who} does not wait for the copy`);
      assertRefused(await settle(work), who);
    }

    // A dry run takes no lock: it reads and decides only.
    const dryRows = await settle(race.start(other, (manager) => new BudgetRowsCsvService(captureAudit() as any, noFreeze as any).importCsv(
      { file: budgetRowsFile(1), dryRun: true, userId: null, access: { isAdmin: true, permissions: {} } },
      { manager, tenantId: race.tenantId },
    )));
    assertSucceeded(dryRows, 'a budget rows dry run');
    assertSucceeded(await settle(race.start(other, (manager) => copyColumn(manager, true))), 'a column copy dry run');

    copyHolds.release();
    assertSucceeded(await settle(copyWork), 'the copy');
    // The lock goes with the copy's transaction.
    assertSucceeded(await settle(race.start(other, (manager) => clearBudgetColumn(
      { manager, audit: captureAudit() as any, freeze: noFreeze }, 'opex', { year: YEAR, column: 'revision' }, null,
    ))), 'a clear once the copy is done');
    const [row] = await race.read(`SELECT sum(committed)::text AS revision FROM spend_amounts WHERE version_id = $1`, [line.versionId]);
    assert.equal(Number(row.revision), 0, 'the clear ran after the copy');
  });
}

/** The lock is per tenant: another tenant's copy is not held up. */
async function otherTenantNotHeld() {
  await withRace('tenant-lock-a', async (race) => {
    await race.seedWith((runner) => seedLine(runner, 'opex', race.tenantId, YEAR, { planned: repeat('100', 12) }, 1));
    const otherTenant = await createRaceTenant('tenant-lock-b');
    try {
      const copier = await race.open('copy of tenant A');
      const otherParty = await race.open('copy of tenant B');
      const copyHolds = race.gate(copier, { label: 'take the tenant lock', when: 'after', match: (text) => /pg_try_advisory_xact_lock/.test(text) });
      const copyWork = race.start(copier, (manager) => copyColumn(manager));
      assert.equal(await progress(copyWork, { party: copier, gate: copyHolds }), 'gated', 'harness: the copy must pause holding the tenant lock');
      const otherWork = race.track(inRequest(otherParty, otherTenant, (manager) => copyColumn(manager)));
      assert.equal(await progress(otherWork, { party: otherParty }), 'settled', 'tenant B\'s copy does not wait for tenant A\'s');
      assertSucceeded(await settle(otherWork), 'tenant B\'s copy');
      copyHolds.release();
      assertSucceeded(await settle(copyWork), 'tenant A\'s copy');
    } finally {
      await dropRaceTenant(otherTenant);
    }
  });
}

void runRaceSpecs('Bulk budget operation tenant lock', [
  ['a second bulk budget operation of the tenant is refused at once with a 409 (3B)', secondOperationRefused],
  ['another tenant\'s bulk operation is not held up (3B)', otherTenantNotHeld],
]);
