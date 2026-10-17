import * as assert from 'node:assert/strict';
import { compareVersionLabels, sortVersions, versionNumber } from '../version-order';

// The versions of a technology read newest number first, the labels without a number last.

const order = (labels: string[]) => sortVersions(labels.map((label) => ({ label }))).map((v) => v.label);

function testNumbersDescending() {
  assert.deepEqual(order(['8.5', '10.0', '9.0', '11.0', '10.1']), ['11.0', '10.1', '10.0', '9.0', '8.5']);
  assert.deepEqual(order(['2016', '2019', '2012 R2', '2022']), ['2022', '2019', '2016', '2012 R2']);
  assert.deepEqual(order(['9.0.85', '9.0.9', '10', 'v9.1']), ['10', 'v9.1', '9.0.85', '9.0.9']);
}

function testQualifiersAndTies() {
  assert.deepEqual(order(['2016', '2016 SP3', '2017']), ['2017', '2016 SP3', '2016']);
  assert.deepEqual(order(['19c', '21c', '12.2']), ['21c', '19c', '12.2']);
  assert.equal(compareVersionLabels('9', '9.0') !== 0, true, 'a tie keeps a stable order on the label');
  assert.equal(Math.sign(compareVersionLabels('9', '9.0')), -Math.sign(compareVersionLabels('9.0', '9')));
}

function testLabelsWithoutNumberLast() {
  assert.deepEqual(order(['current', '15', 'Beta', 'LTS', '16']), ['16', '15', 'Beta', 'current', 'LTS']);
  assert.deepEqual(order(['SQL Server 2019', '2016']), ['2016', 'SQL Server 2019']);
}

function testVersionNumber() {
  assert.deepEqual(versionNumber('1.0.2zf'), [1, 0, 2]);
  assert.deepEqual(versionNumber(' v3.1 '), [3, 1]);
  assert.equal(versionNumber('LTS'), null);
  assert.equal(versionNumber(''), null);
  assert.equal(versionNumber('99999999999999999999'), null);
}

function main() {
  testNumbersDescending();
  testQualifiersAndTies();
  testLabelsWithoutNumberLast();
  testVersionNumber();
  console.log('version-order.spec: ok');
}

main();
