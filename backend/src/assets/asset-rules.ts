import { BadRequestException, ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { operatingSystemLabelSql } from '../technologies/operating-system-codes';

type Params = Record<string, string | number>;

/**
 * A refusal with a stable `code` the interface translates (`errors:<code>`), the values its sentence
 * names (`params`) and an English message for the API and the logs.
 */
export function assetBadRequest(code: string, message: string, params?: Params): BadRequestException {
  return new BadRequestException({ code, message, ...(params ? { params } : {}) });
}

export function assetConflict(code: string, message: string, params?: Params): ConflictException {
  return new ConflictException({ code, message, ...(params ? { params } : {}) });
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The refusals for assets added as members of a cluster, shared by every writer of
 * `asset_cluster_members` (service, assistant), inside the transaction of its write:
 * - the cluster itself (`cluster_member_self`);
 * - an id that is no asset of the tenant (`cluster_member_not_found`);
 * - a cluster (`cluster_member_is_cluster`, `name`).
 * The members are read `FOR SHARE`: a member cannot turn into a cluster while it is being added
 * (the switch locks its row). `memberIds` are lowercase and distinct.
 */
export async function assertClusterMemberCandidates(
  mg: EntityManager,
  tenantId: string,
  clusterId: string,
  memberIds: readonly string[],
): Promise<void> {
  if (memberIds.includes(String(clusterId).toLowerCase())) {
    throw assetBadRequest('cluster_member_self', 'A cluster cannot be a member of itself.');
  }
  const wellFormed = memberIds.filter((id) => UUID_PATTERN.test(id));
  const candidates: Array<{ id: string; name: string; is_cluster: boolean }> =
    wellFormed.length > 0
      ? await mg.query(
          `SELECT id, name, COALESCE(is_cluster, false) AS is_cluster
             FROM assets
            WHERE tenant_id = $1 AND id = ANY($2::uuid[])
            ORDER BY name, id
            FOR SHARE`,
          [tenantId, wellFormed],
        )
      : [];
  if (candidates.length !== memberIds.length) {
    throw assetBadRequest('cluster_member_not_found', 'One or more assets were not found.');
  }
  const clusterCandidate = candidates.find((c) => c.is_cluster);
  if (clusterCandidate) {
    throw assetBadRequest('cluster_member_is_cluster', `${clusterCandidate.name} is a cluster: a cluster cannot be a member.`, { name: clusterCandidate.name });
  }
}

/**
 * Locks the cluster row (`FOR UPDATE`: a concurrent switch or operating-system write waits) and
 * returns whether it is a cluster and its operating system. `null` when the asset does not exist.
 * The operating system is read in a second statement, after the lock: under READ COMMITTED a
 * statement that waited on the lock re-reads the locked row only, never its subqueries, so a
 * single statement could miss an operating system committed meanwhile.
 */
export async function lockClusterForMembers(
  mg: EntityManager,
  tenantId: string,
  clusterId: string,
): Promise<{ isCluster: boolean; os: string | null } | null> {
  const [row]: Array<{ is_cluster: boolean }> = await mg.query(
    `SELECT COALESCE(a.is_cluster, false) AS is_cluster
       FROM assets a
      WHERE a.tenant_id = $1 AND a.id = $2
      FOR UPDATE OF a`,
    [tenantId, clusterId],
  );
  if (!row) return null;
  const [osRow]: Array<{ os: string | null }> = await mg.query(
    `SELECT ${operatingSystemLabelSql('a')} AS os FROM assets a WHERE a.tenant_id = $1 AND a.id = $2`,
    [tenantId, clusterId],
  );
  return { isCluster: row.is_cluster, os: osRow?.os ?? null };
}

/** A cluster that carries an operating system gets no member (`cluster_os_with_members`, `os`). */
export function clusterOsWithMembersRefusal(os: string): BadRequestException {
  return assetBadRequest(
    'cluster_os_with_members',
    `This cluster has an operating system (${os}): a cluster with members has none.`,
    { os },
  );
}

/**
 * The SQL test that the asset `alias` is a member of a real cluster (`is_cluster`) of its tenant,
 * restricted by `extra` on the cluster `c` when given. A cluster is never a member: the test is
 * false for it. Shared by the list's filter, its sort and the assistant.
 */
export function realClusterMembershipSql(alias: string, extra = ''): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error(`Unsafe asset alias: ${alias}`);
  return `(NOT COALESCE(${alias}.is_cluster, false) AND EXISTS (
    SELECT 1 FROM asset_cluster_members m
      JOIN assets c ON c.tenant_id = m.tenant_id AND c.id = m.cluster_id AND c.is_cluster
     WHERE m.tenant_id = ${alias}.tenant_id AND m.asset_id = ${alias}.id${extra ? ` AND ${extra}` : ''}))`;
}

/**
 * The real clusters each of `assetIds` belongs to, in one query, ordered by name without case then
 * id. A cluster is never a member (it has no entry), nor is a membership to an asset that is no
 * longer a cluster.
 */
export async function clusterMembershipsOf(
  mg: EntityManager,
  tenantId: string,
  assetIds: readonly string[],
): Promise<Map<string, Array<{ id: string; name: string }>>> {
  const memberships = new Map<string, Array<{ id: string; name: string }>>();
  if (assetIds.length === 0) return memberships;
  const rows: Array<{ asset_id: string; cluster_id: string; name: string }> = await mg.query(
    `SELECT m.asset_id, c.id AS cluster_id, c.name
       FROM asset_cluster_members m
       JOIN assets c ON c.tenant_id = m.tenant_id AND c.id = m.cluster_id AND c.is_cluster
       JOIN assets a ON a.tenant_id = m.tenant_id AND a.id = m.asset_id AND NOT COALESCE(a.is_cluster, false)
      WHERE m.tenant_id = $1 AND m.asset_id = ANY($2::uuid[])
      ORDER BY m.asset_id, lower(c.name), c.id`,
    [tenantId, Array.from(new Set(assetIds))],
  );
  for (const row of rows) {
    const list = memberships.get(row.asset_id) ?? [];
    list.push({ id: row.cluster_id, name: row.name });
    memberships.set(row.asset_id, list);
  }
  return memberships;
}

/** The names of the clusters, joined as the list and the CSV show them. */
export function clusterNamesText(clusters: ReadonlyArray<{ name: string }> | undefined): string | null {
  return clusters && clusters.length > 0 ? clusters.map((c) => c.name).join(', ') : null;
}

/**
 * Names and FQDNs compare without case and without the spaces around them, as the database
 * compares them (`lower(btrim(...))`): `btrim` removes the space character only.
 */
export function assetNameKey(value: unknown): string {
  const text = String(value ?? '');
  let start = 0;
  let end = text.length;
  while (start < end && text[start] === ' ') start += 1;
  while (end > start && text[end - 1] === ' ') end -= 1;
  return text.slice(start, end).toLowerCase();
}

/**
 * The FQDN the screen stores: the host name, plus the domain's DNS suffix. A workgroup, an empty
 * domain and a domain without a suffix keep the host name alone. An empty host name has no FQDN.
 */
export function assetFqdnOf(
  hostname: string | null | undefined,
  domain: { code?: string | null; dns_suffix?: string | null } | null,
): string | null {
  if (!hostname || !String(hostname).trim()) return null;
  const clean = String(hostname).trim().toLowerCase();
  const code = String(domain?.code ?? '').trim().toLowerCase();
  if (!code || code === 'workgroup' || code === 'n-a') return clean;
  const suffix = String(domain?.dns_suffix ?? '').trim().toLowerCase();
  if (!suffix) return clean;
  return `${clean}.${suffix}`;
}

export type AssetIdentityHolder = { id: string; name: string; ref: string };

function holderOf(row: { id: string; name: string; asset_reference?: string | null }): AssetIdentityHolder {
  return { id: String(row.id), name: row.name, ref: row.asset_reference || row.name };
}

/** Assets of the tenant whose name or FQDN key is one of `keys`. */
export async function assetIdentityHolders(
  manager: { query: (sql: string, params?: unknown[]) => Promise<any[]> },
  tenantId: string,
  column: 'name' | 'fqdn',
  keys: string[],
): Promise<Array<AssetIdentityHolder & { key: string }>> {
  const wanted = [...new Set(keys.map((key) => assetNameKey(key)).filter(Boolean))];
  if (wanted.length === 0) return [];
  const rows: Array<{ id: string; name: string; asset_reference?: string | null; name_key?: string; fqdn?: string | null }> = await manager.query(
    `SELECT id::text AS id, name, asset_reference, lower(btrim(${column})) AS name_key
       FROM assets
      WHERE tenant_id = $1 AND lower(btrim(${column})) = ANY($2::text[])
      ORDER BY created_at ASC, id ASC`,
    [tenantId, wanted],
  );
  return rows
    .filter((row) => wanted.includes(assetNameKey(row.name_key ?? (column === 'name' ? row.name : row.fqdn))))
    .map((row) => ({ ...holderOf(row), key: assetNameKey(row.name_key ?? (column === 'name' ? row.name : row.fqdn)) }));
}

/** Assets of the tenant that carry this name, except `excludeId`. */
export async function assetsNamed(
  manager: { query: (sql: string, params?: unknown[]) => Promise<any[]> },
  tenantId: string,
  name: string,
  excludeId?: string | null,
): Promise<AssetIdentityHolder[]> {
  const key = assetNameKey(name);
  if (!key) return [];
  const rows: Array<{ id: string; name: string; asset_reference?: string | null }> = await manager.query(
    `SELECT id::text AS id, name, asset_reference
       FROM assets
      WHERE tenant_id = $1 AND lower(btrim(name)) = $2 AND ($3::uuid IS NULL OR id <> $3::uuid)
      ORDER BY created_at ASC, id ASC`,
    [tenantId, key, excludeId ?? null],
  );
  return rows.filter((row) => assetNameKey(row.name) === key && String(row.id) !== String(excludeId ?? '')).map(holderOf);
}

/** Assets of the tenant that carry this FQDN, except `excludeId`. An empty FQDN matches nothing. */
export async function assetsWithFqdn(
  manager: { query: (sql: string, params?: unknown[]) => Promise<any[]> },
  tenantId: string,
  fqdn: string | null | undefined,
  excludeId?: string | null,
): Promise<AssetIdentityHolder[]> {
  const key = assetNameKey(fqdn);
  if (!key) return [];
  const rows: Array<{ id: string; name: string; asset_reference?: string | null; fqdn?: string | null }> = await manager.query(
    `SELECT id::text AS id, name, asset_reference, fqdn
       FROM assets
      WHERE tenant_id = $1 AND lower(btrim(fqdn)) = $2 AND ($3::uuid IS NULL OR id <> $3::uuid)
      ORDER BY created_at ASC, id ASC`,
    [tenantId, key, excludeId ?? null],
  );
  return rows.filter((row) => assetNameKey(row.fqdn) === key && String(row.id) !== String(excludeId ?? '')).map(holderOf);
}

/**
 * Serializes the name and FQDN checks of a tenant until the end of the transaction. The tenant
 * row is locked first (FOR SHARE), then the names: the order the import takes (tenant FOR UPDATE,
 * then the names) and the settings reads of a write (`getSettingsForWrite`, FOR SHARE) follow, so
 * two writers never wait on each other in opposite orders.
 */
export async function lockAssetNames(manager: { query: (sql: string, params?: unknown[]) => Promise<any[]> }, tenantId: string): Promise<void> {
  await manager.query('SELECT 1 FROM tenants WHERE id = $1 FOR SHARE', [tenantId]);
  await manager.query(`SELECT pg_advisory_xact_lock(hashtext('assets:names:' || $1))`, [tenantId]);
}

/** 409 `asset_name_taken` when another asset of the tenant already has this name. */
export async function assertAssetNameFree(
  manager: { query: (sql: string, params?: unknown[]) => Promise<any[]> },
  tenantId: string,
  name: string,
  excludeId?: string | null,
): Promise<void> {
  const [holder] = await assetsNamed(manager, tenantId, name, excludeId);
  if (holder) {
    throw assetConflict('asset_name_taken', `An asset already has this name: ${holder.ref}`, { name: holder.name, ref: holder.ref });
  }
}

/** 409 `asset_fqdn_taken` when another asset of the tenant already has this FQDN. */
export async function assertAssetFqdnFree(
  manager: { query: (sql: string, params?: unknown[]) => Promise<any[]> },
  tenantId: string,
  fqdn: string | null | undefined,
  excludeId?: string | null,
): Promise<void> {
  const [holder] = await assetsWithFqdn(manager, tenantId, fqdn, excludeId);
  if (holder) {
    throw assetConflict('asset_fqdn_taken', `An asset already has this FQDN: ${holder.ref}`, { fqdn: assetNameKey(fqdn), ref: holder.ref });
  }
}
