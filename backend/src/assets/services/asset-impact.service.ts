import { Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { applicationParticipantCondition, type ParticipationAccessScope } from '../../auth/business-contributor-scope';
import { inServiceSql, MAX_DEPTH } from '../../technologies/technology-reach.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Each list of the answer keeps at most this many rows (the nearest first); `totals` gives the full counts. */
export const IMPACT_ROW_LIMIT = 200;
/** Each `via` of a cluster, application, technology or process keeps at most this many names; `via_total` counts them all. */
export const IMPACT_VIA_LIMIT = 20;
/** The order of the environments of an application row. */
const ENVIRONMENT_ORDER = ['prod', 'pre_prod', 'qa', 'test', 'dev', 'sandbox'];
/**
 * An asset still in service: a retired asset (`retired`, the locked lifecycle code) leaves every
 * deduction. Same condition as `assetInServiceSql` of `technology-reach.service.ts`.
 */
const assetInService = (alias: string) => `${alias}.status IS DISTINCT FROM 'retired'`;

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
  /**
   * The last edge of that path: the asset is contained in its parent, depends on it, or is a member
   * of it (a cluster that fell, so every member falls). Null for the server.
   */
  relation: 'contains' | 'depends_on' | 'member' | null;
  /** The fallen assets from the server to the parent, in order (empty for the server). */
  via: ImpactRef[];
};

/** A cluster with a fallen member, not fallen itself: degraded while a member stands, down when none does. */
export type ImpactCluster = {
  id: string;
  reference: string | null;
  name: string;
  state: 'degraded' | 'down';
  members: number;
  fallen_members: number;
  /** Applications assigned to the cluster itself; null when the caller cannot read applications. */
  applications: number | null;
  /** The fallen members. */
  via: ImpactRef[];
  via_total: number;
};

/** An application with an instance on a fallen asset (or a cluster that is down). */
export type ImpactApplication = {
  id: string;
  reference: string | null;
  name: string;
  criticality: string | null;
  /** The environments of the fallen instances, production first. */
  environments: string[];
  /** The fallen assets the instances are assigned to. */
  via: ImpactRef[];
  via_total: number;
};

/** A technology installed on a fallen asset. */
export type ImpactTechnology = {
  id: string;
  reference: string;
  name: string;
  /** Known versions installed on the fallen assets. */
  versions: string[];
  via: ImpactRef[];
  via_total: number;
};

/** A business process of an affected application. */
export type ImpactProcess = { id: string; name: string; via: ImpactRef[]; via_total: number };

/** The full counts behind the capped lists; `assets` leaves out the server itself. */
export type ImpactTotals = { assets: number; applications: number; clusters: number; technologies: number; processes: number };

export type AssetImpact = {
  asset: { id: string; reference: string | null; name: string };
  /** The server first, then at most `IMPACT_ROW_LIMIT` fallen assets, the nearest first. */
  assets: ImpactAsset[];
  clusters: ImpactCluster[];
  /** Null when the caller cannot read applications. */
  applications: ImpactApplication[] | null;
  technologies: ImpactTechnology[];
  /** Null when the caller cannot read business processes or applications. */
  processes: ImpactProcess[] | null;
  /** Full counts; 0 for a list the caller cannot read. */
  totals: ImpactTotals;
};

export type ImpactContext = {
  manager: EntityManager;
  tenantId: string;
  /** Null without the applications read right; a Business Contributor's scope otherwise. */
  applications: { scope?: ParticipationAccessScope } | null;
  processes: boolean;
};

/** A state of the walk: an asset, the edges of each kind used to reach it, and the path. */
type WalkState = { asset: string; contains: number; depends: number; path: string[] };
/** What the walks found: the first path to each asset, the states expanded, the clusters gone down with their members. */
type Walk = { first: Map<string, { relation: ImpactAsset['relation']; state: WalkState }>; seen: Set<string>; downClusters: Set<string> };
const stateKey = (state: WalkState) => `${state.asset}|${state.contains}|${state.depends}`;

/**
 * "If this server goes down, what goes down with it?" (lot T5). Edges along which a failure spreads:
 * a container takes what it contains (`contains`, downwards), and an asset takes what depends on it
 * (`depends_on`, from the depended-on asset to the dependant). Each kind of edge is followed at most
 * `MAX_DEPTH` times on a path, never twice through the same asset (a cycle stops), so the plan's
 * "contains, then depends_on, same bounds" holds, and a storage array also takes the VMs of the
 * hosts that depend on it.
 *
 * A cluster that falls (the server itself, or an asset reached by those edges) takes all its members
 * in service (`member`, an edge counted in neither bound). A fallen member does not take its cluster:
 * the cluster is degraded while one of its members stands, and down when every member fell. A
 * cluster down takes what it contains (the walk starts again from it, `via` ending with the
 * cluster, until no new cluster goes down, at most `MAX_DEPTH` rounds) and the applications
 * assigned to it; a degraded cluster takes nothing. Its members already fell: it does not take
 * them again. The server's own row is the cluster when the server is one; `clusters` lists the
 * others. Applications and instances out of service are left out (`inServiceSql`). A retired asset is never
 * crossed: it does not fall, takes nothing with it, and counts for no cluster; a retired server is
 * listed alone at depth 0. Every statement is static
 * SQL with `tenant_id` on each table besides RLS, over a batch of ids. Each list keeps its first `IMPACT_ROW_LIMIT` rows
 * (the nearest assets first); `totals` counts them all.
 */
@Injectable()
export class AssetImpactService {
  async impactOf(assetId: string, ctx: ImpactContext): Promise<AssetImpact> {
    const { manager: mg, tenantId } = ctx;
    if (!UUID_RE.test(String(assetId || ''))) throw new NotFoundException('Asset not found');
    const { assets, clusters } = await this.fallenAssets(mg, tenantId, assetId);
    const server = assets.find((row) => row.depth === 0);
    if (!server) throw new NotFoundException('Asset not found');
    const names = new Map(assets.map((row) => [row.id, row.name]));
    const ref = (id: string): ImpactRef => ({ id, name: names.get(id) ?? '' });

    for (const cluster of clusters) if (cluster.state === 'down') names.set(cluster.id, cluster.name);
    const fallen = [...assets.map((row) => row.id), ...clusters.filter((c) => c.state === 'down').map((c) => c.id)];
    const rank = new Map(fallen.map((id, index) => [id, index]));

    const applications = ctx.applications ? await this.applicationsOf(mg, tenantId, fallen, ctx.applications.scope, ref, rank) : null;
    const technologies = await this.technologiesOf(mg, tenantId, fallen, ref);
    const processes = ctx.processes && applications ? await this.processesOf(mg, tenantId, applications) : null;
    // What a cluster carries itself, so a member's page can say the applications stay up while it is degraded.
    if (ctx.applications && clusters.length > 0) {
      const onClusters = await this.applicationsOf(mg, tenantId, clusters.map((c) => c.id), ctx.applications.scope, ref, new Map());
      for (const cluster of clusters) cluster.applications = onClusters.filter((app) => app.via.some((via) => via.id === cluster.id)).length;
    }

    const cap = <T extends { via: ImpactRef[]; via_total: number }>(rows: T[]) =>
      rows.slice(0, IMPACT_ROW_LIMIT).map((row) => ({ ...row, via: row.via.slice(0, IMPACT_VIA_LIMIT), via_total: row.via.length }));
    return {
      asset: { id: server.id, reference: server.reference, name: server.name },
      assets: [server, ...assets.filter((row) => row !== server).slice(0, IMPACT_ROW_LIMIT)],
      clusters: cap(clusters),
      applications: applications && cap(applications),
      technologies: cap(technologies),
      processes: processes && cap(processes),
      totals: {
        assets: assets.length - 1,
        applications: applications?.length ?? 0,
        clusters: clusters.length,
        technologies: technologies.length,
        processes: processes?.length ?? 0,
      },
    };
  }

  /**
   * The server and every asset that falls with it, each once with its shortest path, and the
   * clusters with a fallen member. A breadth-first walk (`walk`), then, while a cluster goes down
   * with all its members, a new walk from it (at most `MAX_DEPTH` rounds). A cluster down is not an
   * asset row: it is in `clusters`, and named in the `via` of what it takes.
   */
  private async fallenAssets(mg: EntityManager, tenantId: string, assetId: string): Promise<{ assets: ImpactAsset[]; clusters: ImpactCluster[] }> {
    const servers: Array<{ id: string; in_service: boolean }> = await mg.query(
      `SELECT a.id, ${assetInService('a')} AS in_service FROM assets a WHERE a.tenant_id = $1 AND a.id = $2`,
      [tenantId, assetId],
    );
    if (!servers[0]) return { assets: [], clusters: [] };
    const start: WalkState = { asset: assetId, contains: 0, depends: 0, path: [assetId] };
    const walk: Walk = { first: new Map([[assetId, { relation: null, state: start }]]), seen: new Set([stateKey(start)]), downClusters: new Set() };
    if (servers[0].in_service) await this.walk(mg, tenantId, [start], walk);
    const walked = () => Array.from(walk.first.keys()).filter((id) => !walk.downClusters.has(id));
    let clusters = await this.clustersOf(mg, tenantId, walked());
    for (let round = 0; round < MAX_DEPTH; round++) {
      const fresh = clusters.filter((cluster) => cluster.state === 'down' && !walk.first.has(cluster.id));
      if (fresh.length === 0) break;
      const seeds: WalkState[] = [];
      for (const cluster of fresh) {
        // From its nearest fallen member (by path, then by name): the cluster went down with it.
        const nearest = cluster.via
          .map((member) => walk.first.get(member.id)?.state)
          .filter((state): state is WalkState => !!state)
          .reduce<WalkState | null>((best, state) => (!best || state.path.length < best.path.length ? state : best), null);
        if (!nearest) continue;
        const state: WalkState = { asset: cluster.id, contains: nearest.contains, depends: nearest.depends, path: [...nearest.path, cluster.id] };
        walk.first.set(cluster.id, { relation: 'member', state });
        walk.downClusters.add(cluster.id);
        walk.seen.add(stateKey(state));
        seeds.push(state);
      }
      await this.walk(mg, tenantId, seeds, walk);
      clusters = await this.clustersOf(mg, tenantId, walked());
    }
    const rows: Array<{ id: string; reference: string | null; name: string; kind: string }> = await mg.query(
      `SELECT a.id, a.asset_reference AS reference, a.name, a.kind FROM assets a WHERE a.tenant_id = $1 AND a.id = ANY($2::uuid[])`,
      [tenantId, Array.from(walk.first.keys())],
    );
    const names = new Map(rows.map((row) => [row.id, row.name]));
    const assets = rows
      .filter((row) => !walk.downClusters.has(row.id))
      .map((row) => {
        const { relation, state } = walk.first.get(row.id)!;
        return {
          id: row.id,
          reference: row.reference ?? null,
          name: row.name,
          kind: row.kind,
          depth: state.path.length - 1,
          relation,
          via: state.path.slice(0, -1).map((id) => ({ id, name: names.get(id) ?? '' })),
        };
      })
      .sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return { assets, clusters };
  }

  /**
   * One breadth-first walk from `frontier`, one statement per level for the whole frontier (at most
   * `2 * MAX_DEPTH` levels, the `member` edges aside): a state is an asset with the number of edges
   * of each kind used to reach it, and each state is expanded once. Records in `walk.first` the
   * first path to each asset. Enumerating every path in one recursive statement took 2.3 s on a
   * dense `depends_on` mesh of three layers of 100 assets; the walk visits each state once.
   */
  private async walk(mg: EntityManager, tenantId: string, initial: WalkState[], walk: Walk): Promise<void> {
    let frontier = initial;
    while (frontier.length > 0) {
      const edges: Array<{ cause: string; fallen: string; relation: 'contains' | 'depends_on' | 'member' }> = await mg.query(
        `SELECT r.asset_id AS cause, r.related_asset_id AS fallen, r.relation_type AS relation
           FROM asset_relations r
           JOIN assets f ON f.tenant_id = $1 AND f.id = r.related_asset_id AND ${assetInService('f')}
          WHERE r.tenant_id = $1 AND r.relation_type = 'contains' AND r.asset_id = ANY($2::uuid[])
         UNION ALL
         SELECT r.related_asset_id, r.asset_id, r.relation_type
           FROM asset_relations r
           JOIN assets f ON f.tenant_id = $1 AND f.id = r.asset_id AND ${assetInService('f')}
          WHERE r.tenant_id = $1 AND r.relation_type = 'depends_on' AND r.related_asset_id = ANY($2::uuid[])
         UNION ALL
         SELECT m.cluster_id, m.asset_id, 'member'
           FROM asset_cluster_members m
           JOIN assets f ON f.tenant_id = $1 AND f.id = m.asset_id AND ${assetInService('f')}
          WHERE m.tenant_id = $1 AND m.cluster_id = ANY($2::uuid[])
         ORDER BY 1, 2, 3`,
        [tenantId, Array.from(new Set(frontier.map((state) => state.asset)))],
      );
      const byCause = new Map<string, typeof edges>();
      for (const edge of edges) byCause.set(edge.cause, [...(byCause.get(edge.cause) ?? []), edge]);
      const next: WalkState[] = [];
      for (const state of frontier) {
        for (const edge of byCause.get(state.asset) ?? []) {
          // A cluster down went down with its members: it does not take them again.
          if (edge.relation === 'member' && walk.downClusters.has(edge.cause)) continue;
          const contains = state.contains + (edge.relation === 'contains' ? 1 : 0);
          const depends = state.depends + (edge.relation === 'depends_on' ? 1 : 0);
          if (contains > MAX_DEPTH || depends > MAX_DEPTH || state.path.includes(edge.fallen)) continue;
          const reached: WalkState = { asset: edge.fallen, contains, depends, path: [...state.path, edge.fallen] };
          if (walk.seen.has(stateKey(reached))) continue;
          walk.seen.add(stateKey(reached));
          if (!walk.first.has(edge.fallen)) walk.first.set(edge.fallen, { relation: edge.relation, state: reached });
          next.push(reached);
        }
      }
      frontier = next;
    }
  }

  /**
   * The clusters in service with a fallen member and not fallen themselves: degraded, or down when no
   * member stands. A retired member neither falls nor stands.
   */
  private async clustersOf(mg: EntityManager, tenantId: string, fallenIds: string[]): Promise<ImpactCluster[]> {
    const rows: Array<{ id: string; reference: string | null; name: string; members: number; fallen: Array<{ id: string; name: string }> }> = await mg.query(
      `SELECT c.id, c.asset_reference AS reference, c.name, count(*)::int AS members,
              COALESCE(json_agg(json_build_object('id', n.id, 'name', n.name) ORDER BY lower(n.name), n.id)
                         FILTER (WHERE m.asset_id = ANY($2::uuid[])), '[]') AS fallen
         FROM asset_cluster_members m
         JOIN assets c ON c.tenant_id = $1 AND c.id = m.cluster_id AND ${assetInService('c')}
         JOIN assets n ON n.tenant_id = $1 AND n.id = m.asset_id AND ${assetInService('n')}
        WHERE m.tenant_id = $1
          AND NOT m.cluster_id = ANY($2::uuid[])
          AND m.cluster_id IN (SELECT x.cluster_id FROM asset_cluster_members x WHERE x.tenant_id = $1 AND x.asset_id = ANY($2::uuid[]))
        GROUP BY c.id, c.asset_reference, c.name
       HAVING bool_or(m.asset_id = ANY($2::uuid[]))
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
      applications: null,
      via: row.fallen,
      via_total: row.fallen.length,
    }));
  }

  /** In-service instances on a fallen asset in service, one row per application with its environments. */
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
         JOIN assets s ON s.tenant_id = $1 AND s.id = x.asset_id AND ${assetInService('s')}
         JOIN app_instances i ON i.tenant_id = $1 AND i.id = x.app_instance_id
         JOIN applications ap ON ap.tenant_id = $1 AND ap.id = i.application_id AND ${inServiceSql('ap', 'i')}
        WHERE x.tenant_id = $1 AND x.asset_id = ANY($2::uuid[]) ${scopeSql}`,
      params,
    );
    const byId = new Map<string, ImpactApplication>();
    for (const row of rows) {
      const item = byId.get(row.id) ?? { id: row.id, reference: row.reference ?? null, name: row.name, criticality: row.criticality ?? null, environments: [], via: [], via_total: 0 };
      if (!item.environments.includes(row.environment)) item.environments.push(row.environment);
      if (!item.via.some((via) => via.id === row.asset_id)) item.via.push(ref(row.asset_id));
      byId.set(row.id, item);
    }
    const envRank = (env: string) => (ENVIRONMENT_ORDER.includes(env) ? ENVIRONMENT_ORDER.indexOf(env) : ENVIRONMENT_ORDER.length);
    const items = Array.from(byId.values());
    for (const item of items) {
      item.via.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
      item.environments.sort((a, b) => envRank(a) - envRank(b) || a.localeCompare(b));
    }
    return items.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  /** Technologies installed on a fallen asset in service, each with its known versions and the assets it is installed on. */
  private async technologiesOf(mg: EntityManager, tenantId: string, fallenIds: string[], ref: (id: string) => ImpactRef): Promise<ImpactTechnology[]> {
    const rows: Array<{ id: string; item_number: number; name: string; asset_id: string; version: string | null }> = await mg.query(
      `SELECT t.id, t.item_number, t.name, at.asset_id, v.label AS version
         FROM asset_technologies at
         JOIN assets s ON s.tenant_id = $1 AND s.id = at.asset_id AND ${assetInService('s')}
         JOIN technologies t ON t.tenant_id = $1 AND t.id = at.technology_id
         LEFT JOIN technology_versions v ON v.tenant_id = $1 AND v.id = at.technology_version_id
        WHERE at.tenant_id = $1 AND at.asset_id = ANY($2::uuid[])`,
      [tenantId, fallenIds],
    );
    const byId = new Map<string, { item: ImpactTechnology; assets: Set<string>; versions: Set<string> }>();
    for (const row of rows) {
      const entry = byId.get(row.id) ?? { item: { id: row.id, reference: `TEC-${row.item_number}`, name: row.name, versions: [], via: [], via_total: 0 }, assets: new Set(), versions: new Set() };
      entry.assets.add(row.asset_id);
      if (row.version) entry.versions.add(row.version);
      byId.set(row.id, entry);
    }
    return Array.from(byId.values())
      .map(({ item, assets, versions }) => ({
        ...item,
        versions: Array.from(versions).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
        via: Array.from(assets).map(ref).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
      }))
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
      const item = byId.get(row.id) ?? { id: row.id, name: row.name, via: [], via_total: 0 };
      item.via.push({ id: row.application_id, name: appNames.get(row.application_id) ?? '' });
      byId.set(row.id, item);
    }
    const items = Array.from(byId.values());
    for (const item of items) item.via.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return items.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }
}
