import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

type Params = Record<string, string | number>;

/**
 * A refusal with a stable `code` the interface translates (`errors:<code>`), the values its sentence
 * names (`params`) and an English message for the API and the logs.
 */
export function assetBadRequest(code: string, message: string, params?: Params): BadRequestException {
  return new BadRequestException({ code, message, ...(params ? { params } : {}) });
}

/** The code, message and params of a coded refusal, for a CSV row error. */
export function codedRowError(error: BadRequestException): { message: string; code?: string; params?: Params } {
  const response = error.getResponse() as { code?: unknown; message?: unknown; params?: Params } | string;
  if (!response || typeof response !== 'object') return { message: error.message };
  return {
    message: typeof response.message === 'string' ? response.message : error.message,
    ...(typeof response.code === 'string' ? { code: response.code } : {}),
    ...(response.params ? { params: response.params } : {}),
  };
}

/** One change of the Cluster switch: `from` is the stored value, `to` the value asked. */
export type ClusterSwitch = { id: string; from: boolean; to: boolean };

/**
 * The refusals of the Cluster switch, per asset id, read in two grouped queries:
 * - a cluster that still has members cannot become a plain asset (`cluster_has_members`, `count`);
 * - a member of a cluster cannot become a cluster (`cluster_switch_member`, `cluster`: the first
 *   cluster by name).
 * The switch never touches the operating system. Every writer of `is_cluster` asks here inside the
 * transaction of its write (service create and update, assistant, CSV import).
 */
export async function clusterSwitchRefusals(
  mg: EntityManager,
  tenantId: string,
  switches: readonly ClusterSwitch[],
): Promise<Map<string, BadRequestException>> {
  const refusals = new Map<string, BadRequestException>();
  const leaving = switches.filter((s) => s.from && !s.to).map((s) => s.id);
  const joining = switches.filter((s) => !s.from && s.to).map((s) => s.id);
  if (leaving.length > 0) {
    const rows: Array<{ cluster_id: string; count: number }> = await mg.query(
      `SELECT cluster_id, count(*)::int AS count
         FROM asset_cluster_members
        WHERE tenant_id = $1 AND cluster_id = ANY($2::uuid[])
        GROUP BY cluster_id`,
      [tenantId, leaving],
    );
    for (const row of rows) {
      refusals.set(row.cluster_id, assetBadRequest(
        'cluster_has_members',
        `This cluster still has ${row.count} member(s). Remove them first.`,
        { count: Number(row.count) },
      ));
    }
  }
  if (joining.length > 0) {
    const rows: Array<{ asset_id: string; name: string }> = await mg.query(
      `SELECT DISTINCT ON (m.asset_id) m.asset_id, c.name
         FROM asset_cluster_members m
         JOIN assets c ON c.tenant_id = m.tenant_id AND c.id = m.cluster_id
        WHERE m.tenant_id = $1 AND m.asset_id = ANY($2::uuid[])
        ORDER BY m.asset_id, c.name, c.id`,
      [tenantId, joining],
    );
    for (const row of rows) {
      refusals.set(row.asset_id, assetBadRequest(
        'cluster_switch_member',
        `This asset is a member of ${row.name}: it cannot become a cluster.`,
        { cluster: row.name },
      ));
    }
  }
  return refusals;
}

/** Of `ids`, the clusters that have at least one member, in one query. */
export async function clustersWithMembers(mg: EntityManager, tenantId: string, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows: Array<{ cluster_id: string }> = await mg.query(
    `SELECT DISTINCT cluster_id FROM asset_cluster_members WHERE tenant_id = $1 AND cluster_id = ANY($2::uuid[])`,
    [tenantId, Array.from(new Set(ids))],
  );
  return new Set(rows.map((row) => row.cluster_id));
}

/** A cluster that has members carries no operating system (`os_cluster_with_members`). */
export function osClusterWithMembersRefusal(): BadRequestException {
  return assetBadRequest('os_cluster_with_members', 'This cluster has members: it has no operating system.');
}
