import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../data-source';
import { Tenant } from '../../tenants/tenant.entity';
import { CurrencySettingsService } from '../currency-settings.service';

// GET /currency/settings is read on every OPEX and CAPEX form (lot 1C): a read
// writes nothing (plan 1B, "sortir l'INSERT INTO currencies du chemin de
// lecture"). The currency rows are ensured where the settings are saved.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file in its serial database lane.

/** ISO codes no tenant uses (testing, precious metals, units of account). */
const CANDIDATES = ['XTS', 'XXX', 'XAU', 'XAG', 'XPT', 'XPD', 'XDR', 'XBA', 'XBB', 'XBC', 'XBD', 'XSU', 'XUA'];

async function main() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const present = new Set<string>(
      (await runner.query(`SELECT code FROM currencies WHERE code = ANY($1::text[])`, [CANDIDATES])).map((row: any) => String(row.code).trim()),
    );
    const [reporting, allowed] = CANDIDATES.filter((code) => !present.has(code));
    assert.ok(reporting && allowed, 'two ISO codes absent from currencies are needed');
    const countOf = async (codes: string[]) => Number((await runner.query(`SELECT count(*)::int AS n FROM currencies WHERE code = ANY($1::text[])`, [codes]))[0].n);

    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Currency read', 'active', $3::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `currency-read-${tenantId.slice(0, 8)}`, JSON.stringify({ reporting_currency: reporting, allowed_currencies: [allowed] })],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const service = new CurrencySettingsService(dataSource.getRepository(Tenant), { log: async () => undefined } as any);

    const read = await service.getSettings(tenantId, { manager: runner.manager });
    assert.equal(read.reportingCurrency, reporting);
    assert.deepEqual(read.allowedCurrencies, [allowed]);
    assert.equal(await countOf([reporting, allowed]), 0, 'reading the settings inserts no currency');
    console.log('ok - a read of the settings writes nothing');

    await service.updateSettings(tenantId, { allowedCurrencies: [allowed] }, null, { manager: runner.manager });
    assert.equal(await countOf([reporting, allowed]), 2, 'saving the settings ensures their currencies');
    console.log('ok - saving the settings ensures the currency rows');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
  console.log('currency-settings-read.integration.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
