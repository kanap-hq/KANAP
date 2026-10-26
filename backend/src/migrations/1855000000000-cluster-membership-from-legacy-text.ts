import { MigrationInterface, QueryRunner } from 'typeorm';

type Outcome = 'inserted' | 'present' | 'unmatched' | 'ambiguous' | 'refused_cluster' | 'refused_self' | 'refused_os';

/**
 * Turns the legacy cluster text of an asset (`assets.cluster`, comma separated names) into real
 * memberships (`asset_cluster_members`), in every tenant. A name becomes a membership when it is
 * exactly one cluster of the tenant (`is_cluster`, case and outer spaces ignored), unless the asset
 * is itself a cluster, the name is the asset itself, or the cluster carries an operating system
 * (a cluster with members has none). An existing membership is kept, never doubled. When every
 * name of an asset is a membership, its text is emptied (`NULL`); otherwise it stays as it was.
 * Logged per tenant: memberships inserted, names without a cluster, ambiguous names, refused names.
 * A rerun inserts nothing. down() does nothing: the column itself stays (a later release drops it).
 *
 * Emptying `assets.cluster` fires `trg_search_index_assets`, which reads the asset and writes
 * `search_index` (both under FORCE RLS): the migration works tenant by tenant with
 * `app.current_tenant` set, instead of disabling RLS.
 */
export class ClusterMembershipFromLegacyText1855000000000 implements MigrationInterface {
  name = 'ClusterMembershipFromLegacyText1855000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tenants: Array<{ id: string; slug: string | null }> = await queryRunner.query(`SELECT id, slug::text AS slug FROM tenants ORDER BY id`);
    let logged = false;
    try {
      for (const tenant of tenants) {
        await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);
        const counts = await migrateTenant(queryRunner, tenant.id);
        if (Object.values(counts).some((count) => count > 0)) {
          logged = true;
          console.log(
            `[Migration] ClusterMembershipFromLegacyText: tenant ${tenant.slug ?? '(unknown)'} (${tenant.id}): `
            + `${counts.inserted} membership(s) inserted, ${counts.present} already present, ${counts.cleared} text(s) emptied, `
            + `${counts.unmatched} name(s) without a cluster, ${counts.ambiguous} ambiguous, `
            + `refused: ${counts.refused_cluster} cluster, ${counts.refused_self} self, ${counts.refused_os} operating system`,
          );
        }
      }
    } finally {
      await queryRunner.query(`SELECT set_config('app.current_tenant', '', true)`);
    }
    if (!logged) console.log('[Migration] ClusterMembershipFromLegacyText: no legacy cluster text, nothing to do');
  }

  public async down(): Promise<void> {
    // Nothing to undo: the memberships are what the text meant, and the text of a partly matched asset is kept.
  }
}

async function migrateTenant(queryRunner: QueryRunner, tenantId: string): Promise<Record<Outcome | 'cleared', number>> {
  const counts: Record<Outcome | 'cleared', number> = {
    inserted: 0, present: 0, unmatched: 0, ambiguous: 0, refused_cluster: 0, refused_self: 0, refused_os: 0, cleared: 0,
  };
  // One row per non-empty name of a legacy text, with its clusters and whether the membership exists.
  const names: Array<{
    asset_id: string;
    asset_is_cluster: boolean;
    cluster_ids: string[];
    has_os: boolean;
    present: boolean;
  }> = await queryRunner.query(
    `WITH named AS (
       SELECT a.id AS asset_id, COALESCE(a.is_cluster, false) AS asset_is_cluster, lower(btrim(n.name)) AS key
         FROM assets a
         CROSS JOIN LATERAL unnest(string_to_array(a.cluster, ',')) AS n(name)
        WHERE a.tenant_id = $1 AND a.cluster IS NOT NULL AND btrim(a.cluster) <> '' AND btrim(n.name) <> ''
     )
     SELECT n.asset_id, n.asset_is_cluster,
            COALESCE(array_agg(c.id ORDER BY c.id) FILTER (WHERE c.id IS NOT NULL), '{}') AS cluster_ids,
            bool_or(EXISTS (
              SELECT 1 FROM asset_technologies at
               WHERE at.tenant_id = c.tenant_id AND at.asset_id = c.id AND at.is_operating_system
            )) AS has_os,
            bool_or(EXISTS (
              SELECT 1 FROM asset_cluster_members m
               WHERE m.tenant_id = $1 AND m.cluster_id = c.id AND m.asset_id = n.asset_id
            )) AS present
       FROM named n
       LEFT JOIN assets c ON c.tenant_id = $1 AND c.is_cluster AND lower(btrim(c.name)) = n.key
      GROUP BY n.asset_id, n.asset_is_cluster, n.key
      ORDER BY n.asset_id, n.key`,
    [tenantId],
  );

  const inserts: Array<{ cluster: string; asset: string }> = [];
  const complete = new Map<string, boolean>();
  for (const name of names) {
    let outcome: Outcome;
    if (name.cluster_ids.length === 0) outcome = 'unmatched';
    else if (name.cluster_ids.length > 1) outcome = 'ambiguous';
    else if (name.cluster_ids[0] === name.asset_id) outcome = 'refused_self';
    else if (name.asset_is_cluster) outcome = 'refused_cluster';
    else if (name.present) outcome = 'present';
    else if (name.has_os) outcome = 'refused_os';
    else outcome = 'inserted';
    counts[outcome] += 1;
    if (outcome === 'inserted') inserts.push({ cluster: name.cluster_ids[0], asset: name.asset_id });
    const taken = outcome === 'inserted' || outcome === 'present';
    complete.set(name.asset_id, (complete.get(name.asset_id) ?? true) && taken);
  }

  if (inserts.length > 0) {
    const inserted: Array<{ count: number }> = await queryRunner.query(
      `WITH added AS (
         INSERT INTO asset_cluster_members (tenant_id, cluster_id, asset_id)
         SELECT $1, x.cluster_id, x.asset_id
           FROM unnest($2::uuid[], $3::uuid[]) AS x(cluster_id, asset_id)
         ON CONFLICT (tenant_id, cluster_id, asset_id) DO NOTHING
         RETURNING 1
       )
       SELECT count(*)::int AS count FROM added`,
      [tenantId, inserts.map((i) => i.cluster), inserts.map((i) => i.asset)],
    );
    counts.inserted = Number(inserted[0]?.count ?? 0);
  }

  const cleared = [...complete.entries()].filter(([, done]) => done).map(([id]) => id);
  // A text made only of separators and spaces names nothing: it is emptied too.
  const emptied: Array<{ count: number }> = await queryRunner.query(
    `WITH emptied AS (
       UPDATE assets SET cluster = NULL
        WHERE tenant_id = $1 AND cluster IS NOT NULL
          AND (id = ANY($2::uuid[]) OR btrim(replace(cluster, ',', '')) = '')
       RETURNING 1
     )
     SELECT count(*)::int AS count FROM emptied`,
    [tenantId, cleared],
  );
  counts.cleared = Number(emptied[0]?.count ?? 0);
  return counts;
}
