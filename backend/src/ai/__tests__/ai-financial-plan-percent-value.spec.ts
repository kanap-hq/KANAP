import * as assert from 'node:assert/strict';
import { percentValue } from '../mutation/ai-financial-plan-mutation-support.service';

/**
 * A percentage of a manual split as a model may write it. Every percent sign goes, not only the
 * first (CodeQL js/incomplete-sanitization): "60 %%" reads as 60, like "60 %".
 */
function testPercentValue() {
  assert.equal(percentValue(60, 'pct'), 60);
  assert.equal(percentValue('60', 'pct'), 60);
  assert.equal(percentValue('60 %', 'pct'), 60);
  assert.equal(percentValue('60,5 %', 'pct'), 60.5);
  assert.equal(percentValue('60 %%', 'pct'), 60);
  assert.equal(percentValue('%60%', 'pct'), 60);
  assert.throws(() => percentValue('sixty', 'pct'), /pct must be a number/);
}

testPercentValue();
console.log('ai-financial-plan-percent-value.spec: ok');
