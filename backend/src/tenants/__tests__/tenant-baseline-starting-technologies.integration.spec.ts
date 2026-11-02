// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TechnologyCpeEvents, type CpeProductsAdded } from '../../technologies/technology-cpe-events';
import { NvdFeedService } from '../../vulnerabilities/nvd-feed.service';
import { STARTING_TECHNOLOGY_KEYS, TenantBaselineService } from '../tenant-baseline.service';

// Adopting the starting technologies (Windows Server, Ubuntu) emits one "CPE products received"
// event per technology, on the TechnologyCpeEvents instance the vulnerability feed subscribed to.
// The baseline keeps its own catalog service, so this fails when that service is built without
// the shared bus.

process.env.JWT_SECRET ||= 'starting-technologies-spec';
process.env.APP_ENV ||= 'development';
// The application context builds the storage client. Nothing in this spec writes a file.
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9000';
process.env.S3_BUCKET ||= 'test-bucket';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Recorded = { tenantId: string; technologyId: string; products: string[] };

function heldEvents(service: object, key: 'technologyCatalog' | 'cpeEvents'): TechnologyCpeEvents | undefined {
  const record = service as { technologyCatalog?: { cpeEvents?: TechnologyCpeEvents }; cpeEvents?: TechnologyCpeEvents };
  return key === 'technologyCatalog' ? record.technologyCatalog?.cpeEvents : record.cpeEvents;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for tenant-baseline-starting-technologies.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const app: INestApplicationContext = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const failures: string[] = [];
  const check = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      console.error(`${label}:`, err);
      failures.push(`${label}: ${(err as Error).message.split('\n')[0]}`);
    }
  };

  const dataSource: DataSource = app.get(DataSource);
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const events: TechnologyCpeEvents = app.get(TechnologyCpeEvents);
    const baseline: TenantBaselineService = app.get(TenantBaselineService);
    const feed: NvdFeedService = app.get(NvdFeedService, { strict: false });
    const baselineEvents = heldEvents(baseline, 'technologyCatalog');
    const feedEvents = heldEvents(feed, 'cpeEvents');

    await check('shared instance', async () => {
      assert.ok(baselineEvents, 'the baseline catalog holds TechnologyCpeEvents');
      assert.equal(baselineEvents, feedEvents, 'the baseline and the feed share one TechnologyCpeEvents');
      assert.equal(baselineEvents, events, 'app.get(TechnologyCpeEvents) is that instance');
    });

    const received: Recorded[] = [];
    events.subscribe(async (event: CpeProductsAdded) => {
      received.push({ tenantId: event.tenantId, technologyId: event.technologyId, products: [...event.products] });
    });

    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Starting technologies', 'active', '{}'::jsonb, '{}'::jsonb, now(), now())`,
      [tenantId, `start-tech-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await baseline.adoptStartingTechnologies(runner.manager, tenantId, 'en');

    await check('adoption events', async () => {
      const rows: Array<{ id: string; catalog_key: string; name: string }> = await runner.query(
        `SELECT id, catalog_key, name FROM technologies WHERE tenant_id = $1 ORDER BY catalog_key`,
        [tenantId],
      );
      assert.deepEqual(
        rows.map((row) => row.catalog_key),
        [...STARTING_TECHNOLOGY_KEYS].sort(),
        'Windows Server and Ubuntu were adopted',
      );
      assert.deepEqual(rows.map((row) => row.name).sort(), ['Ubuntu', 'Windows Server']);
      const byId = new Map(rows.map((row) => [row.id, row]));
      assert.equal(received.length, rows.length, 'one event per starting technology');
      const seen = new Set<string>();
      for (const event of received) {
        assert.equal(event.tenantId, tenantId);
        const row = byId.get(event.technologyId);
        assert.ok(row, 'the event names an adopted starting technology');
        assert.equal(seen.has(event.technologyId), false, `one event for ${row!.name}`);
        seen.add(event.technologyId);
        assert.ok(event.products.length > 0, `${row!.name} emits a non-empty products list`);
      }
      assert.deepEqual(
        received.map((event) => byId.get(event.technologyId)!.catalog_key),
        [...STARTING_TECHNOLOGY_KEYS],
        'events follow the adoption order',
      );
    });

    await runner.rollbackTransaction();
    await feed.whenIdle(5_000);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
    await app.close();
  }

  if (failures.length) {
    throw new Error(`tenant-baseline-starting-technologies.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('tenant-baseline-starting-technologies.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
