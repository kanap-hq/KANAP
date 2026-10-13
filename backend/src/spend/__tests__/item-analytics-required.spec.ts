import * as assert from 'node:assert/strict';
import { AnalyticsAxisInfo, axisRequiredFor } from '../../analytics/analytics-axes.util';
import { missingRequiredDimensions, requiredDimensionMessage } from '../item-analytics.util';

// The required-dimension rule, pure: a dimension is required for a line type when
// it is required, enabled and applies to that type; `missingRequiredDimensions`
// returns those without a non-null value, in the order of the dimensions given,
// from a Map or a plain record.

function axis(id: string, patch: Partial<AnalyticsAxisInfo> = {}): AnalyticsAxisInfo {
  return {
    id,
    code: id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    is_default: false,
    applies_to: null,
    required: true,
    status: 'enabled',
    disabled_at: null,
    sort_order: 1,
    ...patch,
  };
}

function testAxisRequiredFor() {
  assert.equal(axisRequiredFor(axis('menu'), 'opex'), true, 'required, enabled, both types');
  assert.equal(axisRequiredFor(axis('menu'), 'capex'), true);
  assert.equal(axisRequiredFor(axis('menu', { required: false }), 'opex'), false, 'not required');
  assert.equal(axisRequiredFor(axis('menu', { status: 'disabled' }), 'opex'), false, 'a disabled dimension keeps its setting, ignored');
  assert.equal(axisRequiredFor(axis('menu', { applies_to: 'capex' }), 'opex'), false, 'a dimension of the other type');
  assert.equal(axisRequiredFor(axis('menu', { applies_to: 'capex' }), 'capex'), true, 'a dimension of that type');
}

function testMissing() {
  const axes = [
    axis('first'),
    axis('optional', { required: false }),
    axis('disabled', { status: 'disabled' }),
    axis('capex-only', { applies_to: 'capex' }),
    axis('second'),
    axis('opex-only', { applies_to: 'opex' }),
  ];
  const ids = (list: AnalyticsAxisInfo[]) => list.map((item) => item.id);

  assert.deepEqual(ids(missingRequiredDimensions(axes, new Map(), 'opex')), ['first', 'second', 'opex-only'], 'in the order of the dimensions');
  assert.deepEqual(ids(missingRequiredDimensions(axes, {}, 'capex')), ['first', 'capex-only', 'second'], 'the other type');
  assert.deepEqual(
    ids(missingRequiredDimensions(axes, new Map([['first', 'v1'], ['second', null], ['opex-only', undefined]]), 'opex')),
    ['second', 'opex-only'],
    'null and undefined count as missing',
  );
  assert.deepEqual(
    ids(missingRequiredDimensions(axes, { first: 'v1', second: 'v2', 'opex-only': 'v3' }, 'opex')),
    [],
    'a record with every required value',
  );
  assert.deepEqual(ids(missingRequiredDimensions(axes, { first: '' }, 'opex')), ['first', 'second', 'opex-only'], 'an empty id is no value');
  assert.deepEqual(ids(missingRequiredDimensions([], {}, 'opex')), [], 'no dimension');
}

function testMessage() {
  assert.equal(requiredDimensionMessage({ name: 'Menu' }), 'The Menu dimension is required. Choose a value.');
  assert.equal(requiredDimensionMessage({ name: null }), 'The analytics dimension is required. Choose a value.', 'the unnamed default');
}

function main() {
  testAxisRequiredFor();
  testMissing();
  testMessage();
  console.log('item-analytics-required.spec: ok');
}

main();
