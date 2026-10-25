import { describe, expect, it } from 'vitest';
import type { ConnectionMapNode } from './components/ConnectionMapGraph';
import { withImplicitMembers } from './connectionMapMembers';

function node(id: string, extra: Partial<ConnectionMapNode> = {}): ConnectionMapNode {
  return {
    id,
    name: id,
    kind: 'server',
    environment: 'prod',
    networkSegment: null,
    hostingCategory: null,
    ...extra,
  };
}

const CLUSTER = node('cl-1', { kind: 'cluster', isCluster: true });

describe('withImplicitMembers', () => {
  it('adds the implicit members of a drawn cluster, in the order of the nodes', () => {
    const nodes = [CLUSTER, node('m-1', { implicitMember: true }), node('m-2', { implicitMember: true }), node('other')];
    const kept = withImplicitMembers(
      nodes,
      new Set(['cl-1']),
      [{ cluster_id: 'cl-1', server_id: 'm-2' }, { cluster_id: 'cl-1', server_id: 'm-1' }],
    );
    expect(kept.map((n) => n.id)).toEqual(['cl-1', 'm-1', 'm-2']);
  });

  it('keeps a member named by another connection once, even when its cluster is not drawn', () => {
    const nodes = [CLUSTER, node('m-1')];
    const kept = withImplicitMembers(
      nodes,
      new Set(['m-1']),
      [{ cluster_id: 'cl-1', server_id: 'm-1' }],
    );
    expect(kept.map((n) => n.id)).toEqual(['m-1']);
  });

  it('adds nothing for a cluster without member', () => {
    const nodes = [CLUSTER, node('other')];
    const kept = withImplicitMembers(nodes, new Set(['cl-1', 'other']), []);
    expect(kept.map((n) => n.id)).toEqual(['cl-1', 'other']);
  });

  it('drops an implicit member whose cluster is not drawn', () => {
    const nodes = [CLUSTER, node('m-1', { implicitMember: true })];
    const kept = withImplicitMembers(
      nodes,
      new Set(['other']),
      [{ cluster_id: 'cl-1', server_id: 'm-1' }],
    );
    expect(kept).toEqual([]);
  });
});
