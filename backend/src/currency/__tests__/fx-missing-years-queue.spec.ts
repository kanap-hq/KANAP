import * as assert from 'node:assert/strict';
import { FxIngestionService } from '../fx-ingestion.service';

/**
 * Two reads find missing rates for two years at the same time: the second
 * request waits for the running refresh instead of being dropped until the next read.
 */
async function testYearsRequestedDuringARefreshFollowIt() {
  const fx = new FxIngestionService(
    { manager: {} } as any,
    {} as any,
    {} as any,
    { onMissingRates: () => undefined } as any,
    {} as any,
  );
  const refreshed: number[][] = [];
  let release!: () => void;
  const firstDone = new Promise<void>((resolve) => { release = resolve; });
  (fx as any).refreshTenant = async (_tenantId: string, years: number[]) => {
    refreshed.push(years);
    if (refreshed.length === 1) await firstDone;
    return [];
  };

  fx.refreshMissingYears('tenant-1', [2027]);
  await new Promise((resolve) => setImmediate(resolve));
  fx.refreshMissingYears('tenant-1', [2026]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(refreshed, [[2027]], 'the second year waits for the running refresh');

  release();
  for (let i = 0; i < 10 && refreshed.length < 2; i += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(refreshed, [[2027], [2026]], 'then it is fetched without another read');
}

async function run() {
  await testYearsRequestedDuringARefreshFollowIt();
  console.log('missing years queued during a refresh follow it.');
}

void run();
