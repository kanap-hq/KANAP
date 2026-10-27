import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { accountDisplayText } from '../spend-summary.builder';

/**
 * The label lists and forms share. An empty name is the number alone: the
 * CAPEX list used to interpolate a missing name as "612100 - null".
 */
function testNameAndNumber() {
  assert.equal(accountDisplayText(612100, 'Name'), '612100 - Name');
  assert.equal(accountDisplayText('612100', 'Name'), '612100 - Name');
}

function testMissingNameIsTheNumber() {
  assert.equal(accountDisplayText(612100, ''), '612100');
  assert.equal(accountDisplayText(612100, null), '612100');
  assert.equal(accountDisplayText(612100, undefined), '612100');
}

function testSpacesStay() {
  // The list SQL treats only '' as missing (`budget-list.config.ts`).
  assert.equal(accountDisplayText(612100, ' '), '612100 -  ');
}

function run() {
  testNameAndNumber();
  testMissingNameIsTheNumber();
  testSpacesStay();
  console.log('account-display-text: ok');
}

run();
