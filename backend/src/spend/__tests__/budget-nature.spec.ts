import * as assert from 'node:assert/strict';
import { assertScopeNatures, BudgetNature } from '../budget-nature';

assert.doesNotThrow(() => assertScopeNatures('test', [{ table: 'spend_items', allNatures: true }], (s) => s.table));
assert.doesNotThrow(() => assertScopeNatures('test', [{ table: 'spend_items', nature: 'opex' }], (s) => s.table));
const unmarked: { table: string; nature?: BudgetNature }[] = [{ table: 'spend_items' }];
assert.throws(() => assertScopeNatures('test', unmarked, (s) => s.table), /without a nature/);
assert.throws(() => assertScopeNatures('test', [{ table: 'spend_items', allNatures: false }], (s) => s.table), /without a nature/);
console.log('budget-nature.spec: 4 checks passed');
