import { ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { AuditService, AuditSourceOptions } from '../audit/audit.service';
import { inheritedClustersOf, inheritingMembersOf, type ClusterRef } from '../app-asset-assignments/cluster-assignment-rules';
import { assetInServiceSql } from '../technologies/technology-reach.service';

/**
 * The placement of a virtual machine carried by a cluster (clusters pass, lot C1b), shared by
 * every writer of an `asset_relations` `contains` link, inside the transaction of its write:
 * - R1: a `contains` written by a cluster replaces the `contains` of its members in service
 *   towards the same assets (absorption), one audit entry per host that loses a link;
 * - R2: a `contains` written by a host in service towards an asset one of its clusters in service
 *   already contains is refused (`placement_inherited`, 409, `cluster`: the cluster's name).
 *   A link already stored is written again without a refusal;
 * - R3: the other double containers are only reported (`doubleContainersOf`), never refused:
 *   a retired container does not count.
 *
 * Concurrency: a writer of a `contains` first locks the clusters it decides on
 * (`lockAssignmentClusters`), then the source asset, then the hosts whose links it removes, and
 * reads in separate statements after each lock. A link added at the same time is either
 * committed before the read, or waits for the write to commit: it is never missed.
 */

/** One host link removed by R1, as the relations responses report it. */
export type ReplacedHostLink = {
  host_id: string;
  host_name: string;
  asset_id: string;
  asset_name: string;
  cluster_id: string;
  cluster_name: string;
};

/** An asset that has at least two containers in service (R3). */
export type DoubleContainer = {
  asset_id: string;
  asset_name: string;
  containers: Array<{ id: string; name: string }>;
};

/** R2: the asset is already carried by one of the host's clusters. */
export function placementInheritedRefusal(cluster: string) {
  return new ConflictException({
    code: 'placement_inherited',
    message: `This asset is already contained by the cluster ${cluster}, which one of its hosts belongs to.`,
    params: { cluster },
  });
}

/**
 * R2 against the stored links: refuses a `contains` from `hostId` towards one of `containedIds`
 * when a cluster the host belongs to (both in service) already contains one of them. One such
 * cluster is enough. Call it after `lockAssignmentClusters`.
 */
export async function assertNotPlacedByCluster(
  mg: EntityManager,
  tenantId: string,
  hostId: string,
  containedIds: readonly string[],
): Promise<void> {
  const ids = Array.from(new Set(containedIds));
  if (ids.length === 0) return;
  const clusters = (await inheritedClustersOf(mg, tenantId, [hostId])).get(hostId) ?? [];
  if (clusters.length === 0) return;
  const rows: Array<{ asset_id: string }> = await mg.query(
    `SELECT asset_id FROM asset_relations
      WHERE tenant_id = $1 AND relation_type = 'contains'
        AND asset_id = ANY($2::uuid[]) AND related_asset_id = ANY($3::uuid[])`,
    [tenantId, clusters.map((cluster) => cluster.id), ids],
  );
  const carrying = clusters.find((cluster) => rows.some((row) => row.asset_id === cluster.id));
  if (carrying) throw placementInheritedRefusal(carrying.name);
}

/**
 * R1, read only: the links of the cluster's members in service towards `containedIds`, ordered by
 * host name then asset name. Each one names the cluster that absorbs it.
 */
export async function hostLinksToReplace(
  mg: EntityManager,
  tenantId: string,
  cluster: ClusterRef,
  containedIds: readonly string[],
): Promise<ReplacedHostLink[]> {
  const ids = Array.from(new Set(containedIds));
  if (ids.length === 0) return [];
  const members = (await inheritingMembersOf(mg, tenantId, [cluster.id])).get(cluster.id) ?? [];
  if (members.length === 0) return [];
  const rows: Array<{ host_id: string; host_name: string; asset_id: string; asset_name: string }> = await mg.query(
    `SELECT r.asset_id AS host_id, h.name AS host_name, r.related_asset_id AS asset_id, x.name AS asset_name
       FROM asset_relations r
       JOIN assets h ON h.tenant_id = r.tenant_id AND h.id = r.asset_id
       JOIN assets x ON x.tenant_id = r.tenant_id AND x.id = r.related_asset_id
      WHERE r.tenant_id = $1 AND r.relation_type = 'contains'
        AND r.asset_id = ANY($2::uuid[]) AND r.related_asset_id = ANY($3::uuid[])
      ORDER BY lower(h.name), h.id, lower(x.name), x.id`,
    [tenantId, members.map((member) => member.id), ids],
  );
  return rows.map((row) => ({
    host_id: row.host_id,
    host_name: row.host_name,
    asset_id: row.asset_id,
    asset_name: row.asset_name,
    cluster_id: cluster.id,
    cluster_name: cluster.name,
  }));
}

/**
 * R1, write: removes the `contains` links the cluster's members in service hold towards
 * `containedIds`, each host losing at most one audit entry (`asset_relations`, `recordId` the
 * host, `{ relations }` before and after), whatever the number of links it loses. The hosts are
 * locked first, then read again in a separate statement, so a link added while the cluster
 * absorbs is either already there and removed, or waits and is absorbed by the cluster's own
 * write. Returns the links really removed.
 */
export async function replaceHostLinks(
  mg: EntityManager,
  audit: AuditService,
  tenantId: string,
  cluster: ClusterRef,
  containedIds: readonly string[],
  userId: string | null,
  source?: AuditSourceOptions,
): Promise<ReplacedHostLink[]> {
  const first = await hostLinksToReplace(mg, tenantId, cluster, containedIds);
  if (first.length === 0) return [];
  const hostIds = Array.from(new Set(first.map((link) => link.host_id))).sort();
  // The hosts are locked after the cluster. The bulk writers that lock batches of assets by id
  // (the asset CSV import, `asset-csv.config.ts`, and the bulk administration view,
  // `administration-view.service.ts`) can lock a host before this cluster: PostgreSQL then
  // detects the deadlock and aborts one of the two transactions (40P01), with no damage to the data.
  await mg.query(
    `SELECT id FROM assets WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR NO KEY UPDATE`,
    [tenantId, hostIds],
  );
  const removed = await hostLinksToReplace(mg, tenantId, cluster, containedIds);
  if (removed.length === 0) return [];

  const relationsBefore: Array<{ asset_id: string; related_asset_id: string; relation_type: string }> = await mg.query(
    `SELECT asset_id, related_asset_id, relation_type FROM asset_relations
      WHERE tenant_id = $1 AND asset_id = ANY($2::uuid[])
      ORDER BY asset_id, created_at, id`,
    [tenantId, Array.from(new Set(removed.map((link) => link.host_id))).sort()],
  );

  await mg.query(
    `DELETE FROM asset_relations r
      USING unnest($2::uuid[], $3::uuid[]) AS x(host, asset)
      WHERE r.tenant_id = $1 AND r.asset_id = x.host AND r.related_asset_id = x.asset
        AND r.relation_type = 'contains'`,
    [tenantId, removed.map((link) => link.host_id), removed.map((link) => link.asset_id)],
  );

  const goneByHost = new Map<string, Set<string>>();
  for (const link of removed) {
    const assets = goneByHost.get(link.host_id) ?? new Set<string>();
    assets.add(link.asset_id);
    goneByHost.set(link.host_id, assets);
  }
  for (const [hostId, assets] of goneByHost) {
    const before = relationsBefore
      .filter((row) => row.asset_id === hostId)
      .map((row) => ({ related_asset_id: row.related_asset_id, relation_type: row.relation_type }));
    const after = before.filter((row) => !(row.relation_type === 'contains' && assets.has(row.related_asset_id)));
    await audit.log(
      {
        table: 'asset_relations',
        recordId: hostId,
        action: 'update',
        before: { relations: before },
        after: { relations: after },
        userId,
        ...(source ?? {}),
      },
      { manager: mg },
    );
  }
  return removed;
}

/**
 * R3: the containers in service (`contains`) of each of `assetIds`, in one batch, keeping only the
 * assets that have at least two. A retired container does not count.
 */
export async function doubleContainersOf(
  mg: EntityManager,
  tenantId: string,
  assetIds: readonly string[],
): Promise<DoubleContainer[]> {
  const ids = Array.from(new Set(assetIds));
  if (ids.length === 0) return [];
  const rows: Array<{ asset_id: string; asset_name: string; id: string; container_name: string }> = await mg.query(
    `SELECT r.related_asset_id AS asset_id, x.name AS asset_name,
            c.id, c.name AS container_name
       FROM asset_relations r
       JOIN assets c ON c.tenant_id = r.tenant_id AND c.id = r.asset_id AND ${assetInServiceSql('c')}
       JOIN assets x ON x.tenant_id = r.tenant_id AND x.id = r.related_asset_id
      WHERE r.tenant_id = $1 AND r.relation_type = 'contains' AND r.related_asset_id = ANY($2::uuid[])
      ORDER BY r.related_asset_id, lower(c.name), c.id`,
    [tenantId, ids],
  );
  const byAsset = new Map<string, DoubleContainer>();
  for (const row of rows) {
    const entry = byAsset.get(row.asset_id) ?? { asset_id: row.asset_id, asset_name: row.asset_name, containers: [] };
    entry.containers.push({ id: row.id, name: row.container_name });
    byAsset.set(row.asset_id, entry);
  }
  return [...byAsset.values()].filter((entry) => entry.containers.length >= 2);
}
