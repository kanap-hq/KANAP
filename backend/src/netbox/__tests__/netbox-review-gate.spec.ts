import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { NetboxConfigService, NetboxSyncStateView, readLastConnectionTest } from '../netbox-config.service';
import { parseNetboxReviewed } from '../netbox-sync.service';

// A manual run writes only what its preview listed, in batches. Two things
// keep that promise outside the run itself: the list of reviewed objects is
// read strictly, and the hourly run holds for as long as a batch is waiting.

// --- the reviewed list -----------------------------------------------------

// No list means nothing was reviewed, so nothing may be created or updated:
// an older page or a direct API call is not a way around the review.
assert.equal(parseNetboxReviewed(undefined).size, 0);
assert.equal(parseNetboxReviewed(null).size, 0);

{
  const reviewed = parseNetboxReviewed([
    { external_type: 'device', external_id: 12 },
    { external_type: 'vm', external_id: ' 7 ' },
    { external_type: 'device', external_id: '12' },
  ]);
  assert.deepEqual([...reviewed].sort(), ['device:12', 'vm:7']);
}

for (const raw of [
  'device:1',
  [{ external_type: 'rack', external_id: '1' }],
  [{ external_type: 'device', external_id: '' }],
  [null],
  Array.from({ length: 2001 }, (_, index) => ({ external_type: 'device', external_id: String(index) })),
]) {
  assert.throws(() => parseNetboxReviewed(raw), BadRequestException);
}

// --- the last connection test, kept in the existing configuration -----------

assert.equal(readLastConnectionTest(null), null);
assert.equal(readLastConnectionTest({}), null);
assert.deepEqual(
  readLastConnectionTest({ last_connection_test: { ok: true, tested_at: '2026-10-24T10:00:00.000Z' } }),
  { ok: true, tested_at: '2026-10-24T10:00:00.000Z' },
);
assert.equal(readLastConnectionTest({ last_connection_test: { ok: 'yes', tested_at: '2026-10-24T10:00:00.000Z' } }), null);
assert.equal(readLastConnectionTest({ last_connection_test: { ok: false, tested_at: 'not-a-date' } }), null);

// --- the hourly run holds while a batch is waiting --------------------------

function harness(initial: Record<string, unknown>) {
  const config: any = {
    tenant_id: 'tenant-1',
    base_url: 'https://netbox.example.test',
    enabled: true,
    credential_ref_json: null,
    metadata_json: initial,
  };
  const manager: any = {
    getRepository: () => ({
      findOne: async () => config,
      save: async (entity: unknown) => entity,
    }),
  };
  const service = new NetboxConfigService({ canEncrypt: () => true } as any);
  return { config, manager, service };
}

function manualSuccess(deferred: number | undefined): NetboxSyncStateView {
  return {
    status: 'success',
    trigger: 'manual',
    started_at: '2026-09-20T10:00:00.000Z',
    finished_at: '2026-09-20T10:01:00.000Z',
    duration_ms: 60000,
    counts: { create: 500, update: 0, unchanged: 0, ambiguous: 0, skipped: 0, missing: 0, error: 0, deferred },
    error: null,
    warnings: [],
  };
}

async function main() {
  // First batch of a first import: objects are left for later, so the first
  // import is NOT done and the hourly run must not start.
  {
    const { config, manager, service } = harness({ auto_sync: true });
    await service.writeSyncState(manager, 'tenant-1', manualSuccess(830));
    assert.equal(config.metadata_json.first_manual_sync_at, undefined);
    assert.equal(config.metadata_json.review_pending, 830);
    const view = service.toView(config);
    assert.equal(view.manual_sync_done, false);
    assert.equal(view.review_pending, 830);

    // The last batch leaves nothing behind: the review is complete.
    await service.writeSyncState(manager, 'tenant-1', manualSuccess(0));
    assert.equal(typeof config.metadata_json.first_manual_sync_at, 'string');
    assert.equal(service.toView(config).manual_sync_done, true);
    assert.equal(service.toView(config).review_pending, 0);
  }

  // A tenant already past its first import widens its matches: the batch left
  // over puts the hourly run on hold again, until it is reviewed.
  {
    const { config, manager, service } = harness({ first_manual_sync_at: '2026-09-01T00:00:00.000Z' });
    assert.equal(service.toView(config).manual_sync_done, true);
    await service.writeSyncState(manager, 'tenant-1', manualSuccess(40));
    assert.equal(service.toView(config).manual_sync_done, false);
    await service.writeSyncState(manager, 'tenant-1', manualSuccess(0));
    assert.equal(service.toView(config).manual_sync_done, true);
    assert.equal(config.metadata_json.first_manual_sync_at, '2026-09-01T00:00:00.000Z');
  }

  // A state written by an earlier build has no `deferred`: it reads as zero.
  {
    const { config, manager, service } = harness({});
    await service.writeSyncState(manager, 'tenant-1', manualSuccess(undefined));
    assert.equal(service.toView(config).manual_sync_done, true);
  }

  // A scheduled run or a failed run never touches the pending review.
  {
    const { config, manager, service } = harness({ first_manual_sync_at: '2026-09-01T00:00:00.000Z', review_pending: 12 });
    await service.writeSyncState(manager, 'tenant-1', { ...manualSuccess(0), trigger: 'scheduled' });
    assert.equal(config.metadata_json.review_pending, 12);
    await service.writeSyncState(manager, 'tenant-1', { ...manualSuccess(0), status: 'failure', counts: null });
    assert.equal(config.metadata_json.review_pending, 12);
  }

  console.log('netbox-review-gate.spec.ts OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
