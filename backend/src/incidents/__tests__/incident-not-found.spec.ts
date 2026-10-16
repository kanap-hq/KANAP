import * as assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import { resolveToUuid } from '../../common/resolve-item-id';
import { IncidentsBaseService } from '../services/incidents-base.service';

// QA lot 14: a missing incident (INC-1 after its deletion) showed "Incident not found" in English
// in every language. The 404 carries a code the interface translates (errors:INCIDENT_NOT_FOUND),
// the same for a missing incident and a confidential one the reader may not see.

async function notFoundResponse(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call();
  } catch (error) {
    assert.ok(error instanceof NotFoundException, String(error));
    return error.getResponse();
  }
  assert.fail('the call should have been refused');
}

const CODED = { code: 'INCIDENT_NOT_FOUND', message: 'Incident not found' };

async function testUnknownReferenceIsCoded(): Promise<void> {
  const manager = { query: async () => [] } as any;
  assert.deepEqual(await notFoundResponse(() => resolveToUuid('INC-1', 'incident', manager)), CODED);
}

async function testMissingOrHiddenIncidentIsCoded(): Promise<void> {
  const ensure = IncidentsBaseService.prototype.ensureIncident;
  const managerOf = (row: unknown) => ({ getRepository: () => ({ findOne: async () => row }) }) as any;
  const id = '00000000-0000-4000-8000-000000000001';

  assert.deepEqual(await notFoundResponse(() => ensure.call({}, id, managerOf(null), 't1')), CODED, 'missing');
  const hidden = { id, tenant_id: 't1', confidential: true, reporter_user_id: 'a', owner_user_id: 'b' };
  assert.deepEqual(
    await notFoundResponse(() => ensure.call({}, id, managerOf(hidden), 't1', { userId: 'c', isAdmin: false })),
    CODED,
    'confidential and hidden from the reader: the same answer',
  );
}

async function run(): Promise<void> {
  await testUnknownReferenceIsCoded();
  await testMissingOrHiddenIncidentIsCoded();
  console.log('incident-not-found.spec: all assertions passed');
}

void run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
