import type { EntityManager } from 'typeorm';
import { applicationBadRequest, applicationConflict, applicationDayOf } from '../applications/application-rules';
import { assetInServiceSql } from '../technologies/technology-reach.service';

/**
 * The rules of an assignment written to a cluster or to one of its members (clusters pass, PR B),
 * shared by every writer of `app_asset_assignments` (the service, the assistant), inside the
 * transaction of its write:
 * - A3: a member gets no direct row for a deployment and role that one of its clusters carries
 *   (`assignment_inherited`, 409, `cluster`: the cluster's name).
 * - A4: a row written to a cluster replaces the direct rows of the same deployment and role on its
 *   members (absorption). The cluster's row keeps the earliest "since" date and adds their notes
 *   after its own.
 * Who inherits follows `effectiveAssignmentsSql`: a cluster in service passes its rows to its
 * members in service, a retired cluster passes nothing, a retired member inherits nothing.
 *
 * Concurrency: a writer first locks the clusters it decides on (`lockAssignmentClusters`), then
 * reads the members and the rows in separate statements, so a write to a cluster and a write to
 * one of its members never decide on the same stale state.
 */

export type ClusterRef = { id: string; name: string };

/**
 * Locks the clusters a write to `assetIds` decides on, before any read: each of `assetIds` that
 * is a cluster, and the clusters of each of the others (`FOR NO KEY UPDATE`, by id, one statement:
 * two writers lock in the same order). The cluster switch and the members endpoint lock the same
 * rows, so a cluster cannot change while a row is written to it or to one of its members.
 */
export async function lockAssignmentClusters(mg: EntityManager, tenantId: string, assetIds: readonly string[]): Promise<void> {
  if (assetIds.length === 0) return;
  await mg.query(
    `SELECT a.id
       FROM assets a
      WHERE a.tenant_id = $1
        AND COALESCE(a.is_cluster, false)
        AND (a.id = ANY($2::uuid[])
             OR a.id IN (SELECT m.cluster_id FROM asset_cluster_members m WHERE m.tenant_id = $1 AND m.asset_id = ANY($2::uuid[])))
      ORDER BY a.id
      FOR NO KEY UPDATE OF a`,
    [tenantId, Array.from(new Set(assetIds))],
  );
}

/** The clusters each of `memberIds` inherits from (both in service), ordered by name then id. */
export async function inheritedClustersOf(
  mg: EntityManager,
  tenantId: string,
  memberIds: readonly string[],
): Promise<Map<string, ClusterRef[]>> {
  const byMember = new Map<string, ClusterRef[]>();
  if (memberIds.length === 0) return byMember;
  const rows: Array<{ asset_id: string; id: string; name: string }> = await mg.query(
    `SELECT m.asset_id, c.id, c.name
       FROM asset_cluster_members m
       JOIN assets c ON c.tenant_id = m.tenant_id AND c.id = m.cluster_id AND ${assetInServiceSql('c')}
       JOIN assets ma ON ma.tenant_id = m.tenant_id AND ma.id = m.asset_id AND ${assetInServiceSql('ma')}
      WHERE m.tenant_id = $1 AND m.asset_id = ANY($2::uuid[])
      ORDER BY m.asset_id, c.name, c.id`,
    [tenantId, Array.from(new Set(memberIds))],
  );
  for (const row of rows) {
    const list = byMember.get(row.asset_id) ?? [];
    list.push({ id: row.id, name: row.name });
    byMember.set(row.asset_id, list);
  }
  return byMember;
}

/** The members each of `clusterIds` passes its rows to (both in service), ordered by name then id. */
export async function inheritingMembersOf(
  mg: EntityManager,
  tenantId: string,
  clusterIds: readonly string[],
): Promise<Map<string, ClusterRef[]>> {
  const byCluster = new Map<string, ClusterRef[]>();
  if (clusterIds.length === 0) return byCluster;
  const rows: Array<{ cluster_id: string; id: string; name: string }> = await mg.query(
    `SELECT m.cluster_id, ma.id, ma.name
       FROM asset_cluster_members m
       JOIN assets c ON c.tenant_id = m.tenant_id AND c.id = m.cluster_id AND ${assetInServiceSql('c')}
       JOIN assets ma ON ma.tenant_id = m.tenant_id AND ma.id = m.asset_id AND ${assetInServiceSql('ma')}
      WHERE m.tenant_id = $1 AND m.cluster_id = ANY($2::uuid[])
      ORDER BY m.cluster_id, ma.name, ma.id`,
    [tenantId, Array.from(new Set(clusterIds))],
  );
  for (const row of rows) {
    const list = byCluster.get(row.cluster_id) ?? [];
    list.push({ id: row.id, name: row.name });
    byCluster.set(row.cluster_id, list);
  }
  return byCluster;
}

/** A3: the member already runs this deployment in this role through `cluster`. */
export function assignmentInheritedRefusal(cluster: string) {
  return applicationConflict(
    'assignment_inherited',
    `This server already has this role on this deployment through the cluster ${cluster}.`,
    { cluster },
  );
}

/**
 * A3 against the stored rows: refuses a direct row of `instanceId` and `role` on `assetId` when
 * one of the clusters it inherits from carries that deployment and role. Call it after
 * `lockAssignmentClusters`.
 */
export async function assertNotInherited(
  mg: EntityManager,
  tenantId: string,
  instanceId: string,
  assetId: string,
  role: string,
): Promise<void> {
  const clusters = (await inheritedClustersOf(mg, tenantId, [assetId])).get(assetId) ?? [];
  if (clusters.length === 0) return;
  const rows: Array<{ asset_id: string }> = await mg.query(
    `SELECT asset_id FROM app_asset_assignments
      WHERE tenant_id = $1 AND app_instance_id = $2 AND role = $3 AND asset_id = ANY($4::uuid[])`,
    [tenantId, instanceId, role, clusters.map((cluster) => cluster.id)],
  );
  const carrying = clusters.find((cluster) => rows.some((row) => row.asset_id === cluster.id));
  if (carrying) throw assignmentInheritedRefusal(carrying.name);
}

/** A role of the server roles catalog (`serverRoles`), lowercase; else `assignment_role_invalid`. */
export function normalizeServerRole(value: unknown, serverRoles: ReadonlyArray<{ code: string }> | undefined): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    throw applicationBadRequest('assignment_role_invalid', 'role is required', { value: '' });
  }
  const allowed = new Set((serverRoles || []).map((item) => item.code));
  if (!allowed.has(normalized)) {
    throw applicationBadRequest('assignment_role_invalid', `Invalid role "${value}"`, { value: String(value ?? '') });
  }
  return normalized;
}

type DatedNotes = { since_date?: unknown; notes?: unknown };

/**
 * A4: the date and notes of a cluster's row that absorbs `absorbed`: the earliest "since" date of
 * all, its own notes then the distinct non-empty notes of the absorbed rows, one per line.
 */
export function mergeAbsorbed(own: DatedNotes, absorbed: readonly DatedNotes[]): { since_date: string | null; notes: string | null } {
  const days = [own, ...absorbed].map((row) => applicationDayOf(row.since_date)).filter((day): day is string => !!day).sort();
  const notes: string[] = [];
  for (const row of [own, ...absorbed]) {
    const text = row.notes == null ? '' : String(row.notes).trim();
    if (text && !notes.includes(text)) notes.push(text);
  }
  return { since_date: days[0] ?? null, notes: notes.length > 0 ? notes.join('\n') : null };
}
