import * as assert from 'node:assert/strict';
import { NetboxConfigService, readSyncState } from '../netbox-config.service';
import { NETBOX_ERROR_MESSAGES, netboxBadRequest } from '../netbox-errors';
import { NetboxSyncService } from '../netbox-sync.service';
import { NetboxApiError } from '../netbox.types';

// A failed run stores a stable code in the configuration metadata. The page
// translates that code. A state written before codes existed keeps its text.

const LEAK = /ECONNREFUSED|10\.0\.0\.5|ETIMEDOUT/;

function harness() {
  const row: { metadata_json: Record<string, unknown> } = { metadata_json: {} };
  const manager = {
    getRepository: () => ({
      findOne: async () => row,
      save: async (entity: unknown) => entity,
    }),
  };
  const source = {
    createQueryRunner: () => ({
      connect: async () => undefined,
      startTransaction: async () => undefined,
      commitTransaction: async () => undefined,
      rollbackTransaction: async () => undefined,
      release: async () => undefined,
      isTransactionActive: true,
      query: async () => undefined,
      manager,
    }),
  };
  const config = new NetboxConfigService({ canEncrypt: () => true } as never);
  const service = new NetboxSyncService(
    source as never,
    config,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { row, service };
}

async function failWith(error: unknown) {
  const { row, service } = harness();
  (service as unknown as { executeRun: () => Promise<never> }).executeRun = async () => {
    throw error;
  };
  const lock = { query: async () => undefined, release: async () => undefined };
  const result = await (service as unknown as {
    runLocked: (tenantId: string, trigger: 'manual', runner: unknown, startedAt: Date) => Promise<{ status: string; error?: string }>;
  }).runLocked('tenant-1', 'manual', lock, new Date('2026-10-27T10:00:00.000Z'));
  const stored = row.metadata_json.sync_state as { error?: string; error_code?: string; status?: string };
  return { result, stored, read: readSyncState(row.metadata_json) };
}

async function main(): Promise<void> {
  {
    const { result, stored, read } = await failWith(new Error('connect ECONNREFUSED 10.0.0.5:8999'));
    assert.equal(result.status, 'failure');
    assert.equal(result.error, NETBOX_ERROR_MESSAGES.netbox_sync_failed);
    assert.equal(stored.status, 'failure');
    assert.equal(stored.error_code, 'netbox_sync_failed');
    assert.equal(stored.error, NETBOX_ERROR_MESSAGES.netbox_sync_failed);
    assert.doesNotMatch(stored.error || '', LEAK);
    assert.equal(read.error_code, 'netbox_sync_failed');
    assert.equal(read.error, NETBOX_ERROR_MESSAGES.netbox_sync_failed);
  }

  {
    const { stored, read } = await failWith(new NetboxApiError(
      'timeout',
      'The Netbox server did not answer within 30 seconds. ETIMEDOUT 10.0.0.5:443',
    ));
    assert.equal(stored.error_code, 'netbox_timeout');
    assert.equal(stored.error, NETBOX_ERROR_MESSAGES.netbox_timeout);
    assert.doesNotMatch(stored.error || '', LEAK);
    assert.equal(read.error_code, 'netbox_timeout');
  }

  {
    const { stored } = await failWith(netboxBadRequest('netbox_token_missing'));
    assert.equal(stored.error_code, 'netbox_token_missing');
    assert.equal(stored.error, NETBOX_ERROR_MESSAGES.netbox_token_missing);
  }

  // An earlier build stored the English sentence and no code. The page keeps it.
  {
    const sentence = 'The synchronisation could not finish. Check the Netbox connection, then try again.';
    const read = readSyncState({
      sync_state: {
        status: 'failure',
        trigger: 'manual',
        started_at: '2026-09-19T08:00:00.000Z',
        finished_at: '2026-09-19T08:00:12.000Z',
        duration_ms: 12000,
        counts: null,
        error: sentence,
      },
    });
    assert.equal(read.error_code, null);
    assert.equal(read.error, sentence);
  }

  {
    const read = readSyncState({
      sync_state: {
        status: 'failure',
        error: 'Kept as written.',
        error_code: 'not_a_netbox_code',
      },
    });
    assert.equal(read.error_code, null);
    assert.equal(read.error, 'Kept as written.');
  }

  // A run still marked running two hours later stopped without finishing.
  {
    const started = '2026-10-27T08:00:00.000Z';
    const now = Date.parse(started) + 2 * 60 * 60 * 1000;
    const read = readSyncState({
      sync_state: {
        status: 'running',
        trigger: 'scheduled',
        started_at: started,
        finished_at: null,
        error: null,
        error_code: null,
      },
    }, now);
    assert.equal(read.status, 'failure');
    assert.equal(read.error_code, 'netbox_sync_interrupted');
    assert.equal(read.error, NETBOX_ERROR_MESSAGES.netbox_sync_interrupted);
    assert.equal(read.trigger, 'scheduled');
    assert.equal(read.started_at, started);
  }

  // Under an hour, the same row is still a run in progress.
  {
    const started = '2026-10-27T08:00:00.000Z';
    const now = Date.parse(started) + 30 * 60 * 1000;
    const read = readSyncState({
      sync_state: { status: 'running', trigger: 'manual', started_at: started },
    }, now);
    assert.equal(read.status, 'running');
    assert.equal(read.error_code, null);
    assert.equal(read.error, null);
  }
}

main().then(() => console.log('netbox-sync-failure.spec.ts OK')).catch((error) => {
  console.error(error);
  process.exit(1);
});
