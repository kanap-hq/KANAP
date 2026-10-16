import * as assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { RecordInUseException, refusalDetails } from '../record-in-use';

// A bulk delete's failed item always carries a code the interface translates (`errors:<code>`),
// so no English or driver message reaches a user in another language: the refusals keep theirs,
// a record gone meanwhile is `not_found`, and a database refusal its mapped code with the mapped
// English sentence in place of the driver's.

function databaseError(sqlState: string, query: string): QueryFailedError {
  const driverError = Object.assign(new Error('update or delete on table "x" violates foreign key constraint "fk" on table "y"'), { code: sqlState });
  return new QueryFailedError(query, [], driverError);
}

function testRefusalKeepsItsCode() {
  const refusal = new RecordInUseException('SUPPLIER_IN_USE', 'supplier', 'Acme', [{ type: 'contracts', total: 2 }]);
  assert.deepEqual(refusalDetails(refusal), { code: 'SUPPLIER_IN_USE', usages: [{ type: 'contracts', total: 2 }] });
}

function testRecordGoneIsNotFound() {
  assert.deepEqual(refusalDetails(new NotFoundException('Application not found')), { code: 'not_found' });
}

function testDatabaseRefusalIsMapped() {
  const details = refusalDetails(databaseError('23503', 'DELETE FROM "applications" WHERE "id" = $1'));
  assert.equal(details.code, 'in_use');
  assert.ok(details.reason && !/violates|constraint/.test(details.reason), `the mapped sentence, got ${details.reason}`);
}

function testUnknownErrorHasNoCode() {
  assert.deepEqual(refusalDetails(new Error('boom')), {});
}

for (const test of [testRefusalKeepsItsCode, testRecordGoneIsNotFound, testDatabaseRefusalIsMapped, testUnknownErrorHasNoCode]) {
  test();
}
console.log('refusal-details.spec: ok');
