import type { ClusterMembership, ConnectionMapNode } from './components/ConnectionMapGraph';

/** Les nœuds des liens, plus les membres implicites des clusters qui en font partie. */
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
