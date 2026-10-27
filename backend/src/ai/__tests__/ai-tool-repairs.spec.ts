import * as assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import {
  takeRepairedToolFailures,
  toolCallTargets,
  toolFailureKind,
  type AiRepairableToolFailure,
} from '../ai-tool-repairs';

// A failed tool call is repaired when a later call of the same tool succeeds on the same target in
// the same turn, after an input error (essay of 2026-10-27, question 6: create_document refused
// `applications: "APP-36"`, then succeeded with two arguments changed).

function testFailureKinds() {
  assert.equal(toolFailureKind(new NotFoundException('No application found matching "APP-36".')), 'input');
  assert.equal(toolFailureKind(new BadRequestException('Invalid input for create_document: title is required.')), 'input');
  assert.equal(toolFailureKind(new ForbiddenException('You need the right to modify applications.')), 'denied');
  assert.equal(toolFailureKind(Object.assign(new Error('permission denied for table spend_items'), { code: '42501' })), 'denied', 'a data access refusal');
  assert.equal(toolFailureKind(new InternalServerErrorException('boom')), 'server');
  assert.equal(toolFailureKind(new Error('connection terminated')), 'server');
}

function testTargets() {
  assert.deepEqual(toolCallTargets({ ref: ' APP-36 ', title: 'Runbook' }), ['app-36'], 'the reference first');
  assert.deepEqual(toolCallTargets({ title: 'Recovery runbook', applications: 'APP-36' }), ['recovery runbook'], 'the title of a creation');
  assert.deepEqual(toolCallTargets({ entity_type: 'projects', fields: { name: 'ERP rollout' } }), ['erp rollout']);
  assert.deepEqual(toolCallTargets({ entity_type: 'spend_items', filters: {} }), ['spend_items'], 'a read: its family');
  assert.deepEqual(toolCallTargets({ query: 'FR-TRV-600' }), [''], 'no target: the tool itself');
}

function testRepairs() {
  // The essay: same tool, same title, two arguments changed.
  const failures: AiRepairableToolFailure[] = [
    { id: 'tc-1', name: 'create_document', targets: toolCallTargets({ title: 'Recovery runbook', applications: 'APP-36', assets: 'AST-3' }) },
  ];
  assert.deepEqual(
    takeRepairedToolFailures(failures, {
      name: 'create_document',
      args: { title: 'Recovery runbook', applications: 'CheeseTrack', assets: 'srv-cheese-01' },
      result: { preview_id: 'p-1', target: { entity_type: 'documents', entity_id: null, ref: null, title: 'Recovery runbook' } },
    }),
    ['tc-1'],
  );
  assert.equal(failures.length, 0, 'a repaired failure is taken out');

  // Same tool, another target: a real failure.
  const other: AiRepairableToolFailure[] = [{ id: 'tc-1', name: 'create_document', targets: ['runbook app-36'] }];
  assert.deepEqual(takeRepairedToolFailures(other, { name: 'create_document', args: { title: 'Runbook APP-37' }, result: { preview_id: 'p-2' } }), []);
  assert.equal(other.length, 1);

  // Another tool repairs nothing; a failed retry repairs nothing.
  assert.deepEqual(takeRepairedToolFailures(other, { name: 'update_business_record', args: { ref: 'Runbook APP-36' }, result: { preview_id: 'p-3' } }), []);
  assert.deepEqual(takeRepairedToolFailures(other, { name: 'create_document', args: { title: 'Runbook APP-36' }, result: { error: 'Again.' } }), []);

  // A reference refused by name, then the same record by reference: the preview names it.
  const byName: AiRepairableToolFailure[] = [{ id: 'tc-4', name: 'update_business_record', targets: toolCallTargets({ ref: 'CheeseTrack', fields: { status: 'disabled' } }) }];
  assert.deepEqual(takeRepairedToolFailures(byName, {
    name: 'update_business_record',
    args: { ref: 'APP-36', fields: { status: 'disabled' } },
    result: { preview_id: 'p-4', target: { entity_type: 'applications', entity_id: 'a-36', ref: 'APP-36', title: 'CheeseTrack' } },
  }), ['tc-4']);

  // A read: the detail by name refused, then by reference; the record it returned names it.
  const read: AiRepairableToolFailure[] = [{ id: 'tc-7', name: 'get_entity_detail', targets: toolCallTargets({ entity_type: 'applications', entity_id: 'CheeseTrack' }) }];
  assert.deepEqual(takeRepairedToolFailures(read, {
    name: 'get_entity_detail',
    args: { entity_type: 'applications', entity_id: 'APP-36' },
    result: { entity: { type: 'applications', id: 'a-36', ref: 'APP-36', label: 'CheeseTrack' } },
  }), ['tc-7']);

  // Several attempts, and arguments that were not JSON (no target: any).
  const several: AiRepairableToolFailure[] = [
    { id: 'tc-5', name: 'create_document', targets: null },
    { id: 'tc-6', name: 'create_document', targets: ['recovery runbook'] },
  ];
  assert.deepEqual(takeRepairedToolFailures(several, { name: 'create_document', args: { title: 'Recovery runbook' }, result: { preview_id: 'p-5' } }), ['tc-5', 'tc-6']);
}

testFailureKinds();
testTargets();
testRepairs();
console.log('ai-tool-repairs.spec: ok');
