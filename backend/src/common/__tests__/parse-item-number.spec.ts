import * as assert from 'node:assert/strict';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ITEM_NUMBER_MAX, parseItemNumber, referenceNumberOf } from '../parse-item-number';
import { budgetLineReferenceNumbers, parseItemRef } from '../resolve-item-id';

function testBounds() {
  assert.equal(ITEM_NUMBER_MAX, 2147483647);
  assert.equal(parseItemNumber('12'), 12);
  assert.equal(parseItemNumber('0'), 0);
  assert.equal(parseItemNumber('00012'), 12);
  assert.equal(parseItemNumber('2147483647'), 2147483647);
  assert.equal(parseItemNumber('2147483648'), null);
  assert.equal(parseItemNumber('8149356107'), null);
  assert.equal(parseItemNumber('99999999999'), null);
  assert.equal(parseItemNumber(''), null);
  assert.equal(parseItemNumber('12a'), null);
  assert.equal(parseItemNumber('T-12'), null);
  assert.equal(parseItemNumber(null), null);
  assert.equal(parseItemNumber(undefined), null);
  assert.equal(parseItemNumber(' 12 '), 12);
}

function testReferences() {
  assert.deepEqual(parseItemRef('T-12', 'task'), { type: 'item_number', value: 12, prefix: 'T' });
  assert.deepEqual(parseItemRef('00012', 'task'), { type: 'item_number', value: 12 });
  assert.deepEqual(parseItemRef('T-0', 'task'), { type: 'item_number', value: 0, prefix: 'T' });
  assert.throws(() => parseItemRef('T-8149356107', 'task'), NotFoundException);
  assert.throws(() => parseItemRef('8149356107', 'project'), NotFoundException);
  assert.throws(() => parseItemRef('PRJ-2147483648', 'project'), NotFoundException);
  assert.throws(() => parseItemRef('REQ-8149356107', 'request'), NotFoundException);
  assert.throws(() => parseItemRef('DOC-8149356107', 'document'), NotFoundException);
  assert.throws(() => parseItemRef('OPX-8149356107', 'spend'), NotFoundException);
  assert.throws(() => parseItemRef('BL-8149356107', 'capex'), NotFoundException);
  assert.throws(() => parseItemRef('NOPE', 'task'), BadRequestException);
  assert.throws(
    () => parseItemRef('INC-8149356107', 'incident'),
    (err: unknown) => {
      assert.ok(err instanceof NotFoundException);
      assert.equal((err.getResponse() as { code?: string }).code, 'INCIDENT_NOT_FOUND');
      return true;
    },
  );
}

function testBudgetLineReferences() {
  assert.deepEqual(budgetLineReferenceNumbers('BL-12'), { itemNumber: 12, legacyNumber: null });
  assert.deepEqual(budgetLineReferenceNumbers('OPX-12'), { itemNumber: null, legacyNumber: 'OPX-12' });
  assert.deepEqual(budgetLineReferenceNumbers('CPX-0007'), { itemNumber: null, legacyNumber: 'CPX-7' });
  assert.deepEqual(budgetLineReferenceNumbers('0'), { itemNumber: 0, legacyNumber: null });
  assert.deepEqual(budgetLineReferenceNumbers('BL-8149356107'), { itemNumber: null, legacyNumber: null });
  assert.deepEqual(budgetLineReferenceNumbers('OPX-2147483648'), { itemNumber: null, legacyNumber: null });
}

/** A typed reference of one family (a list's quick search, an import cell): its number, or null. */
function testReferenceNumberOf() {
  assert.equal(referenceNumberOf('COMP-3', 'COMP'), 3);
  assert.equal(referenceNumberOf(' comp-3 ', 'COMP'), 3);
  assert.equal(referenceNumberOf('COMP-30', 'COMP'), 30);
  assert.equal(referenceNumberOf('COMP-013', 'COMP'), null, 'a leading zero is no reference of the family');
  assert.equal(referenceNumberOf('DEPT-3', 'COMP'), null, 'another family');
  assert.equal(referenceNumberOf('3', 'COMP'), null, 'bare digits only when asked');
  assert.equal(referenceNumberOf('3', 'COMP', { bare: true }), 3);
  assert.equal(referenceNumberOf('013', 'COMP', { bare: true }), null);
  assert.equal(referenceNumberOf('COMP-', 'COMP', { bare: true }), null);
  assert.equal(referenceNumberOf('COMP-2147483648', 'COMP'), null);
  assert.equal(referenceNumberOf('Acme', 'COMP', { bare: true }), null);
  assert.equal(referenceNumberOf('', 'COMP', { bare: true }), null);
  assert.equal(referenceNumberOf(null, 'COMP', { bare: true }), null);
  assert.equal(referenceNumberOf('REQ-012', 'REQ'), 12, 'a family without the rule keeps its zeros');
}

function main() {
  testBounds();
  testReferenceNumberOf();
  testReferences();
  testBudgetLineReferences();
  console.log('parse-item-number.spec: ok');
}

main();
