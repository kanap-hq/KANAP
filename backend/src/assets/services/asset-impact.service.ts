import { Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { applicationParticipantCondition, type ParticipationAccessScope } from '../../auth/business-contributor-scope';
import { inServiceSql, MAX_DEPTH, TechnologyReachService, withoutJit } from '../../technologies/technology-reach.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An asset named on a path or as the place of a row. */
export type ImpactRef = { id: string; name: string };

/** An asset that goes down with the server: the server itself (depth 0), what it contains, what depends on a fallen asset. */
export type ImpactAsset = {
  id: string;
  reference: string | null;
  name: string;
  kind: string;
  /** Edges from the server on the shortest path. */
  depth: number;
  /** The last edge of that path: the asset is contained in its parent, or depends on it. Null for the server. */
  relation: 'contains' | 'depends_on' | null;
  /** The fallen assets from the server to the parent, in order (empty for the server). */
  via: ImpactRef[];
};

/** A cluster with a fallen member: degraded while a member stands, down when none does. */
export type ImpactCluster = {
  id: string;
  reference: string | null;
  name: string;
  state: 'degraded' | 'down';
  members: number;
  fallen_members: number;
  /** The fallen members. */
  via: ImpactRef[];
};

/** An application with an instance on a fallen asset (or a cluster that is down), per environment. */
export type ImpactApplication = {
  id: string;
  reference: string | null;
  name: string;
  criticality: string | null;
  environment: string;
  /** The fallen assets the instance is assigned to. */
  via: ImpactRef[];
};

/** A technology installed on a fallen asset. */
export type ImpactTechnology = {
  id: string;
  reference: string;
  name: string;
  /** Known versions installed on the fallen assets. */
  versions: string[];
  via: ImpactRef[];
};

/** A business process of an affected application. */
export type ImpactProcess = { id: string; name: string; via: ImpactRef[] };

export type AssetImpact = {
  asset: { id: string; reference: string | null; name: string };
  assets: ImpactAsset[];
  clusters: ImpactCluster[];
  /** Null when the caller cannot read applications. */
  applications: ImpactApplication[] | null;
  technologies: ImpactTechnology[];
  /** Null when the caller cannot read business processes or applications. */
  processes: ImpactProcess[] | null;
};

export type ImpactContext = {
  manager: EntityManager;
  tenantId: string;
  /** Null without the applications read right; a Business Contributor's scope otherwise. */
  applications: { scope?: ParticipationAccessScope } | null;
  processes: boolean;
};

/**
 * "If this server goes down, what goes down with it?" (lot T5). Edges along which a failure spreads:
 * a container takes what it contains (`contains`, downwards), and an asset takes what depends on it
 * (`depends_on`, from the depended-on asset to the dependant). Each kind of edge is followed at most
 * `MAX_DEPTH` times on a path, never twice through the same asset (a cycle stops), so the plan's
 * "contains, then depends_on, same bounds" holds, and a storage array also takes the VMs of the
 * hosts that depend on it.
 *
 * A cluster is not reached through the graph: it is degraded while one of its members stands, and
 * down when every member fell; the applications assigned to a cluster that is down fall with it.
 * Applications and instances out of service are left out (`inServiceSql`). Every statement is static
 * SQL with `tenant_id` on each table besides RLS, over a batch of ids; the recursive one runs without
 * JIT, as the deductions of the technology layer.
 */
@Injectable()
export class AssetImpactService {
  constructor(private readonly reach: TechnologyReachService) {}

  async impactOf(assetId: string, ctx: ImpactContext): Promise<AssetImpact> {
    const { manager: mg, tenantId } = ctx;
    if (!UUID_RE.test(String(assetId || ''))) throw new NotFoundException('Asset not found');
    const assets = await this.fallenAssets(mg, tenantId, assetId);
    const server = assets.find((row) => row.depth === 0);
    if (!server) throw new NotFoundException('Asset not found');
    const names = new Map(assets.map((row) => [row.id, row.name]));
    const ref = (id: string): ImpactRef => ({ id, name: names.get(id) ?? '' });

    const clusters = await this.clustersOf(mg, tenantId, assets.map((row) => row.id));
    for (const cluster of clusters) if (cluster.state === 'down') names.set(cluster.id, cluster.name);
    const fallen = [...assets.map((row) => row.id), ...clusters.filter((c) => c.state === 'down').map((c) => c.id)];
    const rank = new Map(fallen.map((id, index) => [id, index]));

    const applications = ctx.applications ? await this.applicationsOf(mg, tenantId, fallen, ctx.applications.scope, ref, rank) : null;
    const technologies = await this.technologiesOf(mg, tenantId, fallen, ref);
    const processes = ctx.processes && applications ? await this.processesOf(mg, tenantId, applications) : null;

    return {
      asset: { id: server.id, reference: server.reference, name: server.name },
      assets,
      clusters,
      applications,
      technologies,
      processes,
    };
  }

  /** The server and every asset that falls with it, each once with its shortest path. */
  private async fallenAssets(mg: EntityManager, tenantId: string, assetId: string): Promise<ImpactAsset[]> {
    const rows: Array<{ id: string; reference: string | null; name: string; kind: string; relation: ImpactAsset['relation']; path: string[] }> = await withoutJit(mg,
      `WITH RECURSIVE fall AS (
         SELECT a.id AS asset_id, NULL::text AS relation, 0 AS contains_depth, 0 AS depends_depth, ARRAY[a.id] AS path
           FROM assets a WHERE a.tenant_id = $1 AND a.id = $2
         UNION ALL
         SELECT e.fallen, e.relation,
                f.contains_depth + CASE WHEN e.relation = 'contains' THEN 1 ELSE 0 END,
                f.depends_depth + CASE WHEN e.relation = 'depends_on' THEN 1 ELSE 0 END,
                f.path || e.fallen
           FROM fall f
           JOIN (
             SELECT r.asset_id AS cause, r.related_asset_id AS fallen, r.relation_type AS relation
               FROM asset_relations r WHERE r.tenant_id = $1 AND r.relation_type = 'contains'
             UNION ALL
             SELECT r.related_asset_id, r.asset_id, r.relation_type
               FROM asset_relations r WHERE r.tenant_id = $1 AND r.relation_type = 'depends_on'
           ) e ON e.cause = f.asset_id
          WHERE NOT e.fallen = ANY(f.path)
            AND CASE WHEN e.relation = 'contains' THEN f.contains_depth < ${MAX_DEPTH} ELSE f.depends_depth < ${MAX_DEPTH} END
       ),
       shortest AS (
         SELECT DISTINCT ON (f.asset_id) f.asset_id, f.relation, f.path
           FROM fall f
          ORDER BY f.asset_id, cardinality(f.path), f.path
       )
       SELECT a.id, a.asset_reference AS reference, a.name, a.kind, s.relation, s.path
         FROM shortest s
         JOIN assets a ON a.tenant_id = $1 AND a.id = s.asset_id`,
      [tenantId, assetId],
    );
    const names = new Map(rows.map((row) => [row.id, row.name]));
    return rows
      .map((row) => ({
        id: row.id,
        reference: row.reference ?? null,
        name: row.name,
        kind: row.kind,
        depth: row.path.length - 1,
        relation: row.relation ?? null,
        via: row.path.slice(0, -1).map((id) => ({ id, name: names.get(id) ?? '' })),
      }))
      .sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  /** The clusters with a fallen member and not fallen themselves: degraded, or down when no member stands. */
  private async clustersOf(mg: EntityManager, tenantId: string, fallenIds: string[]): Promise<ImpactCluster[]> {
    const rows: Array<{ id: string; reference: string | null; name: string; members: number; fallen: Array<{ id: string; name: string }> }> = await mg.query(
      `SELECT c.id, c.asset_reference AS reference, c.name, count(*)::int AS members,
              COALESCE(json_agg(json_build_object('id', n.id, 'name', n.name) ORDER BY lower(n.name), n.id)
                         FILTER (WHERE m.asset_id = ANY($2::uuid[])), '[]') AS fallen
         FROM asset_cluster_members m
         JOIN assets c ON c.tenant_id = $1 AND c.id = m.cluster_id
         JOIN assets n ON n.tenant_id = $1 AND n.id = m.asset_id
        WHERE m.tenant_id = $1
          AND NOT m.cluster_id = ANY($2::uuid[])
          AND m.cluster_id IN (SELECT x.cluster_id FROM asset_cluster_members x WHERE x.tenant_id = $1 AND x.asset_id = ANY($2::uuid[]))
        GROUP BY c.id, c.asset_reference, c.name
        ORDER BY lower(c.name), c.id`,
      [tenantId, fallenIds],
    );
    return rows.map((row) => ({
      id: row.id,
      reference: row.reference ?? null,
      name: row.name,
      state: row.fallen.length >= Number(row.members) ? 'down' : 'degraded',
      members: Number(row.members),
      fallen_members: row.fallen.length,
      via: row.fallen,
    }));
  }

  /** In-service instances on a fallen asset, one row per application and environment. */
  private async applicationsOf(
    mg: EntityManager,
    tenantId: string,
    fallenIds: string[],
    scope: ParticipationAccessScope | undefined,
    ref: (id: string) => ImpactRef,
    rank: Map<string, number>,
  ): Promise<ImpactApplication[]> {
    const params: unknown[] = [tenantId, fallenIds];
    const scopeSql = scope ? (params.push(scope.userId), `AND ${applicationParticipantCondition('ap', `$${params.length}`)}`) : '';
    const rows: Array<{ id: string; reference: string | null; name: string; criticality: string | null; environment: string; asset_id: string }> = await mg.query(
      `SELECT DISTINCT ap.id, ap.sequential_id AS reference, ap.name, ap.criticality, i.environment, x.asset_id
         FROM app_asset_assignments x
         JOIN app_instances i ON i.tenant_id = $1 AND i.id = x.app_instance_id
         JOIN applications ap ON ap.tenant_id = $1 AND ap.id = i.application_id AND ${inServiceSql('ap', 'i')}
        WHERE x.tenant_id = $1 AND x.asset_id = ANY($2::uuid[]) ${scopeSql}`,
      params,
    );
    const byKey = new Map<string, ImpactApplication>();
    for (const row of rows) {
      const key = `${row.id}|${row.environment}`;
      const item = byKey.get(key) ?? { id: row.id, reference: row.reference ?? null, name: row.name, criticality: row.criticality ?? null, environment: row.environment, via: [] };
      item.via.push(ref(row.asset_id));
      byKey.set(key, item);
    }
    const items = Array.from(byKey.values());
    for (const item of items) item.via.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    return items.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id) || a.environment.localeCompare(b.environment));
  }

  /** Technologies installed on a fallen asset (the "installed" deductions of the technology layer). */
  private async technologiesOf(mg: EntityManager, tenantId: string, fallenIds: string[], ref: (id: string) => ImpactRef): Promise<ImpactTechnology[]> {
    const links = (await this.reach.technologiesOfAssets(mg, tenantId, fallenIds)).filter((row) => row.kind === 'installed');
    if (links.length === 0) return [];
    const technologyIds = Array.from(new Set(links.map((row) => row.technology_id)));
    const versionIds = Array.from(new Set(links.map((row) => row.technology_version_id).filter((id): id is string => !!id)));
    const rows: Array<{ id: string; item_number: number; name: string }> = await mg.query(
      `SELECT t.id, t.item_number, t.name FROM technologies t WHERE t.tenant_id = $1 AND t.id = ANY($2::uuid[])`,
      [tenantId, technologyIds],
    );
    const versions: Array<{ id: string; label: string }> = versionIds.length
      ? await mg.query(`SELECT v.id, v.label FROM technology_versions v WHERE v.tenant_id = $1 AND v.id = ANY($2::uuid[])`, [tenantId, versionIds])
      : [];
    const labels = new Map(versions.map((row) => [row.id, row.label]));
    return rows
      .map((row) => {
        const own = links.filter((link) => link.technology_id === row.id);
        const via = Array.from(new Set(own.map((link) => link.subject_id))).map(ref)
          .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
        const known = Array.from(new Set(own.map((link) => (link.technology_version_id ? labels.get(link.technology_version_id) : null)).filter((label): label is string => !!label)))
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        return { id: row.id, reference: `TEC-${row.item_number}`, name: row.name, versions: known, via };
      })
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  /** In-service business processes of the affected applications, each with the applications that bring it. */
  private async processesOf(mg: EntityManager, tenantId: string, applications: ImpactApplication[]): Promise<ImpactProcess[]> {
    const appIds = Array.from(new Set(applications.map((row) => row.id)));
    if (appIds.length === 0) return [];
    const appNames = new Map(applications.map((row) => [row.id, row.name]));
    const rows: Array<{ id: string; name: string; application_id: string }> = await mg.query(
      `SELECT p.id, p.name, l.application_id
         FROM application_business_processes l
         JOIN business_processes p ON p.tenant_id = $1 AND p.id = l.business_process_id
        WHERE l.tenant_id = $1 AND l.application_id = ANY($2::uuid[])
          AND p.status = 'enabled' AND (p.disabled_at IS NULL OR p.disabled_at > now())`,
      [tenantId, appIds],
    );
    const byId = new Map<string, ImpactProcess>();
    for (const row of rows) {
      const item = byId.get(row.id) ?? { id: row.id, name: row.name, via: [] };
      item.via.push({ id: row.application_id, name: appNames.get(row.application_id) ?? '' });
      byId.set(row.id, item);
    }
    const items = Array.from(byId.values());
    for (const item of items) item.via.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return items.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }
}
