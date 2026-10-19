import * as assert from 'node:assert/strict';
import { attachFrozenByNames, lookupUserNames, personName } from '../freeze-actor';

function testPersonNameSkipsABlankName() {
  assert.equal(personName({ first_name: 'Claude', last_name: 'Test' }), 'Claude Test');
  assert.equal(personName({ first_name: ' Claude ', last_name: '' }), 'Claude');
  assert.equal(personName({ first_name: '  ', last_name: ' ' }), null);
  assert.equal(personName({ first_name: null, last_name: null }), null);
  assert.equal(personName(null), null);
}

function testAttachFrozenByNamesKeepsTheIdAndAddsTheName() {
  const id = 'ad63ce51-d2a4-44d8-8f57-4129cb2eeb5a';
  const slot = { frozen: false, frozenAt: null as Date | null, frozenBy: null as string | null };
  const summary = {
    year: 2026,
    scopes: {
      opex: { budget: { ...slot, frozen: true, frozenBy: id, frozenAt: new Date('2026-10-19T10:00:00.000Z') } },
      capex: { budget: { ...slot } },
      companies: { ...slot, frozen: true, frozenBy: id, frozenAt: new Date('2026-10-19T10:00:00.000Z') },
      departments: { ...slot, frozen: true, frozenBy: 'nobody' },
    },
  };
  const named = attachFrozenByNames(summary, new Map([[id, 'Claude Test']]));
  assert.equal(named.scopes.companies.frozenBy, id);
  assert.equal(named.scopes.companies.frozenByName, 'Claude Test');
  assert.equal(named.scopes.opex.budget.frozenByName, 'Claude Test');
  assert.equal(named.scopes.departments.frozenByName, null);
  assert.equal(named.scopes.capex.budget.frozenByName, null);
  assert.equal(summary.scopes.companies.frozenBy, id);
}

async function testLookupUserNamesUsesTheRequestManager() {
  const seen: unknown[] = [];
  const manager = {
    getRepository: () => ({
      find: async (opts: unknown) => {
        seen.push(opts);
        return [
          { id: 'u1', first_name: 'Claude', last_name: 'Test' },
          { id: 'u2', first_name: ' ', last_name: '' },
        ];
      },
    }),
  };
  const names = await lookupUserNames(['u1', 'u2', null, 'u1'], manager as any);
  assert.equal(names.get('u1'), 'Claude Test');
  assert.equal(names.has('u2'), false);
  assert.equal(seen.length, 1);
}

async function main() {
  testPersonNameSkipsABlankName();
  testAttachFrozenByNamesKeepsTheIdAndAddsTheName();
  await testLookupUserNamesUsesTheRequestManager();
  console.log('freeze-actor.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
