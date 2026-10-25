import type { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { applicationBadRequest } from '../applications/application-rules';
import { inheritingMembersOf } from '../app-asset-assignments/cluster-assignment-rules';

/** A member taken out of a multi-server list because one of its clusters is in it. */
export type AbsorbedServer = { asset_id: string; name: string; cluster_id: string; cluster_name: string };

/** Refus 400 codé `connection_same_endpoint` (message anglais pour l'API; l'écran traduit `errors:<code>`). */
export function connectionSameEndpointRefusal(): BadRequestException {
  return applicationBadRequest('connection_same_endpoint', 'The source and the destination are the same asset.');
}

/**
 * Retire de `assetIds` les membres en service des clusters en service de la même liste. Ordre
 * d'entrée gardé. Un membre de deux clusters de la liste est absorbé une fois, au nom du premier
 * cluster par nom. Un cluster retiré ou un membre retiré n'absorbe rien et reste dans la liste.
 * Aucun verrou: une appartenance qui change ensuite ne laisse qu'une ligne de trop, que la
 * lecture dédoublonne (la ligne directe gagne).
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
