import * as assert from 'node:assert/strict';
import { QueryRunner } from 'typeorm';
import {
  LocationSearchLabelSeparator1854170000000,
  NEW_SEPARATOR,
  OLD_SEPARATOR,
} from '../../migrations/1854170000000-location-search-label-separator';
import { runSpecs, seedTenant, setCurrentTenant, withRollback } from '../../analytics/__tests__/analytics-test-helpers';

// @database-spec: the deployed locations refresh function, before and after the migration.
const migration = new LocationSearchLabelSeparator1854170000000();

const body = async (r: QueryRunner): Promise<string> =>
  (await r.query(`SELECT pg_get_functiondef('search_index_refresh_locations(uuid,uuid[])'::regprocedure) AS body`))[0].body;

async function label(r: QueryRunner, tenant: string, id: string): Promise<string> {
  await setCurrentTenant(r, tenant);
  await r.query(`UPDATE locations SET name = name WHERE id = $1`, [id]);
  const [row] = await r.query(`SELECT label FROM search_index WHERE tenant_id = $1 AND entity_type = 'locations' AND entity_id = $2`, [tenant, id]);
  return row?.label;
}

async function separatorSwap() {
  await withRollback(async (r) => {
    await migration.down(r);
    const before = await body(r);
    assert.ok(before.includes(OLD_SEPARATOR), 'down restores the dash separator');

    const tenant = await seedTenant(r, 'loc-label');
    const [{ id }] = await r.query(
      `INSERT INTO locations (tenant_id, name, hosting_type, location_reference, created_at, updated_at)
       VALUES ($1, 'Paris DC 1', 'on_premise', 'PAR-DC1', now(), now()) RETURNING id`,
      [tenant],
    );
    assert.equal(await label(r, tenant, id), 'PAR-DC1 — Paris DC 1');

    await r.query(`SELECT set_config('app.current_tenant', '', true)`);
    await migration.up(r);
    const after = await body(r);
    assert.equal(after, before.split(OLD_SEPARATOR).join(NEW_SEPARATOR), 'only the separator changes');
    assert.equal(await label(r, tenant, id), 'PAR-DC1 · Paris DC 1');

    await migration.up(r);
    assert.equal(await body(r), after, 'rerun is a no-op');

    await migration.down(r);
    assert.equal(await body(r), before, 'down restores the previous body');
    await migration.up(r);
    assert.equal(await body(r), after);
  });
}

void runSpecs('location-search-label-migration', [separatorSwap]);
