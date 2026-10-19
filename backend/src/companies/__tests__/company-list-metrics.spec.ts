import * as assert from 'node:assert/strict';
import { companyListMetric } from '../company-list-metrics';

function testAbsentMetricStaysNull() {
  assert.equal(companyListMetric(null), null);
  assert.equal(companyListMetric(undefined), null);
  assert.equal(companyListMetric(''), null);
  assert.equal(companyListMetric('nope'), null);
}

function testPresentMetricKeepsZeroAndDecimals() {
  assert.equal(companyListMetric(0), 0);
  assert.equal(companyListMetric('0'), 0);
  assert.equal(companyListMetric(12.5), 12.5);
  assert.equal(companyListMetric('12.500'), 12.5);
  assert.equal(companyListMetric('1200'), 1200);
}

function main() {
  testAbsentMetricStaysNull();
  testPresentMetricKeepsZeroAndDecimals();
  console.log('company-list-metrics.spec: ok');
}

main();
