import { describe, expect, it } from 'vitest';
import type { ClusterMembership, ConnectionMapLink, ConnectionMapNode } from './components/ConnectionMapGraph';
import { foldMembers, withImplicitMembers } from './connectionMapMembers';

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

const GRAPH_LINKS: ConnectionMapLink[] = [];

function clusterNode(id: string): ConnectionMapNode {
  return node(id, { kind: 'cluster', isCluster: true });
}

function implicitMembers(prefix: string, count: number): ConnectionMapNode[] {
  return Array.from({ length: count }, (_, index) => node(`${prefix}-${index + 1}`, { implicitMember: true }));
}

function pairs(clusterId: string, members: ConnectionMapNode[]): ClusterMembership[] {
  return members.map((member) => ({ cluster_id: clusterId, server_id: member.id }));
}

function graphOf(nodes: ConnectionMapNode[]) {
  return { nodes, links: GRAPH_LINKS };
}

describe('foldMembers', () => {
  it('does not fold exactly ten implicit members', () => {
    const members = implicitMembers('m', 10);
    const graph = graphOf([clusterNode('cl-1'), ...members]);
    const result = foldMembers(graph, pairs('cl-1', members), [], (count) => `${count} hidden`, 10);
    expect(result.nodes).toBe(graph.nodes);
    expect(result.memberships).toHaveLength(10);
    expect(result.nodes[0].hiddenMembers).toBeUndefined();
  });

  it('keeps ten and hides two of twelve implicit members', () => {
    const members = implicitMembers('m', 12);
    const graph = graphOf([clusterNode('cl-1'), ...members]);
    const result = foldMembers(graph, pairs('cl-1', members), [], (count) => `${count} hidden`, 10);
    expect(result.nodes.map((entry) => entry.id)).toEqual(['cl-1', ...members.slice(0, 10).map((entry) => entry.id)]);
    expect(result.nodes[0]).toMatchObject({ hiddenMembers: 2, hiddenMembersLabel: '2 hidden' });
    expect(result.memberships.map((entry) => entry.server_id)).toEqual(members.slice(0, 10).map((entry) => entry.id));
  });

  it('keeps a named member beyond the limit', () => {
    const members = implicitMembers('m', 11);
    const named = node('m-12');
    const graph = graphOf([clusterNode('cl-1'), ...members, named]);
    const result = foldMembers(graph, pairs('cl-1', [...members, named]), [], (count) => `${count} hidden`, 10);
    expect(result.nodes.map((entry) => entry.id)).toContain('m-12');
    expect(result.nodes.map((entry) => entry.id)).not.toContain('m-10');
    expect(result.nodes.map((entry) => entry.id)).not.toContain('m-11');
    expect(result.nodes[0].hiddenMembers).toBe(2);
  });

  it('shows a folded member taken as a start', () => {
    const members = implicitMembers('m', 12);
    const graph = graphOf([clusterNode('cl-1'), ...members]);
    const result = foldMembers(graph, pairs('cl-1', members), ['m-12'], (count) => `${count} hidden`, 10);
    expect(result.nodes.map((entry) => entry.id)).toContain('m-12');
    expect(result.nodes.map((entry) => entry.id)).not.toContain('m-10');
    expect(result.nodes.map((entry) => entry.id)).not.toContain('m-11');
    expect(result.nodes[0].hiddenMembers).toBe(2);
  });

  it('keeps a member shared by two clusters when one still shows it', () => {
    const clusterAMembers = [...implicitMembers('a', 11), node('shared', { implicitMember: true })];
    const clusterBMembers = [node('shared', { implicitMember: true }), node('b-1', { implicitMember: true }), node('b-2', { implicitMember: true })];
    const graph = graphOf([clusterNode('cl-a'), clusterNode('cl-b'), ...clusterAMembers, node('b-1', { implicitMember: true }), node('b-2', { implicitMember: true })]);
    const memberships = [...pairs('cl-a', clusterAMembers), ...pairs('cl-b', clusterBMembers)];
    const result = foldMembers(graph, memberships, [], (count) => `${count} hidden`, 10);
    expect(result.nodes.map((entry) => entry.id)).toContain('shared');
    expect(result.nodes.map((entry) => entry.id)).not.toContain('a-11');
    expect(result.nodes[0].hiddenMembers).toBe(2);
    expect(result.nodes[1].hiddenMembers).toBeUndefined();
    expect(result.memberships).toContainEqual({ cluster_id: 'cl-b', server_id: 'shared' });
    expect(result.memberships).not.toContainEqual({ cluster_id: 'cl-a', server_id: 'shared' });
  });

  it('removes a shared member folded by both clusters', () => {
    const clusterAMembers = [...implicitMembers('a', 11), node('shared', { implicitMember: true })];
    const clusterBMembers = [...implicitMembers('b', 11), node('shared', { implicitMember: true })];
    const graph = graphOf([
      clusterNode('cl-a'), clusterNode('cl-b'), ...clusterAMembers, ...implicitMembers('b', 11),
    ]);
    const memberships = [...pairs('cl-a', clusterAMembers), ...pairs('cl-b', clusterBMembers)];
    const result = foldMembers(graph, memberships, [], (count) => `${count} hidden`, 10);
    expect(result.nodes.map((entry) => entry.id)).not.toContain('shared');
    expect(result.memberships.some((entry) => entry.server_id === 'shared')).toBe(false);
    expect(result.nodes[0].hiddenMembers).toBe(2);
    expect(result.nodes[1].hiddenMembers).toBe(2);
  });

  it('folds two clusters independently', () => {
    const first = implicitMembers('a', 12);
    const second = implicitMembers('b', 13);
    const graph = graphOf([clusterNode('cl-a'), clusterNode('cl-b'), ...first, ...second]);
    const result = foldMembers(graph, [...pairs('cl-a', first), ...pairs('cl-b', second)], [], (count) => `${count} hidden`, 10);
    expect(result.nodes[0]).toMatchObject({ hiddenMembers: 2, hiddenMembersLabel: '2 hidden' });
    expect(result.nodes[1]).toMatchObject({ hiddenMembers: 3, hiddenMembersLabel: '3 hidden' });
    expect(result.nodes).toHaveLength(2 + 10 + 10);
  });
});
