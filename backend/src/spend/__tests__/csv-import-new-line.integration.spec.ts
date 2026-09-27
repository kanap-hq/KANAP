import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { InternalServerErrorException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { SpendItemsCsvService } from '../spend-items-csv.service';
import { CapexItemsService } from '../../capex/capex-items.service';
import { ItemNumberService } from '../../common/item-number.service';
import { replaceAmounts, spreadAnnualRows } from '../amounts-write.util';

// The legacy item CSV import of a line that does not exist yet and carries
// amounts, on OPEX and CAPEX against a real database: the line, its version
// and its twelve months are created in one go. The amounts writer inserts the
// version's tenant_id explicitly, so a version built in memory without one
// must be refused by name, never surface as a row-level security violation.

type Kind = 'opex' | 'capex';

const noAudit = { log: async () => undefined };
const noFreeze = { assertNotFrozen: async () => undefined };
const COMPANY = 'New line test company';

function importer(kind: Kind): { importCsv: (...args: any[]) => Promise<any>; csvHeaders: () => string[] } {
  if (kind === 'opex') {
    const args: any[] = Array.from({ length: 11 }, () => undefined);
    args[7] = noAudit;
    args[8] = noFreeze;
    args[9] = { getSettings: async () => ({ allowedCurrencies: null }) };
    args[10] = new ItemNumberService();
    return new (SpendItemsCsvService as any)(...args);
  }
  const args: any[] = Array.from({ length: 12 }, () => undefined);
  args[5] = noAudit;
  args[6] = noFreeze;
  args[7] = { resolveRates: async () => ({ map: new Map(), settings: { allowedCurrencies: null } }) };
  args[9] = { syncFromSupplier: async () => undefined };
  args[10] = new ItemNumberService();
  return new (CapexItemsService as any)(...args);
}

async function withTenant(tag: string, fn: (runner: QueryRunner, tenantId: string) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `newline-${tag}-${tenantId.slice(0, 8)}`, `New line test ${tag}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    // The OPEX line's account 6000 must exist in the company's chart of accounts.
    const [chart] = await runner.query(
      `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'NEWLINE', 'New line test chart', 'FR') RETURNING id`,
      [tenantId],
    );
    await runner.query(
      `INSERT INTO companies (tenant_id, name, country_iso, city, coa_id) VALUES ($1, $2, 'FR', 'Lyon', $3)`,
      [tenantId, COMPANY, chart.id],
    );
    await runner.query(
      `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name) VALUES ($1, $2, 6000, 'New line test account')`,
      [tenantId, chart.id],
    );
    await fn(runner, tenantId);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

function csvFile(headers: string[], values: Record<string, string>) {
  const line = headers.map((h) => values[h] ?? '').join(';');
  return { buffer: Buffer.from(`${headers.join(';')}\n${line}\n`, 'utf8') } as any;
}

function csvLine(kind: Kind, name: string): Record<string, string> {
  return kind === 'opex'
    ? { product_name: name, company_name: COMPANY, account_number: '6000', currency: 'EUR', status: 'enabled' }
    : { description: name, ppe_type: 'hardware', investment_type: 'replacement', priority: 'medium', currency: 'EUR', status: 'enabled', company_name: COMPANY };
}

async function testNewLineWithBudget(kind: Kind) {
  const year = new Date().getFullYear();
  await withTenant(kind, async (runner, tenantId) => {
    const svc = importer(kind);
    const headers = svc.csvHeaders.call(svc);
    const name = 'New line with a budget';
    for (const dryRun of [true, false]) {
      const result = await svc.importCsv(
        { file: csvFile(headers, { ...csvLine(kind, name), y_budget: '1200' }), dryRun, userId: null },
        { manager: runner.manager },
      );
      assert.equal(result.ok, true, `${kind} new line (dry run ${dryRun}): accepted (${JSON.stringify(result.errors)})`);
      assert.deepEqual(result.errors, [], `${kind} new line (dry run ${dryRun}): zero row errors`);
    }

    const [itemTable, versionTable, amountTable, itemColumn, nameColumn] = kind === 'opex'
      ? ['spend_items', 'spend_versions', 'spend_amounts', 'spend_item_id', 'product_name']
      : ['capex_items', 'capex_versions', 'capex_amounts', 'capex_item_id', 'description'];
    const items = await runner.query(
      `SELECT id, tenant_id FROM ${itemTable} WHERE tenant_id = $1 AND ${nameColumn} = $2`,
      [tenantId, name],
    );
    assert.equal(items.length, 1, `${kind} new line: one item created`);
    const versions = await runner.query(
      `SELECT id, tenant_id FROM ${versionTable} WHERE tenant_id = $1 AND ${itemColumn} = $2 AND budget_year = $3`,
      [tenantId, items[0].id, year],
    );
    assert.equal(versions.length, 1, `${kind} new line: one version for ${year}`);
    const months = await runner.query(
      `SELECT to_char(period, 'YYYY-MM-DD') AS period, planned, tenant_id FROM ${amountTable}
       WHERE tenant_id = $1 AND version_id = $2 ORDER BY period`,
      [tenantId, versions[0].id],
    );
    assert.equal(months.length, 12, `${kind} new line: twelve months`);
    assert.equal(months[0].period, `${year}-01-01`);
    assert.equal(months[11].period, `${year}-12-01`);
    assert.ok(months.every((m: any) => m.tenant_id === tenantId), `${kind} new line: months carry the tenant`);
    assert.equal(months.reduce((sum: number, m: any) => sum + Number(m.planned), 0), 1200, `${kind} new line: yearly Budget`);
  });
}

async function testVersionWithoutTenantIsRefused(kind: Kind) {
  const year = new Date().getFullYear();
  await withTenant(`${kind}-guard`, async (runner) => {
    for (const tenant_id of [undefined, null, '']) {
      await assert.rejects(
        replaceAmounts(
          { manager: runner.manager, freeze: noFreeze, scope: kind, version: { id: randomUUID(), tenant_id: tenant_id as any, budget_year: year } },
          year,
          spreadAnnualRows(year, { planned: 120000n }),
        ),
        (err: unknown) => err instanceof InternalServerErrorException && /carries no tenant_id/.test((err as Error).message),
        `${kind}: a version without tenant_id (${JSON.stringify(tenant_id)}) is refused by name`,
      );
    }
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const kind of ['opex', 'capex'] as Kind[]) {
      for (const test of [testNewLineWithBudget, testVersionWithoutTenantIsRefused]) {
        try {
          await test(kind);
        } catch (err) {
          failures.push(`${test.name}(${kind}): ${(err as Error).message.split('\n')[0]}`);
        }
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`csv-import-new-line.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('csv-import-new-line.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
