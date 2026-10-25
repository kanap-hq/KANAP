import type { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { applicationBadRequest } from '../applications/application-rules';
import { inheritingMembersOf } from '../app-asset-assignments/cluster-assignment-rules';

/** A member taken out of a multi-server list because one of its clusters is in it. */
export type AbsorbedServer = { asset_id: string; name: string; cluster_id: string; cluster_name: string };

/** A 400 refusal coded `connection_same_endpoint` (the message is English for the API; the screen translates `errors:<code>`). */
export function connectionSameEndpointRefusal(): BadRequestException {
  return applicationBadRequest('connection_same_endpoint', 'The source and the destination are the same asset.');
}

/** A 400 refusal coded `connection_min_servers`: a multi-server list keeps at least two assets once absorption is done. */
export function connectionServersMinRefusal(): BadRequestException {
  return applicationBadRequest('connection_min_servers', 'Select at least two assets for a multi-server connection');
}

/**
 * Removes from `assetIds` the in-service members of the in-service clusters of the same list. The
 * input order is kept. A member of two clusters in the list is absorbed once, under the first
 * cluster by name. A retired cluster or a retired member absorbs nothing and stays in the list.
 * No lock: a membership that changes afterwards leaves one extra row at most, which the read
 * deduplicates (the direct row wins).
 */
export async function absorbClusterMembers(
  mg: EntityManager,
  tenantId: string,
  assetIds: readonly string[],
): Promise<{ kept: string[]; absorbed: AbsorbedServer[] }> {
  if (assetIds.length < 2) return { kept: [...assetIds], absorbed: [] };
  const listed = new Set(assetIds);
  const membersByCluster = await inheritingMembersOf(mg, tenantId, assetIds);

  const candidateClusterIds: string[] = [];
  for (const [clusterId, members] of membersByCluster) {
    if (members.some((member) => member.id !== clusterId && listed.has(member.id))) {
      candidateClusterIds.push(clusterId);
    }
  }
  if (candidateClusterIds.length === 0) return { kept: [...assetIds], absorbed: [] };

  // The database orders the clusters by name; the first one that carries a member names it.
  const clusterRows: Array<{ id: string; name: string }> = await mg.query(
    `SELECT id, name
       FROM assets
      WHERE tenant_id = $1 AND id = ANY($2::uuid[])
      ORDER BY name, id`,
    [tenantId, candidateClusterIds],
  );
  const clusterByMember = new Map<string, { id: string; name: string }>();
  const memberNames = new Map<string, string>();
  for (const cluster of clusterRows) {
    for (const member of membersByCluster.get(cluster.id) ?? []) {
      if (member.id === cluster.id || !listed.has(member.id)) continue;
      memberNames.set(member.id, member.name);
      if (!clusterByMember.has(member.id)) clusterByMember.set(member.id, cluster);
    }
  }

  const kept: string[] = [];
  const absorbed: AbsorbedServer[] = [];
  for (const id of assetIds) {
    const cluster = clusterByMember.get(id);
    if (!cluster) {
      kept.push(id);
      continue;
    }
    absorbed.push({
      asset_id: id,
      name: memberNames.get(id) ?? '',
      cluster_id: cluster.id,
      cluster_name: cluster.name,
    });
  }
  return { kept, absorbed };
}
