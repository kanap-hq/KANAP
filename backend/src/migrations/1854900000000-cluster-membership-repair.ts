import { MigrationInterface, QueryRunner } from 'typeorm';

type RemovedMembership = {
  tenant_id: string;
  slug: string | null;
  category: 'self' | 'not_a_cluster' | 'member_is_cluster';
  count: number;
};

/**
 * Removes the cluster memberships the rules no longer allow, in every tenant:
 * 1. `not_a_cluster`: the cluster is no longer a cluster (`assets.is_cluster` false);
 * 2. `member_is_cluster`: the member is itself a cluster;
 * 3. `self`: `cluster_id = asset_id`.
 * A row that falls in several categories is counted once: `self` first, then in the order above.
 * The API refuses all three since this release (switch guard and member checks), so a rerun finds
 * nothing. No constraint, no audit entry. down() does nothing: the pre-deploy snapshot is the recovery.
 *
 * Migrations run without app.current_tenant and FORCE applies to the owner, so RLS is disabled
 * on asset_cluster_members (the delete) and assets (the joins), then put back as it was found.
 * Neither table has a trigger that reads tenant data on this delete.
 */
export class ClusterMembershipRepair1854900000000 implements MigrationInterface {
  name = 'ClusterMembershipRepair1854900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const states: Array<{ relname: string; enabled: boolean; forced: boolean }> = await queryRunner.query(
      `SELECT relname, relrowsecurity AS enabled, relforcerowsecurity AS forced
         FROM pg_class
        WHERE relname IN ('asset_cluster_members', 'assets') AND relnamespace = 'public'::regnamespace`,
    );
    for (const state of states) {
      await queryRunner.query(`ALTER TABLE ${state.relname} DISABLE ROW LEVEL SECURITY`);
    }
    let removed: RemovedMembership[];
    try {
      removed = await queryRunner.query(`
        WITH removed AS (
          DELETE FROM asset_cluster_members m
           USING assets c, assets a
           WHERE c.tenant_id = m.tenant_id AND c.id = m.cluster_id
             AND a.tenant_id = m.tenant_id AND a.id = m.asset_id
             AND (COALESCE(c.is_cluster, false) = false OR COALESCE(a.is_cluster, false) = true OR m.cluster_id = m.asset_id)
          RETURNING m.tenant_id,
                    CASE
                      WHEN m.cluster_id = m.asset_id THEN 'self'
                      WHEN COALESCE(c.is_cluster, false) = false THEN 'not_a_cluster'
                      ELSE 'member_is_cluster'
                    END AS category
        )
        SELECT r.tenant_id, t.slug, r.category, count(*)::int AS count
          FROM removed r
          LEFT JOIN tenants t ON t.id = r.tenant_id
         GROUP BY r.tenant_id, t.slug, r.category
         ORDER BY t.slug NULLS LAST, r.tenant_id, r.category
      `);
    } finally {
      for (const state of states) {
        if (state.enabled) await queryRunner.query(`ALTER TABLE ${state.relname} ENABLE ROW LEVEL SECURITY`);
        if (state.forced) await queryRunner.query(`ALTER TABLE ${state.relname} FORCE ROW LEVEL SECURITY`);
      }
    }
    logRemoved(removed);
  }

  public async down(): Promise<void> {
    // Nothing to undo: the removed rows broke the cluster rules.
  }
}

function logRemoved(removed: RemovedMembership[]) {
  const prefix = '[Migration] ClusterMembershipRepair:';
  if (removed.length === 0) {
    console.log(`${prefix} no invalid cluster membership, nothing removed`);
    return;
  }
  for (const row of removed) {
    console.log(`${prefix} tenant ${row.slug ?? '(unknown)'} (${row.tenant_id}): ${row.count} membership(s) removed, ${row.category}`);
  }
}
