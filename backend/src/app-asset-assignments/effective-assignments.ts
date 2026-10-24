import { assetInServiceSql } from '../technologies/technology-reach.service';

/**
 * The one definition of the servers a deployment runs on (clusters pass, PR B: an application
 * assigned to a cluster counts for its members).
 *
 * Rule:
 * - An assignment (`app_asset_assignments`) may sit on a cluster. It is one row, on the cluster,
 *   and the cluster keeps it: the cluster is itself a server of the application.
 * - What a member shows is computed when read: its own rows, plus the rows of its clusters,
 *   marked as coming through them (`inherited`, `via_clusters`). A member added to a cluster
 *   inherits at once; a member taken out loses everything it inherited. A member is never a
 *   cluster, so nothing goes further.
 * - A retired member (`assetInServiceSql`) inherits nothing, and a retired cluster passes nothing
 *   on: it keeps its own row only. A direct row on a retired asset stays as it is.
 * - One effective row per (tenant, deployment, server, role). A member of two clusters that carry
 *   the same deployment and role: one row, `via_clusters` names both. A direct row and an inherited
 *   one alike (older data): the direct one wins (`inherited` false, its id, date and notes), and
 *   `via_clusters` still names the clusters.
 *
 * Form: a function that returns a SQL fragment, on the model of
 * `vulnerabilities/vulnerability-reach-counts.ts`. The caller passes placeholders or columns, never
 * values. Every table and join carries `tenant_id`; inner aliases start with `ea_`. Batches go by
 * `= ANY(<array>)`, never a query per id.
 */

/**
 * Which rows the fragment selects. `tenant`: the tenant (a placeholder or a column). `instances`,
 * `assets`, `applications`: SQL arrays of ids (`$2`, `ARRAY[a.id]`); every row of the tenant when
 * absent. `assets` filters on the server the row is effective for (the member, for an inherited
 * row).
 */
export type EffectiveAssignmentScope = { tenant: string; instances?: string; assets?: string; applications?: string };

/**
 * The effective assignments, one row per `(tenant_id, app_instance_id, asset_id, role)`, with:
 * `assignment_id` (the direct row, else the row of the first cluster by name that gives it),
 * `since_date`, `notes`, `created_at`, `updated_at` (of that row), `inherited` (no direct row), and
 * `via_clusters`, a jsonb array `[{ id, name }]` of the clusters that give the row, sorted by name
 * (`[]` for a row only direct).
 */
export function effectiveAssignmentsSql(p: EffectiveAssignmentScope): string {
  const instances = (row: string) => (p.instances ? ` AND ${row}.app_instance_id = ANY(${p.instances}::uuid[])` : '');
  const applications = (row: string, alias: string) => (p.applications
    ? `JOIN app_instances ${alias} ON ${alias}.tenant_id = ${row}.tenant_id AND ${alias}.id = ${row}.app_instance_id AND ${alias}.application_id = ANY(${p.applications}::uuid[])`
    : '');
  const winner = (column: string) => `(array_agg(ea_c.${column} ORDER BY ea_c.inherited, ea_c.via_name, ea_c.via_id))[1] AS ${column}`;
  return `SELECT ea_c.tenant_id, ea_c.app_instance_id, ea_c.asset_id, ea_c.role,
            ${winner('assignment_id')}, ${winner('since_date')}, ${winner('notes')}, ${winner('created_at')}, ${winner('updated_at')},
            bool_and(ea_c.inherited) AS inherited,
            COALESCE(jsonb_agg(jsonb_build_object('id', ea_c.via_id, 'name', ea_c.via_name) ORDER BY ea_c.via_name, ea_c.via_id)
                       FILTER (WHERE ea_c.via_id IS NOT NULL), '[]'::jsonb) AS via_clusters
       FROM (
         SELECT ea_x.tenant_id, ea_x.app_instance_id, ea_x.asset_id, ea_x.role, ea_x.id AS assignment_id, ea_x.since_date, ea_x.notes,
                ea_x.created_at, ea_x.updated_at, false AS inherited, NULL::uuid AS via_id, NULL::text AS via_name
           FROM app_asset_assignments ea_x
           ${applications('ea_x', 'ea_xi')}
          WHERE ea_x.tenant_id = ${p.tenant}${instances('ea_x')}${p.assets ? ` AND ea_x.asset_id = ANY(${p.assets}::uuid[])` : ''}
         UNION ALL
         SELECT ea_y.tenant_id, ea_y.app_instance_id, ea_m.asset_id, ea_y.role, ea_y.id, ea_y.since_date, ea_y.notes,
                ea_y.created_at, ea_y.updated_at, true, ea_cl.id, ea_cl.name
           FROM app_asset_assignments ea_y
           JOIN asset_cluster_members ea_m ON ea_m.tenant_id = ea_y.tenant_id AND ea_m.cluster_id = ea_y.asset_id
           JOIN assets ea_cl ON ea_cl.tenant_id = ea_y.tenant_id AND ea_cl.id = ea_y.asset_id AND ${assetInServiceSql('ea_cl')}
           JOIN assets ea_ma ON ea_ma.tenant_id = ea_m.tenant_id AND ea_ma.id = ea_m.asset_id AND ${assetInServiceSql('ea_ma')}
           ${applications('ea_y', 'ea_yi')}
          WHERE ea_y.tenant_id = ${p.tenant}${instances('ea_y')}${p.assets ? ` AND ea_m.asset_id = ANY(${p.assets}::uuid[])` : ''}
       ) ea_c
      GROUP BY ea_c.tenant_id, ea_c.app_instance_id, ea_c.asset_id, ea_c.role`;
}

/** One cluster's via entry of `via_clusters`. */
export type ViaCluster = { id: string; name: string };

/**
 * Which groupable sets `groupableAssignmentsSql` selects: `tenant` as above, `clusters` and
 * `instances` SQL arrays of ids (every cluster, every deployment when absent).
 */
export type GroupableScope = { tenant: string; clusters?: string; instances?: string };

/**
 * The direct assignments that could move to their cluster (A7): a deployment and role assigned
 * directly to every member in service of a cluster in service that has at least two (a retired
 * cluster passes nothing on, so nothing moves to it). One row per
 * `(cluster_id, app_instance_id, role)`, with `cluster_name` and `member_ids` (sorted by name).
 * Whether the cluster carries the row itself already does not matter.
 */
export function groupableAssignmentsSql(p: GroupableScope): string {
  const clusters = (column: string) => (p.clusters ? ` AND ${column} = ANY(${p.clusters}::uuid[])` : '');
  return `SELECT ga_m.cluster_id, ga_c.name AS cluster_name, ga_x.app_instance_id, ga_x.role,
                 array_agg(ga_m.asset_id ORDER BY ga_ma.name, ga_m.asset_id) AS member_ids
            FROM asset_cluster_members ga_m
            JOIN assets ga_ma ON ga_ma.tenant_id = ga_m.tenant_id AND ga_ma.id = ga_m.asset_id AND ${assetInServiceSql('ga_ma')}
            JOIN assets ga_c ON ga_c.tenant_id = ga_m.tenant_id AND ga_c.id = ga_m.cluster_id AND ${assetInServiceSql('ga_c')}
            JOIN app_asset_assignments ga_x ON ga_x.tenant_id = ga_m.tenant_id AND ga_x.asset_id = ga_m.asset_id
            JOIN (SELECT ga_s.cluster_id, count(*)::int AS n
                    FROM asset_cluster_members ga_s
                    JOIN assets ga_sa ON ga_sa.tenant_id = ga_s.tenant_id AND ga_sa.id = ga_s.asset_id AND ${assetInServiceSql('ga_sa')}
                   WHERE ga_s.tenant_id = ${p.tenant}${clusters('ga_s.cluster_id')}
                   GROUP BY ga_s.cluster_id
                  HAVING count(*) >= 2) ga_n ON ga_n.cluster_id = ga_m.cluster_id
           WHERE ga_m.tenant_id = ${p.tenant}${clusters('ga_m.cluster_id')}${p.instances ? ` AND ga_x.app_instance_id = ANY(${p.instances}::uuid[])` : ''}
           GROUP BY ga_m.cluster_id, ga_c.name, ga_x.app_instance_id, ga_x.role, ga_n.n
          HAVING count(*) = ga_n.n
           ORDER BY ga_c.name, ga_m.cluster_id, ga_x.app_instance_id, ga_x.role`;
}
