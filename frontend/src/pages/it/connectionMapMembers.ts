import type { ClusterMembership, ConnectionMapLink, ConnectionMapNode } from './components/ConnectionMapGraph';

/** The link nodes, plus the implicit members of the clusters they belong to. */
export function withImplicitMembers(
  allNodes: ConnectionMapNode[],
  linkNodeIds: ReadonlySet<string>,
  memberships: ClusterMembership[],
): ConnectionMapNode[] {
  const drawnMembers = new Set(
    memberships
      .filter((membership) => linkNodeIds.has(membership.cluster_id))
      .map((membership) => membership.server_id),
  );
  return allNodes.filter(
    (node) => linkNodeIds.has(node.id) || (!!node.implicitMember && drawnMembers.has(node.id)),
  );
}

export const MEMBER_FOLD_LIMIT = 10;

/** Folds, per drawn cluster, the implicit members beyond `limit`. */
export function foldMembers(
  graph: { nodes: ConnectionMapNode[]; links: ConnectionMapLink[] },
  memberships: ClusterMembership[],
  rootIds: readonly string[],
  hiddenLabel: (count: number) => string,
  limit = MEMBER_FOLD_LIMIT,
): { nodes: ConnectionMapNode[]; memberships: ClusterMembership[] } {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const rootSet = new Set(rootIds);

  const membersByCluster = new Map<string, ClusterMembership[]>();
  const clustersByMember = new Map<string, Set<string>>();
  memberships.forEach((membership) => {
    if (!nodeById.has(membership.cluster_id) || !nodeById.has(membership.server_id)) return;
    const members = membersByCluster.get(membership.cluster_id) ?? [];
    members.push(membership);
    membersByCluster.set(membership.cluster_id, members);
    const clusters = clustersByMember.get(membership.server_id) ?? new Set<string>();
    clusters.add(membership.cluster_id);
    clustersByMember.set(membership.server_id, clusters);
  });

  const foldedByCluster = new Map<string, Set<string>>();
  const hiddenByCluster = new Map<string, number>();

  graph.nodes.forEach((cluster) => {
    if (cluster.kind !== 'cluster') return;
    const members = membersByCluster.get(cluster.id) ?? [];
    if (members.length <= limit) return;
    const mandatory = members.filter(
      (membership) => !nodeById.get(membership.server_id)?.implicitMember || rootSet.has(membership.server_id),
    );
    const optional = members.filter(
      (membership) => nodeById.get(membership.server_id)?.implicitMember && !rootSet.has(membership.server_id),
    );
    const folded = optional.slice(Math.max(0, limit - mandatory.length));
    if (folded.length === 0) return;
    const foldedIds = new Set(folded.map((membership) => membership.server_id));
    foldedByCluster.set(cluster.id, foldedIds);
    hiddenByCluster.set(cluster.id, foldedIds.size);
  });

  if (foldedByCluster.size === 0) {
    return { nodes: graph.nodes, memberships };
  }

  // A member folded in one cluster stays when another cluster still shows it.
  const removedMembers = new Set<string>();
  foldedByCluster.forEach((folded, clusterId) => {
    folded.forEach((serverId) => {
      const clusters = clustersByMember.get(serverId) ?? new Set<string>();
      if (clusters.size > 0 && Array.from(clusters).every((id) => foldedByCluster.get(id)?.has(serverId))) {
        removedMembers.add(serverId);
      }
    });
  });

  const nodes = graph.nodes
    .filter((node) => !removedMembers.has(node.id))
    .map((node) => {
      const hidden = hiddenByCluster.get(node.id);
      return hidden === undefined
        ? node
        : { ...node, hiddenMembers: hidden, hiddenMembersLabel: hiddenLabel(hidden) };
    });
  const keptMemberships = memberships.filter(
    (membership) => !foldedByCluster.get(membership.cluster_id)?.has(membership.server_id),
  );
  return { nodes, memberships: keptMemberships };
}
