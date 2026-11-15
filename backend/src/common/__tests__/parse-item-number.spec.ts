import * as assert from 'node:assert/strict';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ITEM_NUMBER_MAX, parseItemNumber, parseReferenceNumber } from '../parse-item-number';
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
function testParseReferenceNumber() {
  const typed = { prefixRequired: true };
  assert.equal(parseReferenceNumber('COMP-3', 'COMP', typed), 3);
  assert.equal(parseReferenceNumber(' comp-3 ', 'COMP', typed), 3);
  assert.equal(parseReferenceNumber('COMP-30', 'COMP', typed), 30);
  assert.equal(parseReferenceNumber('COMP-013', 'COMP', typed), null, 'a leading zero is no reference of the family');
  assert.equal(parseReferenceNumber('DEPT-3', 'COMP', typed), null, 'another family');
  assert.equal(parseReferenceNumber('3', 'COMP', typed), null, 'bare digits only when no prefix is required');
  assert.equal(parseReferenceNumber('3', 'COMP'), 3);
  assert.equal(parseReferenceNumber('013', 'COMP'), null);
  assert.equal(parseReferenceNumber('COMP-', 'COMP'), null);
  assert.equal(parseReferenceNumber('COMP-2147483648', 'COMP'), null);
  assert.equal(parseReferenceNumber('Acme', 'COMP'), null);
  assert.equal(parseReferenceNumber('', 'COMP'), null);
  assert.equal(parseReferenceNumber(null, 'COMP'), null);
  assert.equal(parseReferenceNumber('REQ-012', 'REQ', typed), 12, 'a family without the rule keeps its zeros');
}

function main() {
  testBounds();
  testParseReferenceNumber();
  testReferences();
  testBudgetLineReferences();
  console.log('parse-item-number.spec: ok');
}

main();
