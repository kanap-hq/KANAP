import 'dotenv/config';
// @throwaway-db-spec
import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { AccountsService } from '../accounts.service';
import { assert, describe, progress, Race, runRaceSpecs, settle, sql, withRace } from '../../spend/__tests__/race-harness';

// Two writes of one account at the same time, one naming units and the other clearing the
// "quantity and price entry" setting (`accounts_expected_units_check`: units only with it). Each
// write reads the account under its row lock, after the charts' lock, so it decides on the row the
// other one committed:
// - units, then the setting cleared (the page, or a CSV import): the second write clears the units
//   with the setting, as unticking the box does;
// - the setting cleared, then units (the page, or a CSV import first): the second write is refused
//   with the coded 400 that names the expected units, never a raw database error.
// Forced with a gate: the first write pauses right after its UPDATE, its transaction open, until
// the second one waits on its lock; each wait is bounded by the harness's deadline.

const SPEC = 'account-expected-units-race.integration.spec';

function service() {
  return new AccountsService(undefined as any, new AuditService(undefined as any));
}

function csv(lines: string[]): Express.Multer.File {
  return { buffer: Buffer.from(lines.join('\n') + '\n', 'utf8') } as Express.Multer.File;
}

async function seedAccount(race: Race): Promise<{ chartId: string; accountId: string }> {
  return race.seedWith(async (runner) => {
    const [chart] = await runner.query(
      `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'EU', 'Units race chart', 'FR') RETURNING id`,
      [race.tenantId],
    );
    const [account] = await runner.query(
      `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name, quantity_price_expected, expected_units)
       VALUES ($1, $2, 6100, 'Staff', true, NULL) RETURNING id`,
      [race.tenantId, chart.id],
    );
    return { chartId: chart.id, accountId: account.id };
  });
}

type Write = (manager: EntityManager, ids: { chartId: string; accountId: string }) => Promise<unknown>;

const nameUnits: Write = (manager, { accountId }) => service().update(accountId, { expected_units: ['days'] }, undefined, { manager });
const clearSetting: Write = (manager, { accountId }) => service().update(accountId, { quantity_price_expected: null }, undefined, { manager });
const importClearingSetting: Write = (manager, { chartId }) => service().importCsv(
  { file: csv(['account_number;account_name;quantity_price_expected', '6100;;no']), dryRun: false, language: 'en', mode: 'enrich' },
  { manager, targetCoaId: chartId },
).then((result) => {
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  return result;
});

/** `first` pauses after its UPDATE of the account; `second` runs meanwhile, then `first` commits. */
async function race(tag: string, first: Write, second: Write) {
  let outcome: Awaited<ReturnType<typeof settle>> | undefined;
  let row: any;
  await withRace(tag, async (r) => {
    const ids = await seedAccount(r);
    const a = await r.open('first');
    const b = await r.open('second');
    const gate = r.gate(a, { label: 'after its UPDATE of the account', when: 'after', match: sql.update('accounts') });
    const firstWork = r.start(a, (manager) => first(manager, ids));
    assert.equal(await progress(firstWork, { party: a, gate }), 'gated', 'the first write reaches its UPDATE');
    const secondWork = r.start(b, (manager) => second(manager, ids));
    assert.equal(await progress(secondWork, { party: b }), 'blocked', 'the second write waits on the first one');
    gate.release();
    const firstOutcome = await settle(firstWork);
    assert.ok(firstOutcome.ok, `the first write commits: ${describe(firstOutcome)}`);
    outcome = await settle(secondWork);
    row = await r.readOne(`SELECT quantity_price_expected AS expected, expected_units AS units FROM accounts WHERE id = $1`, [ids.accountId]);
  });
  return { outcome: outcome!, row };
}

function assertRefusedNamingUnits(outcome: Awaited<ReturnType<typeof settle>>) {
  assert.ok(!outcome.ok && outcome.error instanceof BadRequestException, `a coded 400, not ${describe(outcome)}`);
  const body: any = (outcome.error as BadRequestException).getResponse();
  assert.equal(body.code, 'ACCOUNT_EXPECTED_UNITS_WITHOUT_ENTRY');
  assert.equal(body.field, 'expected_units');
}

async function testUnitsThenClear() {
  const { outcome, row } = await race('units-clear', nameUnits, clearSetting);
  assert.ok(outcome.ok, `clearing the setting after units were named succeeds: ${describe(outcome)}`);
  assert.deepEqual(row, { expected: null, units: null }, 'the setting cleared takes the units with it');
}

async function testClearThenUnits() {
  const { outcome, row } = await race('clear-units', clearSetting, nameUnits);
  assertRefusedNamingUnits(outcome);
  assert.deepEqual(row, { expected: null, units: null }, 'the cleared setting stays, without units');
}

async function testUnitsThenImportClears() {
  const { outcome, row } = await race('units-import', nameUnits, importClearingSetting);
  assert.ok(outcome.ok, `an import clearing the setting after units were named succeeds: ${describe(outcome)}`);
  assert.deepEqual(row, { expected: null, units: null }, 'the import clears the units with the setting');
}

async function testImportClearsThenUnits() {
  const { outcome, row } = await race('import-units', importClearingSetting, nameUnits);
  assertRefusedNamingUnits(outcome);
  assert.deepEqual(row, { expected: null, units: null }, 'the setting the import cleared stays, without units');
}

void runRaceSpecs(SPEC, [
  ['units named, then the setting cleared: the units go with it', testUnitsThenClear],
  ['the setting cleared, then units named: a coded 400', testClearThenUnits],
  ['units named, then an import clears the setting: the units go with it', testUnitsThenImportClears],
  ['an import clears the setting, then units named: a coded 400', testImportClearsThenUnits],
]);
