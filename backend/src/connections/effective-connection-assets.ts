import { assetInServiceSql } from '../technologies/technology-reach.service';

/**
 * The one definition of the assets a connection carries (clusters pass, PR C1): an endpoint, a
 * server of a multi-server connection or the equipment of a hop written on a cluster is one stored
 * row, on the cluster; what a member shows is computed when read.
 *
 * Rule:
 * - A member sees its direct rows plus the rows of its clusters, marked as coming through them
 *   (`inherited`, `via_clusters`). A cluster sees nothing of its members. A member added to a
 *   cluster inherits at once; a member taken out loses everything it inherited.
 * - A retired member (`assetInServiceSql`) inherits nothing, and a retired cluster passes nothing
 *   on: it keeps its own row only. A direct row on a retired asset stays as it is.
 * - One effective row per (tenant, connection, asset, part, hop order), with the endpoints, the
 *   servers and the equipment of the hops told apart (`part`, `hop_order`). When the stored rows
 *   name a member directly and through its cluster (older data), the direct one wins: `inherited`
 *   is false and `via_clusters` still names the cluster.
 *
 * Form: a function that returns a SQL fragment, on the model of
 * `app-asset-assignments/effective-assignments.ts`. The caller passes placeholders or columns, never
 * values. Every table and join carries `tenant_id`; inner aliases start with `ea_`. Batches go by
 * `= ANY(<array>)`, never a query per id.
 */

export type ConnectionAssetPart = 'source' | 'destination' | 'server' | 'hop';

/**
 * Which rows the fragment selects. `tenant`: the tenant (a placeholder or a column). `connections`,
 * `assets`: SQL arrays of ids (`$2`, `ARRAY[...]`); every row of the tenant when absent. `assets`
 * filters on the asset the row is effective for (the member, for an inherited row).
 */
export type ConnectionAssetScope = { tenant: string; connections?: string; assets?: string };

/**
 * The effective connection assets, one row per
 * `(tenant_id, connection_id, asset_id, part, hop_order)`, with `inherited` (no direct row) and
 * `via_clusters`, a jsonb array `[{ id, name }]` of the clusters that give the row, sorted by name
 * (`[]` for a row only direct).
 */
export function effectiveConnectionAssetsSql(p: ConnectionAssetScope): string {
  const connections = (row: string, column: string) =>
    p.connections ? ` AND ${row}.${column} = ANY(${p.connections}::uuid[])` : '';
  // The named rows: every place a connection names an asset. Written once, read by both branches.
  const named = `
    SELECT ea_s.tenant_id, ea_s.id AS connection_id, ea_s.source_asset_id AS asset_id, 'source' AS part, NULL::int AS hop_order
      FROM connections ea_s
     WHERE ea_s.tenant_id = ${p.tenant} AND ea_s.source_asset_id IS NOT NULL${connections('ea_s', 'id')}
    UNION ALL
    SELECT ea_d.tenant_id, ea_d.id, ea_d.destination_asset_id, 'destination', NULL::int
      FROM connections ea_d
     WHERE ea_d.tenant_id = ${p.tenant} AND ea_d.destination_asset_id IS NOT NULL${connections('ea_d', 'id')}
    UNION ALL
    SELECT ea_sv.tenant_id, ea_sv.connection_id, ea_sv.asset_id, 'server', NULL::int
      FROM connection_servers ea_sv
     WHERE ea_sv.tenant_id = ${p.tenant}${connections('ea_sv', 'connection_id')}
    UNION ALL
    SELECT ea_hp.tenant_id, ea_hp.connection_id, ea_hp.equipment_asset_id, 'hop', ea_hp.order_index
      FROM connection_legs ea_hp
     WHERE ea_hp.tenant_id = ${p.tenant} AND ea_hp.equipment_asset_id IS NOT NULL${connections('ea_hp', 'connection_id')}
  `;
  return `SELECT ea_c.tenant_id, ea_c.connection_id, ea_c.asset_id, ea_c.part, ea_c.hop_order,
            bool_and(ea_c.inherited) AS inherited,
            COALESCE(jsonb_agg(jsonb_build_object('id', ea_c.via_id, 'name', ea_c.via_name) ORDER BY ea_c.via_name, ea_c.via_id)
                       FILTER (WHERE ea_c.via_id IS NOT NULL), '[]'::jsonb) AS via_clusters
       FROM (
         SELECT ea_nd.tenant_id, ea_nd.connection_id, ea_nd.asset_id, ea_nd.part, ea_nd.hop_order,
                false AS inherited, NULL::uuid AS via_id, NULL::text AS via_name
           FROM (${named}) ea_nd
          ${p.assets ? `WHERE ea_nd.asset_id = ANY(${p.assets}::uuid[])` : ''}
         UNION ALL
         SELECT ea_nh.tenant_id, ea_nh.connection_id, ea_m.asset_id, ea_nh.part, ea_nh.hop_order,
                true, ea_cl.id, ea_cl.name
           FROM (${named}) ea_nh
           JOIN asset_cluster_members ea_m ON ea_m.tenant_id = ea_nh.tenant_id AND ea_m.cluster_id = ea_nh.asset_id
           JOIN assets ea_cl ON ea_cl.tenant_id = ea_nh.tenant_id AND ea_cl.id = ea_nh.asset_id AND ${assetInServiceSql('ea_cl')}
           JOIN assets ea_ma ON ea_ma.tenant_id = ea_m.tenant_id AND ea_ma.id = ea_m.asset_id AND ${assetInServiceSql('ea_ma')}
          ${p.assets ? `WHERE ea_m.asset_id = ANY(${p.assets}::uuid[])` : ''}
       ) ea_c
      GROUP BY ea_c.tenant_id, ea_c.connection_id, ea_c.asset_id, ea_c.part, ea_c.hop_order`;
}

/** One cluster's via entry of `via_clusters`. */
export type ViaCluster = { id: string; name: string };
