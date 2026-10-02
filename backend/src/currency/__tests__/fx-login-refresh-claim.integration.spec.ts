import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import dataSource from '../../data-source';
import { FxIngestionService } from '../fx-ingestion.service';

// The FX rates refresh on the first login after 30 days (tenant metadata
// fx_last_login_refresh_at). Two logins at once both read the old date; in one process the
// in-memory queue deduplicated them, with several (API_WORKERS > 1) both queued a refresh.
// The date is now claimed with a conditional update before the refresh is queued.

async function seedTenant(lastRefresh: unknown): Promise<string> {
  const id = randomUUID();
  await dataSource.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'FX claim spec', 'active', $3::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [id, `fxclaim-${id.slice(0, 8)}`, JSON.stringify(lastRefresh === undefined ? {} : { fx_last_login_refresh_at: lastRefresh, reporting_currency: 'EUR' })],
  );
  return id;
}

function service(ds: DataSource, queued: string[]) {
  const fx = new FxIngestionService({ manager: ds.manager } as any, undefined as any, undefined as any, undefined as any, undefined as any);
  (fx as any).logger = { log: () => undefined, warn: () => undefined, debug: () => undefined, error: () => undefined };
  (fx as any).queueManualRefresh = async (tenantId: string) => { queued.push(tenantId); return 'queued'; };
  return fx;
}

async function metadata(tenantId: string) {
  const [row] = await dataSource.query(`SELECT metadata FROM tenants WHERE id = $1`, [tenantId]);
  return row.metadata;
}

async function testConcurrentLoginsQueueOnce(other: DataSource, tenants: string[]) {
  const stale = new Date(Date.now() - 40 * 24 * 3600_000).toISOString();
  for (const initial of [stale, undefined, 12345]) {
    const tenantId = await seedTenant(initial);
    tenants.push(tenantId);
    const queued: string[] = [];
    const a = service(dataSource, queued);
    const b = service(other, queued);
    await Promise.all([a.maybeRefreshOnLogin(tenantId), b.maybeRefreshOnLogin(tenantId), a.maybeRefreshOnLogin(tenantId), b.maybeRefreshOnLogin(tenantId)]);
    assert.equal(queued.length, 1, `four logins at once on two processes, one refresh (stored date ${JSON.stringify(initial)})`);
    const stored = await metadata(tenantId);
    assert.notEqual(stored.fx_last_login_refresh_at, initial, 'the date is moved on');
    assert.equal(stored.fx_last_login_refresh_label, 'login-auto');
    if (initial === stale) assert.equal(stored.reporting_currency, 'EUR', 'the other metadata keys stay');

    await Promise.all([a.maybeRefreshOnLogin(tenantId), b.maybeRefreshOnLogin(tenantId)]);
    assert.equal(queued.length, 1, 'the next logins within 30 days queue nothing');
  }
}

async function main() {
  process.exitCode = 1;
  await dataSource.initialize();
  const other = new DataSource({ ...(dataSource.options as any), poolSize: 4 });
  await other.initialize();
  const tenants: string[] = [];
  const failures: string[] = [];
  try {
    try {
      await testConcurrentLoginsQueueOnce(other, tenants);
      console.log('ok - testConcurrentLoginsQueueOnce');
    } catch (err) {
      failures.push(`testConcurrentLoginsQueueOnce: ${(err as Error).message}`);
    }
  } finally {
    if (tenants.length) await dataSource.query(`DELETE FROM tenants WHERE id = ANY($1)`, [tenants]);
    await other.destroy();
    await dataSource.destroy();
  }
  if (failures.length) {
    console.error(`fx-login-refresh-claim.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log('fx-login-refresh-claim.integration.spec: ok');
  process.exitCode = 0;
}

void main();
