import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AccountNature1853890000000 as Migration } from '../../migrations/1853890000000-account-nature';

// Migration 1853890000000 (the OPEX/CAPEX nature of accounts), against a real
// database, each test in a transaction that is rolled back. The database is put
// back in the state before the migration (down), then the column is added by
// hand so an account can already hold a nature (kept) or an invalid value
// (cleared). Two tenants:
// - tenant A, IFRS consolidation chart and a local chart: accounts used by
//   OPEX lines only (opex), by CAPEX lines only, a disabled line included
//   (capex), by both (left for both); unused IFRS accounts take the global IFRS
//   template's nature (empty for 1200); an unused local account mapped to an
//   IFRS account with a nature takes it, one mapped outside stays for both; an
//   account with a nature already set keeps it whatever its lines;
// - tenant B, non-IFRS consolidation chart: nothing from the template, a local
//   account mapped to it stays for both; a line of tenant A pointing at an
//   account of tenant B does not count for tenant B;
// - a template edited by hand (quotes, separators in a cell, CRLF, no BOM)
//   keeps every cell and gets the nature column appended;
// - updated_at untouched, no audit line, row level security as found, a
//   second run changes nothing, down() strips the column from the templates.
// The assertions read this test's own rows, never table-wide counts.

const migration = new Migration();
const LOG_PREFIX = '[Migration] AccountNature:';
const UPDATED = '2026-01-01T00:00:00.000Z';
const TABLES = ['accounts', 'search_index', 'chart_of_accounts', 'spend_items', 'capex_items'];

/** A template written by hand in the platform admin: CRLF, no BOM, quoted cells. */
const HAND_EDITED = [
  'account_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status',
  '601;"Servers; racks";;"The ""big"" ones";1010;Tangible;;enabled',
  '602;Licences;Licences;Edited by hand;2500;Staff;;disabled',
  '603;Other;;;3000;;;enabled',
  '604;No group;;;;;;enabled',
].join('\r\n') + '\r\n';
const HAND_EDITED_WITH_NATURE = [
  'account_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status;nature',
  '601;"Servers; racks";;"The ""big"" ones";1010;Tangible;;enabled;capex',
  '602;Licences;Licences;Edited by hand;2500;Staff;;disabled;opex',
  '603;Other;;;3000;;;enabled;',
  '604;No group;;;;;;enabled;',
].join('\r\n') + '\r\n';

async function inRolledBackTransaction(fn: (runner: QueryRunner) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await fn(runner);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function captureLog<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: any[]) => { lines.push(args.map(String).join(' ')); };
  try {
    return { result: await fn(), lines };
  } finally {
    console.log = original;
  }
}

async function asTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function noTenant(runner: QueryRunner) {
  await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
}

async function seedTenant(runner: QueryRunner, tag: string) {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `nature-${tag}-${tenantId.slice(0, 8)}`, `Account nature ${tag}`],
  );
  return tenantId;
}

async function seedChart(runner: QueryRunner, tenantId: string, code: string, consolidation: boolean): Promise<string> {
  await asTenant(runner, tenantId);
  const [row] = await runner.query(
    `INSERT INTO chart_of_accounts (tenant_id, code, name, scope, country_iso, is_consolidation)
     VALUES ($1, $2, $2, $3, $4, $5) RETURNING id`,
    [tenantId, code, consolidation ? 'GLOBAL' : 'COUNTRY', consolidation ? null : 'FR', consolidation],
  );
  return row.id;
}

async function seedAccount(
  runner: QueryRunner,
  tenantId: string,
  coaId: string,
  number: number,
  options: { cons?: number | null; nature?: string | null } = {},
): Promise<string> {
  await asTenant(runner, tenantId);
  const [row] = await runner.query(
    `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name, consolidation_account_number, nature, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [tenantId, coaId, number, `Account ${number}`, options.cons ?? null, options.nature ?? null, UPDATED],
  );
  return row.id;
}

let itemNumber = 0;

async function seedLine(runner: QueryRunner, tenantId: string, kind: 'opex' | 'capex', accountId: string, disabled = false) {
  await asTenant(runner, tenantId);
  itemNumber += 1;
  if (kind === 'opex') {
    await runner.query(
      `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, account_id, disabled_at)
       VALUES ($1, 'Nature line', 'EUR', '2026-01-01', $2, $3, $4)`,
      [tenantId, 900000 + itemNumber, accountId, disabled ? '2020-01-01T00:00:00Z' : null],
    );
  } else {
    await runner.query(
      `INSERT INTO capex_items (tenant_id, description, ppe_type, investment_type, priority, currency, effective_start, item_number, account_id, disabled_at)
       VALUES ($1, 'Nature line', 'hardware', 'replacement', 'medium', 'EUR', '2026-01-01', $2, $3, $4)`,
      [tenantId, 900000 + itemNumber, accountId, disabled ? '2020-01-01T00:00:00Z' : null],
    );
  }
}

type Accounts = Record<
  | 'ifrsCapex' | 'ifrsOpex' | 'ifrsEmpty'
  | 'opexOnly' | 'capexOnly' | 'both' | 'mappedToIfrs' | 'mappedOutside' | 'preset' | 'invalid'
  | 'groupAccount' | 'mappedToGroup' | 'usedFromOtherTenant',
  { tenantId: string; id: string }
>;

/** The database before the migration, plus the column, then the two tenants, their accounts and lines. */
async function seedBeforeMigration(runner: QueryRunner): Promise<{ accounts: Accounts; tenants: string[]; templateId: string }> {
  await migration.down(runner);
  await runner.query(`ALTER TABLE accounts ADD COLUMN nature text`);
  const accounts = {} as Accounts;

  const a = await seedTenant(runner, 'a');
  const ifrs = await seedChart(runner, a, 'ifrs', true);
  const local = await seedChart(runner, a, 'FR-PCG', false);
  const put = async (key: keyof Accounts, tenantId: string, coaId: string, number: number, options?: { cons?: number | null; nature?: string | null }) => {
    accounts[key] = { tenantId, id: await seedAccount(runner, tenantId, coaId, number, options) };
  };
  await put('ifrsCapex', a, ifrs, 1000);
  await put('ifrsOpex', a, ifrs, 2000);
  await put('ifrsEmpty', a, ifrs, 1200);
  await put('opexOnly', a, local, 600, { cons: 9999 });
  await put('capexOnly', a, local, 601, { cons: 2000 });
  await put('both', a, local, 602, { cons: 1000 });
  await put('mappedToIfrs', a, local, 603, { cons: 1000 });
  await put('mappedOutside', a, local, 604, { cons: 9999 });
  await put('preset', a, local, 605, { cons: 1000, nature: 'opex' });
  await put('invalid', a, local, 606, { cons: 9999, nature: 'OPEX' });
  await seedLine(runner, a, 'opex', accounts.opexOnly.id);
  await seedLine(runner, a, 'opex', accounts.opexOnly.id);
  await seedLine(runner, a, 'capex', accounts.capexOnly.id, true);
  await seedLine(runner, a, 'opex', accounts.both.id);
  await seedLine(runner, a, 'capex', accounts.both.id);
  await seedLine(runner, a, 'capex', accounts.preset.id);

  const b = await seedTenant(runner, 'b');
  const group = await seedChart(runner, b, 'GROUP', true);
  const localB = await seedChart(runner, b, 'FR-PCG', false);
  await put('groupAccount', b, group, 1000);
  await put('mappedToGroup', b, localB, 700, { cons: 1000 });
  await put('usedFromOtherTenant', b, localB, 701, { cons: 9999 });
  // A line of tenant A naming an account of tenant B (foreign keys ignore tenants): not B's usage.
  await seedLine(runner, a, 'opex', accounts.usedFromOtherTenant.id);

  const [template] = await runner.query(
    `INSERT INTO coa_templates (country_iso, template_code, template_name, version, is_global, loaded_by_default, csv_payload)
     VALUES ('FR', $1, 'Hand edited', '9.9', false, false, $2) RETURNING id`,
    [`NATURE-${randomUUID().slice(0, 8)}`, HAND_EDITED],
  );

  // Migrations run without a tenant.
  await noTenant(runner);
  return { accounts, tenants: [a, b], templateId: template.id };
}

async function natureOf(runner: QueryRunner, account: { tenantId: string; id: string }) {
  await asTenant(runner, account.tenantId);
  const [row] = await runner.query(`SELECT nature, updated_at FROM accounts WHERE id = $1`, [account.id]);
  await noTenant(runner);
  return row;
}

async function natures(runner: QueryRunner, accounts: Accounts): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const key of Object.keys(accounts) as Array<keyof Accounts>) out[key] = (await natureOf(runner, accounts[key])).nature;
  return out;
}

async function payloadOf(runner: QueryRunner, id: string): Promise<string> {
  const [row] = await runner.query(`SELECT csv_payload FROM coa_templates WHERE id = $1`, [id]);
  return row.csv_payload;
}

async function rowSecurity(runner: QueryRunner, table: string) {
  const [row] = await runner.query(
    `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = $1::regclass`,
    [table],
  );
  return row;
}

async function auditCount(runner: QueryRunner, tenants: string[]): Promise<number> {
  let total = 0;
  for (const tenantId of tenants) {
    await asTenant(runner, tenantId);
    const [row] = await runner.query(`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND table_name = 'accounts'`, [tenantId]);
    total += row.n;
  }
  await noTenant(runner);
  return total;
}

const EXPECTED: Record<keyof Accounts, string | null> = {
  ifrsCapex: 'capex',
  ifrsOpex: 'opex',
  ifrsEmpty: null,
  opexOnly: 'opex',
  capexOnly: 'capex',
  both: null,
  mappedToIfrs: 'capex',
  mappedOutside: null,
  preset: 'opex',
  invalid: null,
  groupAccount: null,
  mappedToGroup: null,
  usedFromOtherTenant: null,
};

async function testBackfill() {
  await inRolledBackTransaction(async (runner) => {
    const security = Object.fromEntries(await Promise.all(TABLES.map(async (table) => [table, await rowSecurity(runner, table)])));
    const { accounts, tenants, templateId } = await seedBeforeMigration(runner);
    const { lines } = await captureLog(() => migration.up(runner));

    assert.deepEqual(await natures(runner, accounts), EXPECTED, 'the nature of each account');
    for (const key of Object.keys(accounts) as Array<keyof Accounts>) {
      const { updated_at } = await natureOf(runner, accounts[key]);
      assert.equal(new Date(updated_at).toISOString(), UPDATED, `${key}: updated_at is left alone`);
    }
    assert.equal(await auditCount(runner, tenants), 0, 'no audit line');
    for (const table of TABLES) {
      assert.deepEqual(await rowSecurity(runner, table), security[table], `${table}: row level security as found`);
    }

    assert.equal(await payloadOf(runner, templateId), HAND_EDITED_WITH_NATURE, 'the hand-edited template keeps its cells, nature appended');
    const ifrsTemplates: Array<{ csv_payload: string }> = await runner.query(
      `SELECT csv_payload FROM coa_templates WHERE is_global AND template_code = 'IFRS'`,
    );
    assert.ok(ifrsTemplates.length > 0, 'the database holds the global IFRS templates');
    for (const { csv_payload } of ifrsTemplates) {
      assert.match(csv_payload, /^﻿account_number;.*;status;nature\n/, 'the IFRS template keeps its BOM and gets the column');
    }

    // The constraint refuses another value.
    await asTenant(runner, accounts.both.tenantId);
    await runner.query('SAVEPOINT bad_nature');
    await assert.rejects(
      runner.query(`UPDATE accounts SET nature = 'both' WHERE id = $1`, [accounts.both.id]),
      (err: any) => err?.code === '23514' && err?.constraint === 'accounts_nature_check',
    );
    await runner.query('ROLLBACK TO SAVEPOINT bad_nature');
    await noTenant(runner);

    const summary = lines.find((line) => line.startsWith(LOG_PREFIX));
    assert.ok(summary, 'the counts are logged');
    assert.ok(Number(/: (\d+) template\(s\)/.exec(summary ?? '')?.[1] ?? -1) >= 1, `the templates are counted (${summary})`);
    assert.match(summary ?? '', /, 1 invalid value\(s\) cleared$|, \d+ invalid value\(s\) cleared$/, 'the cleared value is counted');
    const named = (tenantId: string) => lines.filter((line) => line.includes(`(${tenantId})`)).map((line) => line.replace(/^.*\): /, ''));
    assert.deepEqual(
      named(tenants[0]),
      ['2 from their lines, 2 from the IFRS template, 1 from their consolidation account, 4 left for OPEX and CAPEX'],
      'tenant A is named with its counts',
    );
    assert.deepEqual(
      named(tenants[1]),
      ['0 from their lines, 0 from the IFRS template, 0 from their consolidation account, 3 left for OPEX and CAPEX'],
      'tenant B is named with its counts',
    );
  });
}

/** A second run: nothing transformed or set, the natures and payloads kept. */
async function testRerun() {
  await inRolledBackTransaction(async (runner) => {
    const { accounts, templateId } = await seedBeforeMigration(runner);
    await captureLog(() => migration.up(runner));
    const before = await natures(runner, accounts);
    const templatesBefore = await runner.query(`SELECT id, csv_payload FROM coa_templates ORDER BY id`);

    const second = await captureLog(() => migration.up(runner));
    const summary = second.lines.find((line) => line.startsWith(LOG_PREFIX)) ?? '';
    assert.ok(
      summary.startsWith(`${LOG_PREFIX} 0 template(s) given the nature column, 0 account(s) set from their lines, 0 from the IFRS template, 0 from their consolidation account, `),
      `a second run changes nothing (${summary})`,
    );
    assert.doesNotMatch(summary, /invalid value/, 'nothing left to clear');
    assert.deepEqual(await natures(runner, accounts), before, 'the natures are kept');
    assert.deepEqual(await runner.query(`SELECT id, csv_payload FROM coa_templates ORDER BY id`), templatesBefore, 'the templates are kept');
    assert.equal(await payloadOf(runner, templateId), HAND_EDITED_WITH_NATURE);
  });
}

/** down(): the column and its constraint are gone, the templates lose the nature column only. */
async function testDown() {
  await inRolledBackTransaction(async (runner) => {
    const { templateId } = await seedBeforeMigration(runner);
    await captureLog(() => migration.up(runner));
    await migration.down(runner);
    const [column] = await runner.query(
      `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'accounts' AND column_name = 'nature'`,
    );
    assert.equal(column.n, 0, 'the column is dropped');
    assert.equal(await payloadOf(runner, templateId), HAND_EDITED, 'the hand-edited template is back as it was');
    const [withNature] = await runner.query(
      `SELECT count(*)::int AS n FROM coa_templates WHERE split_part(csv_payload, E'\\n', 1) LIKE '%;nature%'`,
    );
    assert.equal(withNature.n, 0, 'no template keeps the nature column');
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [testBackfill, testRerun, testDown]) {
      try {
        await test();
      } catch (err) {
        failures.push(`${test.name}: ${(err as Error).message.split('\n')[0]}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`account-nature-migration.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('account-nature-migration.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
