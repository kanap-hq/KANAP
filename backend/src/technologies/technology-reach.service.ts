import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { LinkSource } from '../common/link-provenance';

/**
 * What a technology reaches, and what reaches an application or an asset (plan
 * planning/cartographie-technologies.md, "Déductions"). Nothing is stored: every answer is read
 * from the links and the asset graph at the time.
 *
 * The asset graph has two "carries" edges:
 * - `asset_relations` of type `contains`: the container carries what it contains (a host its VMs);
 * - `asset_cluster_members`: a member carries its cluster (the hosts carry the vSphere cluster, the
 *   SQL nodes carry the SQL cluster).
 * A technology installed on an asset (`asset_technologies`) reaches that asset and what it carries,
 * at most `MAX_DEPTH` edges away, never twice on one path (a `contains` cycle A <-> B stops). Every
 * reached asset keeps the asset the technology is installed on (`via`, null on that asset itself)
 * and the version of that link (null when unknown). The applications of a technology are those
 * assigned to a reached asset (hosted), plus those that declare it (`application_technologies`).
 *
 * Over-approximation is assumed and shown: an application on a server carrying SQL Server 2016 and
 * 2019 is listed with both. Each statement is static SQL, carries `tenant_id` on every table and
 * join besides RLS, and works on a batch of ids (`= ANY($n)`), never a query per row.
 */
export const MAX_DEPTH = 3;

/** The "carries" edges of the tenant `$1`: `carrier` carries `carried`. */
const EDGES = `(
  SELECT r.asset_id AS carrier, r.related_asset_id AS carried
    FROM asset_relations r WHERE r.tenant_id = $1 AND r.relation_type = 'contains'
  UNION ALL
  SELECT m.asset_id, m.cluster_id FROM asset_cluster_members m WHERE m.tenant_id = $1
)`;

/** Down the edges from the installed links of the technologies `$2`: one row per reached asset and link. */
const REACH_FROM_TECHNOLOGIES = `
  reach AS (
    SELECT at.technology_id, at.id AS link_id, at.asset_id, at.asset_id AS installed_on, at.technology_version_id,
           at.source, 0 AS depth, ARRAY[at.asset_id] AS path
      FROM asset_technologies at
     WHERE at.tenant_id = $1 AND at.technology_id = ANY($2::uuid[])
    UNION ALL
    SELECT r.technology_id, r.link_id, e.carried, r.installed_on, r.technology_version_id, r.source, r.depth + 1, r.path || e.carried
      FROM reach r
      JOIN ${EDGES} e ON e.carrier = r.asset_id
     WHERE r.depth < ${MAX_DEPTH} AND NOT e.carried = ANY(r.path)
  )`;

/** Up the edges from the assets `$2`: one row per asset and carrier (the asset itself at depth 0). */
const CARRIERS_OF_ASSETS = `
  up AS (
    SELECT a.id AS asset_id, a.id AS carrier_id, 0 AS depth, ARRAY[a.id] AS path
      FROM assets a WHERE a.tenant_id = $1 AND a.id = ANY($2::uuid[])
    UNION ALL
    SELECT u.asset_id, e.carrier, u.depth + 1, u.path || e.carrier
      FROM up u
      JOIN ${EDGES} e ON e.carried = u.carrier_id
     WHERE u.depth < ${MAX_DEPTH} AND NOT e.carrier = ANY(u.path)
  )`;

/** An asset that carries the technology: directly (`via` null, with its link) or through `via`. */
export type ReachedAsset = {
  technology_id: string;
  asset_id: string;
  /** The asset the technology is installed on, when not this one. */
  via_asset_id: string | null;
  technology_version_id: string | null;
  /** The link row, for a direct link only (removable, editable). */
  link_id: string | null;
  source: LinkSource;
  depth: number;
};

/** An application of the technology, hosted on a reached asset or declaring it. */
export type ReachedApplication = {
  technology_id: string;
  application_id: string;
  kind: 'hosted' | 'declared';
  /** Hosted: the instance's environment and the server it is assigned to. */
  environment: string | null;
  asset_id: string | null;
  /** Hosted: the asset the technology is installed on, when not the server itself. */
  via_asset_id: string | null;
  technology_version_id: string | null;
  /** Declared: the link row. */
  link_id: string | null;
  source: LinkSource;
};

/** A technology of an application or an asset, with the path that brings it. */
export type ReachingTechnology = {
  /** The application or asset asked for. */
  subject_id: string;
  technology_id: string;
  kind: 'installed' | 'carried' | 'hosted' | 'declared';
  technology_version_id: string | null;
  /** Hosted: the environment of the instance. */
  environment: string | null;
  /** Hosted (applications): the server the instance is assigned to. */
  asset_id: string | null;
  /** Carried or hosted through a carrier: the asset the technology is installed on. */
  via_asset_id: string | null;
  link_id: string | null;
  source: LinkSource;
};

export type TechnologyCounts = {
  technology_id: string;
  servers: number;
  applications: number;
  versions_in_use: number;
  /** The earliest standard end of support still to come among the versions in use, YYYY-MM-DD. */
  next_support_end: string | null;
  /** Versions in use whose standard support has ended. */
  ended_versions: number;
};

const DAY = (expr: string) => `to_char(${expr}, 'YYYY-MM-DD')`;

/** Distinct reached assets, keeping for each one the shortest path (direct links first). */
const REACHED_ASSETS_SELECT = `
  SELECT DISTINCT ON (r.technology_id, r.asset_id, r.technology_version_id, r.installed_on)
         r.technology_id, r.asset_id,
         CASE WHEN r.depth = 0 THEN NULL ELSE r.installed_on END AS via_asset_id,
         r.technology_version_id,
         CASE WHEN r.depth = 0 THEN r.link_id ELSE NULL END AS link_id,
         r.source, r.depth
    FROM reach r
   ORDER BY r.technology_id, r.asset_id, r.technology_version_id, r.installed_on, r.depth`;

/**
 * Runs a deduction with JIT compilation off for this statement. The planner cannot estimate a
 * recursive CTE: it expects millions of rows where there are thousands, the cost passes
 * `jit_above_cost`, and compiling the plan then takes about 300 ms for a query that runs in 50
 * (measured on a tenant of 16 000 assets). The setting is transaction-local and restored as found.
 */
async function withoutJit<T>(mg: Pick<EntityManager, 'query'>, sql: string, params: unknown[]): Promise<T[]> {
  const [{ jit }]: Array<{ jit: string }> = await mg.query(`SELECT current_setting('jit') AS jit`);
  if (jit === 'off') return mg.query(sql, params);
  await mg.query(`SELECT set_config('jit', 'off', true)`);
  try {
    return await mg.query(sql, params);
  } finally {
    // After a failed statement the transaction refuses this; its rollback restores the setting.
    await mg.query(`SELECT set_config('jit', $1, true)`, [jit]).catch(() => undefined);
  }
}

@Injectable()
export class TechnologyReachService {
  /** The assets that carry each technology of `technologyIds`, directly or through the graph. */
  async assetsOfTechnologies(mg: EntityManager, tenantId: string, technologyIds: string[]): Promise<ReachedAsset[]> {
    if (technologyIds.length === 0) return [];
    const rows: ReachedAsset[] = await withoutJit(mg, 
      `WITH RECURSIVE ${REACH_FROM_TECHNOLOGIES}
       ${REACHED_ASSETS_SELECT}`,
      [tenantId, technologyIds],
    );
    return rows.map((row) => ({ ...row, depth: Number(row.depth) }));
  }

  /**
   * The applications of each technology of `technologyIds`: hosted (an instance assigned to a
   * reached asset, per environment, server and version) and declared.
   */
  async applicationsOfTechnologies(mg: EntityManager, tenantId: string, technologyIds: string[]): Promise<ReachedApplication[]> {
    if (technologyIds.length === 0) return [];
    return withoutJit(mg, 
      `WITH RECURSIVE ${REACH_FROM_TECHNOLOGIES},
       reached AS (${REACHED_ASSETS_SELECT})
       SELECT r.technology_id, i.application_id, 'hosted' AS kind, i.environment, r.asset_id, r.via_asset_id,
              r.technology_version_id, NULL::uuid AS link_id, r.source
         FROM reached r
         -- One row per instance and server, whatever the roles (no DISTINCT over the whole result:
         -- the recursive estimate is far too high and its hash table alone costs more than the query).
         JOIN (SELECT DISTINCT a.app_instance_id, a.asset_id FROM app_asset_assignments a WHERE a.tenant_id = $1) x ON x.asset_id = r.asset_id
         JOIN app_instances i ON i.tenant_id = $1 AND i.id = x.app_instance_id
       UNION ALL
       SELECT d.technology_id, d.application_id, 'declared', NULL, NULL, NULL, d.technology_version_id, d.id, d.source
         FROM application_technologies d
        WHERE d.tenant_id = $1 AND d.technology_id = ANY($2::uuid[])`,
      [tenantId, technologyIds],
    );
  }

  /**
   * The technologies of each asset of `assetIds`: installed on it, or carried to it by the graph
   * (`via` the asset they are installed on).
   */
  async technologiesOfAssets(mg: EntityManager, tenantId: string, assetIds: string[]): Promise<ReachingTechnology[]> {
    if (assetIds.length === 0) return [];
    return withoutJit(mg, 
      `WITH RECURSIVE ${CARRIERS_OF_ASSETS}
       SELECT DISTINCT ON (u.asset_id, at.id)
              u.asset_id AS subject_id, at.technology_id,
              CASE WHEN u.depth = 0 THEN 'installed' ELSE 'carried' END AS kind,
              at.technology_version_id, NULL::text AS environment, NULL::uuid AS asset_id,
              CASE WHEN u.depth = 0 THEN NULL ELSE u.carrier_id END AS via_asset_id,
              at.id AS link_id, at.source
         FROM up u
         JOIN asset_technologies at ON at.tenant_id = $1 AND at.asset_id = u.carrier_id
        ORDER BY u.asset_id, at.id, u.depth`,
      [tenantId, assetIds],
    );
  }

  /**
   * The technologies of each application of `applicationIds`: declared, and hosted (installed on
   * or carried to a server an instance is assigned to, per environment and server).
   */
  async technologiesOfApplications(mg: EntityManager, tenantId: string, applicationIds: string[]): Promise<ReachingTechnology[]> {
    if (applicationIds.length === 0) return [];
    return withoutJit(mg, 
      `WITH RECURSIVE servers AS (
         SELECT DISTINCT i.application_id, i.environment, x.asset_id
           FROM app_instances i
           JOIN app_asset_assignments x ON x.tenant_id = $1 AND x.app_instance_id = i.id
          WHERE i.tenant_id = $1 AND i.application_id = ANY($2::uuid[])
       ),
       up AS (
         SELECT s.asset_id, s.asset_id AS carrier_id, 0 AS depth, ARRAY[s.asset_id] AS path
           FROM (SELECT DISTINCT asset_id FROM servers) s
         UNION ALL
         SELECT u.asset_id, e.carrier, u.depth + 1, u.path || e.carrier
           FROM up u
           JOIN ${EDGES} e ON e.carried = u.carrier_id
          WHERE u.depth < ${MAX_DEPTH} AND NOT e.carrier = ANY(u.path)
       ),
       carried AS (
         SELECT DISTINCT ON (u.asset_id, at.id) u.asset_id, u.carrier_id, u.depth, at.id AS link_id, at.technology_id,
                at.technology_version_id, at.source
           FROM up u
           JOIN asset_technologies at ON at.tenant_id = $1 AND at.asset_id = u.carrier_id
          ORDER BY u.asset_id, at.id, u.depth
       )
       SELECT s.application_id AS subject_id, c.technology_id, 'hosted' AS kind, c.technology_version_id,
              s.environment, s.asset_id,
              CASE WHEN c.depth = 0 THEN NULL ELSE c.carrier_id END AS via_asset_id,
              NULL::uuid AS link_id, c.source
         FROM servers s
         JOIN carried c ON c.asset_id = s.asset_id
       UNION ALL
       SELECT d.application_id, d.technology_id, 'declared', d.technology_version_id, NULL, NULL, NULL, d.id, d.source
         FROM application_technologies d
        WHERE d.tenant_id = $1 AND d.application_id = ANY($2::uuid[])`,
      [tenantId, applicationIds],
    );
  }

  /**
   * The counters of the technology list for a page of ids, in one statement: servers reached,
   * applications (hosted or declared), versions in use (on an asset or declared), the next
   * standard end of support among them and how many have ended.
   */
  async countsOfTechnologies(mg: EntityManager, tenantId: string, technologyIds: string[]): Promise<Map<string, TechnologyCounts>> {
    const out = new Map<string, TechnologyCounts>();
    if (technologyIds.length === 0) return out;
    const rows: Array<Record<string, any>> = await withoutJit(mg, 
      `WITH RECURSIVE ${REACH_FROM_TECHNOLOGIES},
       servers AS (
         SELECT r.technology_id, count(DISTINCT r.asset_id)::int AS servers FROM reach r GROUP BY r.technology_id
       ),
       apps AS (
         SELECT h.technology_id, count(DISTINCT h.application_id)::int AS applications
           FROM (
             SELECT r.technology_id, i.application_id
               FROM reach r
               JOIN app_asset_assignments x ON x.tenant_id = $1 AND x.asset_id = r.asset_id
               JOIN app_instances i ON i.tenant_id = $1 AND i.id = x.app_instance_id
             UNION ALL
             SELECT d.technology_id, d.application_id FROM application_technologies d
              WHERE d.tenant_id = $1 AND d.technology_id = ANY($2::uuid[])
           ) h
          GROUP BY h.technology_id
       ),
       used AS (
         SELECT technology_id, technology_version_id FROM asset_technologies
          WHERE tenant_id = $1 AND technology_id = ANY($2::uuid[]) AND technology_version_id IS NOT NULL
         UNION
         SELECT technology_id, technology_version_id FROM application_technologies
          WHERE tenant_id = $1 AND technology_id = ANY($2::uuid[]) AND technology_version_id IS NOT NULL
       ),
       versions AS (
         SELECT u.technology_id,
                count(*)::int AS versions_in_use,
                min(v.standard_support_end) FILTER (WHERE v.standard_support_end >= CURRENT_DATE) AS next_end,
                count(*) FILTER (WHERE v.standard_support_end < CURRENT_DATE)::int AS ended
           FROM used u
           JOIN technology_versions v ON v.tenant_id = $1 AND v.technology_id = u.technology_id AND v.id = u.technology_version_id
          GROUP BY u.technology_id
       )
       SELECT t.id AS technology_id,
              COALESCE(s.servers, 0) AS servers,
              COALESCE(a.applications, 0) AS applications,
              COALESCE(v.versions_in_use, 0) AS versions_in_use,
              ${DAY('v.next_end')} AS next_support_end,
              COALESCE(v.ended, 0) AS ended_versions
         FROM technologies t
         LEFT JOIN servers s ON s.technology_id = t.id
         LEFT JOIN apps a ON a.technology_id = t.id
         LEFT JOIN versions v ON v.technology_id = t.id
        WHERE t.tenant_id = $1 AND t.id = ANY($2::uuid[])`,
      [tenantId, technologyIds],
    );
    for (const row of rows) {
      out.set(row.technology_id, {
        technology_id: row.technology_id,
        servers: Number(row.servers) || 0,
        applications: Number(row.applications) || 0,
        versions_in_use: Number(row.versions_in_use) || 0,
        next_support_end: row.next_support_end ?? null,
        ended_versions: Number(row.ended_versions) || 0,
      });
    }
    return out;
  }
}
