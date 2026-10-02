import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import dataSource from '../../data-source';
import { Asset } from '../../assets/asset.entity';
import { AssetsListService } from '../../assets/services/assets-list.service';
import { SuppliersService } from '../../suppliers/suppliers.service';
import { seedTenant } from '../../interfaces/__tests__/interface-seed-helpers';

// A set filter in exclude mode (`mode: 'exclude'`, decision Q3) on a list whose
// own set code reads `values` as the ticked values answers 400 instead of the
// inverted list; a field that honours the mode keeps it; include mode is
// unchanged; an unknown mode is a 400 everywhere. Two representative lists:
// suppliers (`buildWhereFromAgFilters`, the status column honours exclude) and
// assets (their own set compiler, every field).

const set = (values: unknown[], mode?: string) => ({ filterType: 'set', values, ...(mode ? { mode } : {}) });
const query = (filters: Record<string, unknown>) => ({ filters: JSON.stringify(filters), sort: 'name:ASC', limit: 100, includeDisabled: 'true' });
const badRequest = (pattern: RegExp) => (err: unknown) => err instanceof BadRequestException && pattern.test((err as Error).message);

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = await seedTenant(runner, 'set-mode');
    await runner.query(
      `INSERT INTO suppliers (tenant_id, name, status, disabled_at) VALUES ($1, 'Alpha supplies', 'enabled', NULL), ($1, 'Beta services', 'disabled', '2020-06-30T12:00:00Z')`,
      [tenantId],
    );
    await runner.query(
      `INSERT INTO assets (tenant_id, name, kind, provider, environment, status, created_at, updated_at)
       VALUES ($1, 'Database server', 'physical_server', 'on_premise', 'prod', 'active', now(), now()),
              ($1, 'Web machine', 'virtual_machine', 'on_premise', 'dev', 'active', now(), now())`,
      [tenantId],
    );
    const opts = { manager: runner.manager };

    // Suppliers: `buildWhereFromAgFilters` for the columns, the status column through the shared status reader.
    const suppliers = new SuppliersService(undefined as any, { log: async () => undefined } as any);
    const supplierNames = async (filters: Record<string, unknown>) => {
      const list = await suppliers.list(query(filters), opts);
      const ids = await suppliers.listIds(query(filters), opts);
      assert.deepEqual(ids.ids, list.items.map((item: any) => item.id));
      return list.items.map((item: any) => item.name);
    };
    assert.deepEqual(await supplierNames({ name: set(['Alpha supplies']) }), ['Alpha supplies'], 'include unchanged');
    assert.deepEqual(await supplierNames({ status: set(['enabled'], 'exclude') }), ['Beta services'], 'the status column honours exclude');
    for (const call of [() => suppliers.list(query({ name: set(['Alpha supplies'], 'exclude') }), opts), () => suppliers.listIds(query({ name: set(['Alpha supplies'], 'exclude') }), opts)]) {
      await assert.rejects(call, badRequest(/"name" cannot exclude values/), 'a column compiled as an include list refuses exclude');
    }
    await assert.rejects(() => suppliers.list(query({ status: set(['enabled'], 'everything-but') }), opts), badRequest(/Unknown set filter mode/));

    // Assets: their own set compiler on every field.
    const assets = new AssetsListService(runner.manager.getRepository(Asset));
    const assetOpts = { manager: runner.manager, tenantId };
    const assetNames = async (filters: Record<string, unknown>) => (await assets.list(query(filters), assetOpts)).items.map((item: any) => item.name);
    assert.deepEqual(await assetNames({ kind: set(['virtual_machine']) }), ['Web machine'], 'include unchanged');
    assert.deepEqual(await assetNames({ kind: set(['virtual_machine'], 'include') }), ['Web machine'], 'explicit include');
    for (const call of [
      () => assets.list(query({ kind: set(['virtual_machine'], 'exclude') }), assetOpts),
      () => assets.listIds(query({ kind: set(['virtual_machine'], 'exclude') }), assetOpts),
      () => assets.listFilterValues({ ...query({ environment: set(['dev'], 'exclude') }), fields: 'kind' }, assetOpts),
      () => assets.list(query({ kind: { operator: 'AND', conditions: [set(['physical_server']), set(['virtual_machine'], 'exclude')] } }), assetOpts),
    ]) {
      await assert.rejects(call, badRequest(/cannot exclude values/));
    }
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
  console.log('set-filter-mode.integration.spec: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
