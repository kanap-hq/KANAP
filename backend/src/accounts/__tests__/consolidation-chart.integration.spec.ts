import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AccountsService } from '../accounts.service';
import { ChartOfAccountsService } from '../chart-of-accounts.service';

// The consolidation chart (plan planning/coa-consolidation-chart.md), against a
// real database, each test in a transaction that is rolled back:
// - roles: one consolidation chart per tenant (any scope), set with a resync of
//   the derived names (counts returned), cleared, previewed (impact counts);
//   the global default cleared; the country default unset; every role change
//   audited on the chart;
// - derived consolidation name and description on create, update and CSV
//   import (kept when the number is outside the consolidation chart, cleared
//   with the number);
// - propagation when an account of the consolidation chart is renamed,
//   described or renumbered (self-references included), audited per account;
// - `consolidation_status` on the accounts list and its `consolidationStatus`
//   filter (page and total), and the chart counts;
// - another tenant's charts and accounts are never touched.

type AuditEntry = { table: string; recordId: string | null; action: string; before: any; after: any };

function services() {
  const audits: AuditEntry[] = [];
  const audit = { log: async (entry: AuditEntry) => { audits.push(entry); } } as any;
  const accounts = new AccountsService(undefined as any, audit);
  const charts = new ChartOfAccountsService(undefined as any, undefined as any, undefined as any, audit, accounts);
  return { audits, accounts, charts };
}

async function asTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(sql, params))[0].id;
}

type Seed = {
  tenantId: string;
  charts: { ifrs: string; fr: string; alt: string };
  accounts: Record<'ifrs1000' | 'ifrs2000' | 'fr600' | 'fr601' | 'fr602' | 'fr603' | 'alt1000' | 'alt3000', string>;
  companyWithoutChart: string;
};

async function seedTenant(runner: QueryRunner, tag: string): Promise<Seed> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `cons-chart-${tag}-${tenantId.slice(0, 8)}`, `Consolidation chart ${tag}`],
  );
  await asTenant(runner, tenantId);
  const chart = (code: string, scope: 'GLOBAL' | 'COUNTRY', globalDefault = false) => one(
    runner,
    `INSERT INTO chart_of_accounts (tenant_id, code, name, scope, country_iso, is_global_default)
     VALUES ($1, $2, $2, $3, $4, $5) RETURNING id`,
    [tenantId, code, scope, scope === 'COUNTRY' ? 'FR' : null, globalDefault],
  );
  const charts = { ifrs: await chart('IFRS', 'GLOBAL', true), fr: await chart('FR-PCG', 'COUNTRY'), alt: await chart('ALT', 'GLOBAL') };
  const account = (coaId: string, number: number, name: string, description: string | null, consNumber: number | null, consName: string | null, consDescription: string | null) => one(
    runner,
    `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name, description,
                           consolidation_account_number, consolidation_account_name, consolidation_account_description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [tenantId, coaId, number, name, description, consNumber, consName, consDescription],
  );
  const accounts = {
    ifrs1000: await account(charts.ifrs, 1000, 'Tangible', 'Physical equipment', 1000, 'Tangible', 'Physical equipment'),
    ifrs2000: await account(charts.ifrs, 2000, 'Software', 'Licences', 2000, 'Software', 'Licences'),
    fr600: await account(charts.fr, 600, 'Matériel', null, 1000, 'Legacy tangible', 'Legacy text'),
    fr601: await account(charts.fr, 601, 'Logiciels', null, 2000, 'Software', 'Licences'),
    fr602: await account(charts.fr, 602, 'Divers', null, 9999, 'Old group account', 'Old text'),
    fr603: await account(charts.fr, 603, 'Sans lien', null, null, null, null),
    alt1000: await account(charts.alt, 1000, 'Tangible v2', 'Equipment v2', 1000, 'Tangible v2', 'Equipment v2'),
    alt3000: await account(charts.alt, 3000, 'Cloud', 'Hosting', 3000, 'Cloud', 'Hosting'),
  };
  const companyWithoutChart = await one(
    runner,
    `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'No chart company', 'DE', 'Berlin') RETURNING id`,
    [tenantId],
  );
  await runner.query(`UPDATE companies SET coa_id = NULL WHERE id = $1`, [companyWithoutChart]);
  return { tenantId, charts, accounts, companyWithoutChart };
}

/** A snapshot of a tenant's charts and accounts, to prove another tenant's are untouched. */
async function snapshot(runner: QueryRunner, tenantId: string) {
  await asTenant(runner, tenantId);
  const charts = await runner.query(
    `SELECT code, is_default, is_global_default, is_consolidation, updated_at FROM chart_of_accounts WHERE tenant_id = $1 ORDER BY code`,
    [tenantId],
  );
  const accounts = await runner.query(
    `SELECT account_number, consolidation_account_number, consolidation_account_name, consolidation_account_description, updated_at
     FROM accounts WHERE tenant_id = $1 ORDER BY coa_id, account_number`,
    [tenantId],
  );
  const companies = await runner.query(`SELECT name, coa_id FROM companies WHERE tenant_id = $1 ORDER BY name`, [tenantId]);
  return { charts, accounts, companies };
}

/**
 * Runs `fn` for tenant `main` in a rolled-back transaction, with a second tenant
 * (`other`, its IFRS chart already the consolidation chart) whose rows must stay
 * exactly as they were.
 */
async function withTenants(fn: (runner: QueryRunner, main: Seed) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const other = await seedTenant(runner, 'other');
    await runner.query(`UPDATE chart_of_accounts SET is_consolidation = true WHERE id = $1`, [other.charts.alt]);
    const before = await snapshot(runner, other.tenantId);
    const main = await seedTenant(runner, 'main');
    await fn(runner, main);
    assert.deepEqual(await snapshot(runner, other.tenantId), before, "another tenant's charts and accounts are untouched");
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function chartFlags(runner: QueryRunner, seed: Seed) {
  await asTenant(runner, seed.tenantId);
  const rows = await runner.query(
    `SELECT code, is_default, is_global_default, is_consolidation FROM chart_of_accounts WHERE tenant_id = $1 ORDER BY code`,
    [seed.tenantId],
  );
  return Object.fromEntries(rows.map((r: any) => [r.code, { country: r.is_default, global: r.is_global_default, consolidation: r.is_consolidation }]));
}

async function consolidationOf(runner: QueryRunner, accountId: string) {
  const [row] = await runner.query(
    `SELECT consolidation_account_number AS number, consolidation_account_name AS name, consolidation_account_description AS description
     FROM accounts WHERE id = $1`,
    [accountId],
  );
  return row;
}

function chartAudits(audits: AuditEntry[], field: string) {
  return audits
    .filter((a) => a.table === 'chart_of_accounts' && a.action === 'update' && a.before?.[field] !== a.after?.[field])
    .map((a) => ({ id: a.recordId, from: a.before?.[field], to: a.after?.[field] }));
}

/** Set, switch and clear the consolidation chart: one holder, resync counts, impact, audit. */
async function testConsolidationRole() {
  await withTenants(async (runner, seed) => {
    const { charts, audits } = services();
    const opts = { manager: runner.manager };

    // Preview: accounts of the other charts (FR + ALT) against IFRS.
    assert.deepEqual(await charts.consolidationImpact(seed.charts.ifrs, opts), { matched: 3, outside: 2, unmapped: 1 }, 'impact of IFRS');
    assert.equal(audits.length, 0, 'the preview writes nothing');

    // FR 600 (legacy name) and ALT 1000 (its own name) take IFRS 1000's; FR 602 (9999) and ALT 3000 are outside.
    assert.deepEqual(await charts.setConsolidation(seed.charts.ifrs, 'user-1', opts), { resynced: 2, outside: 2 });
    assert.deepEqual(await consolidationOf(runner, seed.accounts.fr600), { number: 1000, name: 'Tangible', description: 'Physical equipment' });
    assert.deepEqual(await consolidationOf(runner, seed.accounts.alt1000), { number: 1000, name: 'Tangible', description: 'Physical equipment' });
    assert.deepEqual(await consolidationOf(runner, seed.accounts.fr602), { number: 9999, name: 'Old group account', description: 'Old text' }, 'an account outside keeps its legacy name');
    assert.deepEqual(chartAudits(audits, 'is_consolidation'), [{ id: seed.charts.ifrs, from: false, to: true }], 'the role change is audited');
    assert.equal(audits.filter((a) => a.table === 'accounts').length, 2, 'one audit line per account resynced');

    // Any scope: the country chart can hold the role. The previous holder loses it.
    audits.length = 0;
    await charts.setConsolidation(seed.charts.fr, 'user-1', opts);
    let flags = await chartFlags(runner, seed);
    assert.deepEqual([flags.IFRS.consolidation, flags['FR-PCG'].consolidation, flags.ALT.consolidation], [false, true, false]);
    assert.deepEqual(
      chartAudits(audits, 'is_consolidation').sort((a, b) => String(a.to).localeCompare(String(b.to))),
      [{ id: seed.charts.ifrs, from: true, to: false }, { id: seed.charts.fr, from: false, to: true }],
      'both charts audited',
    );

    // Switch to ALT: IFRS 1000 and FR 600 follow ALT 1000's name; 2000 and 9999 are outside ALT.
    const switched = await charts.setConsolidation(seed.charts.alt, 'user-1', opts);
    assert.equal(switched.resynced, 3, 'IFRS 1000, FR 600 and ALT 1000 (its own self-reference) resynced');
    assert.equal(switched.outside, 3, 'IFRS 2000, FR 601 and FR 602 are outside ALT');
    assert.deepEqual(await consolidationOf(runner, seed.accounts.ifrs1000), { number: 1000, name: 'Tangible v2', description: 'Equipment v2' });
    flags = await chartFlags(runner, seed);
    assert.deepEqual(Object.values(flags).filter((f: any) => f.consolidation).length, 1, 'one consolidation chart');

    // Setting it again is idempotent: nothing left to resync.
    assert.deepEqual(await charts.setConsolidation(seed.charts.alt, 'user-1', opts), { resynced: 0, outside: 3 });

    // Clear: a chart that does not hold the role is a no-op.
    audits.length = 0;
    assert.deepEqual(await charts.clearConsolidation(seed.charts.ifrs, 'user-1', opts), { cleared: false });
    assert.equal(audits.length, 0, 'a no-op writes no audit line');
    assert.deepEqual(await charts.clearConsolidation(seed.charts.alt, 'user-1', opts), { cleared: true });
    assert.deepEqual(chartAudits(audits, 'is_consolidation'), [{ id: seed.charts.alt, from: true, to: false }]);
    flags = await chartFlags(runner, seed);
    assert.equal(Object.values(flags).filter((f: any) => f.consolidation).length, 0, 'no consolidation chart');
    assert.deepEqual(await consolidationOf(runner, seed.accounts.fr600), { number: 1000, name: 'Tangible v2', description: 'Equipment v2' }, 'clearing does not touch the accounts');
  });
}

/** Global default: set (audited, GLOBAL only, companies without a chart), cleared; country default unset. */
async function testOtherRoles() {
  await withTenants(async (runner, seed) => {
    const { charts, audits } = services();
    const opts = { manager: runner.manager };

    await assert.rejects(charts.setGlobalDefault(seed.charts.fr, 'user-1', opts), (err: any) => err instanceof BadRequestException);
    await charts.setGlobalDefault(seed.charts.alt, 'user-1', opts);
    let flags = await chartFlags(runner, seed);
    assert.deepEqual([flags.IFRS.global, flags.ALT.global], [false, true], 'the previous global default is cleared');
    assert.deepEqual(
      chartAudits(audits, 'is_global_default').sort((a, b) => String(a.to).localeCompare(String(b.to))),
      [{ id: seed.charts.ifrs, from: true, to: false }, { id: seed.charts.alt, from: false, to: true }],
      'the global default change is audited on both charts',
    );
    const [company] = await runner.query(`SELECT coa_id FROM companies WHERE id = $1`, [seed.companyWithoutChart]);
    assert.equal(company.coa_id, seed.charts.alt, 'a company without a chart gets the global default');

    audits.length = 0;
    assert.deepEqual(await charts.clearGlobalDefault(seed.charts.ifrs, 'user-1', opts), { cleared: false });
    assert.deepEqual(await charts.clearGlobalDefault(seed.charts.alt, 'user-1', opts), { cleared: true });
    flags = await chartFlags(runner, seed);
    assert.equal(flags.ALT.global, false, 'the global default is cleared');
    assert.deepEqual(chartAudits(audits, 'is_global_default'), [{ id: seed.charts.alt, from: true, to: false }]);

    // Country default: set, then unset with is_default false.
    await charts.update(seed.charts.fr, { is_default: true }, 'user-1', opts);
    assert.equal((await chartFlags(runner, seed))['FR-PCG'].country, true);
    await charts.update(seed.charts.fr, { is_default: false }, 'user-1', opts);
    assert.equal((await chartFlags(runner, seed))['FR-PCG'].country, false, 'is_default false unsets the country default');

    // A GLOBAL chart moved to a country loses "default for other countries".
    await charts.setGlobalDefault(seed.charts.alt, 'user-1', opts);
    await charts.update(seed.charts.alt, { scope: 'COUNTRY', country_iso: 'DE' }, 'user-1', opts);
    assert.equal((await chartFlags(runner, seed)).ALT.global, false, 'a country chart is never the global default');
  });
}

/** Derived name and description on create, update and CSV import. */
async function testDerivedNames() {
  await withTenants(async (runner, seed) => {
    const { charts, accounts } = services();
    const opts = { manager: runner.manager };
    await charts.setConsolidation(seed.charts.ifrs, 'user-1', opts);

    const created = await accounts.create(
      { coa_id: seed.charts.fr, account_number: '604', account_name: 'SaaS', consolidation_account_number: 2000, consolidation_account_name: 'Typed by hand' },
      'user-1', opts,
    );
    assert.deepEqual(await consolidationOf(runner, created.id), { number: 2000, name: 'Software', description: 'Licences' }, 'create: derived from IFRS 2000');

    const legacy = await accounts.create(
      { coa_id: seed.charts.fr, account_number: '605', account_name: 'Legacy', consolidation_account_number: 8888, consolidation_account_name: 'Old name', consolidation_account_description: 'Old text' },
      'user-1', opts,
    );
    assert.deepEqual(await consolidationOf(runner, legacy.id), { number: 8888, name: 'Old name', description: 'Old text' }, 'create: outside keeps what was sent');

    await accounts.update(legacy.id, { consolidation_account_number: 1000 }, 'user-1', opts);
    assert.deepEqual(await consolidationOf(runner, legacy.id), { number: 1000, name: 'Tangible', description: 'Physical equipment' }, 'update: derived from IFRS 1000');

    await accounts.update(legacy.id, { account_name: 'Renamed only' }, 'user-1', opts);
    assert.deepEqual(await consolidationOf(runner, legacy.id), { number: 1000, name: 'Tangible', description: 'Physical equipment' }, 'update of another field keeps the mapping');

    await accounts.update(legacy.id, { consolidation_account_number: null }, 'user-1', opts);
    assert.deepEqual(await consolidationOf(runner, legacy.id), { number: null, name: null, description: null }, 'update: clearing the number clears the name');

    // CSV import into the FR chart: an update (601), a matched row, an outside row, a row without number.
    const csv = [
      'account_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status',
      '601;Logiciels;;;2000;Wrong name;Wrong text;enabled',
      '610;Cloud;;;1000;;;enabled',
      '611;Ancien;;;7777;Kept legacy;Kept text;enabled',
      '612;Sans lien;;;;Dropped name;Dropped text;enabled',
    ].join('\n');
    const result: any = await accounts.importCsv(
      { file: { buffer: Buffer.from(csv, 'utf8') } as Express.Multer.File, dryRun: false, userId: 'user-1' },
      { manager: runner.manager, targetCoaId: seed.charts.fr, allowCoaCodeColumn: false },
    );
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const byNumber = async (number: number) => {
      const [row] = await runner.query(`SELECT id FROM accounts WHERE coa_id = $1 AND account_number = $2`, [seed.charts.fr, number]);
      return consolidationOf(runner, row.id);
    };
    assert.deepEqual(await byNumber(601), { number: 2000, name: 'Software', description: 'Licences' }, 'import update: derived');
    assert.deepEqual(await byNumber(610), { number: 1000, name: 'Tangible', description: 'Physical equipment' }, 'import create: derived');
    assert.deepEqual(await byNumber(611), { number: 7777, name: 'Kept legacy', description: 'Kept text' }, 'import: outside keeps the file');
    assert.deepEqual(await byNumber(612), { number: null, name: null, description: null }, 'import: no number, no name');

    // Without a consolidation chart, what the caller sends is kept.
    await charts.clearConsolidation(seed.charts.ifrs, 'user-1', opts);
    const free = await accounts.create(
      { coa_id: seed.charts.fr, account_number: '620', account_name: 'Free', consolidation_account_number: 1000, consolidation_account_name: 'Typed' },
      'user-1', opts,
    );
    assert.deepEqual(await consolidationOf(runner, free.id), { number: 1000, name: 'Typed', description: null }, 'no consolidation chart: kept');
  });
}

/** An account of the consolidation chart renamed, described, renumbered or created: mapped accounts follow. */
async function testPropagation() {
  await withTenants(async (runner, seed) => {
    const { charts, accounts, audits } = services();
    const opts = { manager: runner.manager };
    await charts.setConsolidation(seed.charts.ifrs, 'user-1', opts);

    // Rename and describe IFRS 2000: FR 601 follows, and IFRS 2000's own self-reference.
    audits.length = 0;
    await accounts.update(seed.accounts.ifrs2000, { account_name: 'Software licences', description: 'Recurring licences' }, 'user-1', opts);
    assert.deepEqual(await consolidationOf(runner, seed.accounts.fr601), { number: 2000, name: 'Software licences', description: 'Recurring licences' });
    assert.deepEqual(await consolidationOf(runner, seed.accounts.ifrs2000), { number: 2000, name: 'Software licences', description: 'Recurring licences' }, 'self-reference');
    assert.deepEqual(
      audits.filter((a) => a.table === 'accounts').map((a) => a.recordId).sort(),
      [seed.accounts.ifrs2000, seed.accounts.fr601].sort(),
      'the source account and each account following it are audited',
    );

    // An account already mapped to the new number (outside until now) joins it on renumbering.
    const waiting = await accounts.create(
      { coa_id: seed.charts.fr, account_number: '630', account_name: 'Waiting', consolidation_account_number: 1010, consolidation_account_name: 'Not yet' },
      'user-1', opts,
    );
    // Renumber IFRS 1000 to 1010: FR 600 and ALT 1000 move to 1010, IFRS 1000's self-reference too.
    await accounts.update(seed.accounts.ifrs1000, { account_number: '1010' }, 'user-1', opts);
    for (const id of [seed.accounts.fr600, seed.accounts.alt1000, seed.accounts.ifrs1000, waiting.id]) {
      assert.deepEqual(await consolidationOf(runner, id), { number: 1010, name: 'Tangible', description: 'Physical equipment' }, `renumbered: ${id}`);
    }
    assert.deepEqual(await consolidationOf(runner, seed.accounts.fr602), { number: 9999, name: 'Old group account', description: 'Old text' }, 'unrelated accounts untouched');

    // A new account of the consolidation chart: accounts already mapped to its number take its name.
    await accounts.create(
      { coa_id: seed.charts.ifrs, account_number: '9999', account_name: 'Other IT costs', description: 'Misc', consolidation_account_number: 9999 },
      'user-1', opts,
    );
    assert.deepEqual(await consolidationOf(runner, seed.accounts.fr602), { number: 9999, name: 'Other IT costs', description: 'Misc' });

    // A local account renamed propagates nothing.
    audits.length = 0;
    await accounts.update(seed.accounts.fr601, { account_name: 'Logiciels et licences' }, 'user-1', opts);
    assert.equal(audits.filter((a) => a.table === 'accounts').length, 1, 'only the account itself is audited');
  });
}

/** consolidation_status on the list and the detail, its filter with page and total, the chart counts. */
async function testStatusAndCounts() {
  await withTenants(async (runner, seed) => {
    const { charts, accounts } = services();
    const opts = { manager: runner.manager };
    const statuses = async (query: any) => {
      const page = await accounts.list({ limit: 50, sort: 'account_number:ASC', ...query }, opts);
      return {
        total: page.total,
        rows: page.items.map((i: any) => `${i.account_number}:${i.consolidation_status}`),
      };
    };

    // No consolidation chart: every numbered account is outside.
    assert.deepEqual((await statuses({ coaId: seed.charts.fr })).rows, ['600:outside', '601:outside', '602:outside', '603:unmapped']);
    let list = await charts.list({ limit: 50, sort: 'code:ASC' }, opts);
    const fr = () => list.items.find((i: any) => i.id === seed.charts.fr) as any;
    assert.deepEqual(
      [fr().accounts_count, fr().accounts_unmapped_count, fr().accounts_outside_count, fr().is_consolidation],
      [4, 1, 0, false],
      'no consolidation chart: outside count is 0',
    );

    await charts.setConsolidation(seed.charts.ifrs, 'user-1', opts);
    assert.deepEqual((await statuses({ coaId: seed.charts.fr })).rows, ['600:mapped', '601:mapped', '602:outside', '603:unmapped']);
    assert.deepEqual(await statuses({ coaId: seed.charts.fr, consolidationStatus: 'outside' }), { total: 1, rows: ['602:outside'] });
    assert.deepEqual(await statuses({ coaId: seed.charts.fr, consolidationStatus: 'unmapped' }), { total: 1, rows: ['603:unmapped'] });
    assert.deepEqual(await statuses({ coaId: seed.charts.fr, consolidationStatus: 'mapped' }), { total: 2, rows: ['600:mapped', '601:mapped'] });
    // Pagination keeps the filtered total.
    const paged = await accounts.list({ coaId: seed.charts.fr, consolidationStatus: 'mapped', limit: 1, page: 2, sort: 'account_number:ASC' }, opts);
    assert.deepEqual([paged.total, paged.items.map((i: any) => i.account_number)], [2, [601]], 'page 2 of the mapped accounts');
    // With a quick search on a consolidation number, the filter still applies.
    assert.deepEqual((await statuses({ coaId: seed.charts.fr, consolidationStatus: 'outside', q: '1000' })).rows, [], 'q 1000 among outside');
    assert.deepEqual((await statuses({ coaId: seed.charts.fr, consolidationStatus: 'mapped', q: '1000' })).rows, ['600:mapped'], 'q 1000 among mapped');
    // ids (select all) follow the filter.
    const ids = await accounts.listIds({ coaId: seed.charts.fr, consolidationStatus: 'outside' }, opts);
    assert.deepEqual([ids.total, ids.ids], [1, [seed.accounts.fr602]]);
    await assert.rejects(accounts.list({ consolidationStatus: 'nope' }, opts), (err: any) => err instanceof BadRequestException);
    // Detail.
    assert.equal((await accounts.getWithConsolidationStatus(seed.accounts.fr602, opts)).consolidation_status, 'outside');
    assert.equal((await accounts.getWithConsolidationStatus(seed.accounts.fr600, opts)).consolidation_status, 'mapped');

    list = await charts.list({ limit: 50, sort: 'is_consolidation:DESC' }, opts);
    assert.equal((list.items[0] as any).id, seed.charts.ifrs, 'sorted by is_consolidation');
    assert.deepEqual([fr().accounts_count, fr().accounts_unmapped_count, fr().accounts_outside_count], [4, 1, 1]);
    const alt = list.items.find((i: any) => i.id === seed.charts.alt) as any;
    assert.deepEqual([alt.accounts_unmapped_count, alt.accounts_outside_count], [0, 1], 'ALT 3000 is outside IFRS');
    const detail: any = await charts.get(seed.charts.ifrs, opts);
    assert.deepEqual(
      [detail.is_consolidation, detail.accounts_count, detail.accounts_unmapped_count, detail.accounts_outside_count],
      [true, 2, 0, 0],
      'the detail carries the role and the counts',
    );
    const filtered = await charts.list({ filters: JSON.stringify({ is_consolidation: { filterType: 'set', values: ['true'] } }) }, opts);
    assert.ok(filtered.items.every((i: any) => i.is_consolidation), 'filter on is_consolidation');
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [testConsolidationRole, testOtherRoles, testDerivedNames, testPropagation, testStatusAndCounts]) {
      try {
        await test();
      } catch (err) {
        failures.push(`${test.name}: ${(err as Error).message.split('\n')[0]}`);
        if (process.env.SPEC_VERBOSE) console.error(err);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`consolidation-chart.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('consolidation-chart.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
