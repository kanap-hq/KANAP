import * as assert from 'node:assert/strict';
import { AccessTree, ancestorIds, subtreeIds } from '../data-access-tree';

/**
 * Data-scoped access, lot 6 (planning/data-scoped-access/spec.md §7.2): the tree unfolding stops
 * on a cycle, no database. The application refuses a cycle (`cost-center-tree.util.ts`) and the
 * SQL function unfolds with `UNION`, but a corrupted `parent_id` row must not loop the API process:
 * before the `visited` sets, `ancestorIds` grew forever and exhausted the heap.
 */

/** Two groups naming each other as parent: a <-> b. */
function twoNodeCycle(): AccessTree {
  return {
    companies: new Map(),
    centers: new Map([
      ['a', { id: 'a', code: 'A', name: 'Group A', kind: 'group', company_id: null, parent_id: 'b' }],
      ['b', { id: 'b', code: 'B', name: 'Group B', kind: 'group', company_id: null, parent_id: 'a' }],
    ]),
    children: new Map([['a', ['b']], ['b', ['a']]]),
  };
}

function testSubtreeStopsOnCycle(): void {
  const tree = twoNodeCycle();
  assert.deepEqual(subtreeIds(tree, 'a').sort(), ['a', 'b'], 'each node once, then stop');
  assert.deepEqual(subtreeIds(tree, 'b').sort(), ['a', 'b'], 'from the other side too');
  console.log('  subtreeIds on a two-node cycle returns each node once: OK');
}

function testAncestorsStopOnCycle(): void {
  const tree = twoNodeCycle();
  assert.deepEqual(ancestorIds(tree, 'a'), ['b'], 'the parent, then the cycle stops before the node itself');
  assert.deepEqual(ancestorIds(tree, 'b'), ['a']);
  console.log('  ancestorIds on a two-node cycle returns the parents once and stops: OK');
}

function testAcyclicTreeUnchanged(): void {
  const tree: AccessTree = {
    companies: new Map(),
    centers: new Map([
      ['g1', { id: 'g1', code: 'G1', name: 'Group 1', kind: 'group', company_id: null, parent_id: null }],
      ['g2', { id: 'g2', code: 'G2', name: 'Group 2', kind: 'group', company_id: null, parent_id: 'g1' }],
      ['k1', { id: 'k1', code: 'K1', name: 'Centre 1', kind: 'cost_center', company_id: null, parent_id: 'g2' }],
    ]),
    children: new Map([['g1', ['g2']], ['g2', ['k1']]]),
  };
  assert.deepEqual(subtreeIds(tree, 'g1'), ['g1', 'g2', 'k1']);
  assert.deepEqual(ancestorIds(tree, 'k1'), ['g2', 'g1']);
  console.log('  an acyclic tree still unfolds in tree order: OK');
}

testSubtreeStopsOnCycle();
testAncestorsStopOnCycle();
testAcyclicTreeUnchanged();
console.log('data-access-tree-cycle.spec: ok');
