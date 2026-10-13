import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The CAPEX workspace used notes for the text labelled Description. Move that text into the
 * existing description column, preserving lines that already have both texts. Both columns
 * have the same search weight: keep the existing vector and freshness counters untouched.
 *
 * down() is intentionally lossy: it cannot distinguish a migrated description from one written
 * later. Lines with both texts keep them; a description with empty notes returns to notes.
 */
export class CapexNotesToDescription1854010000000 implements MigrationInterface {
  name = 'CapexNotesToDescription1854010000000';

  up(runner: QueryRunner): Promise<void> {
    return this.move(runner, false);
  }

  down(runner: QueryRunner): Promise<void> {
    return this.move(runner, true);
  }

  private async move(runner: QueryRunner, reverse: boolean): Promise<void> {
    // Own a transaction, or a savepoint in the migration runner's transaction. A SQL failure
    // rolls back the writes AND the temporary RLS/trigger states before it is rethrown.
    const ownTransaction = !runner.isTransactionActive;
    if (ownTransaction) await runner.startTransaction();
    else await runner.query('SAVEPOINT capex_description_move');
    try {
      await runner.query('LOCK TABLE spend_items IN SHARE ROW EXCLUSIVE MODE');
      const [security] = await runner.query(
        `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced
           FROM pg_class WHERE oid = 'spend_items'::regclass`,
      );
      const triggers: Array<{ name: string; state: string }> = await runner.query(
        `SELECT tgname AS name, tgenabled::text AS state FROM pg_trigger
          WHERE tgrelid = 'spend_items'::regclass AND NOT tgisinternal ORDER BY tgname`,
      );
      if (security.enabled) await runner.query('ALTER TABLE spend_items DISABLE ROW LEVEL SECURITY');
      const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
      for (const trigger of triggers) {
        if (trigger.state !== 'D') await runner.query(`ALTER TABLE spend_items DISABLE TRIGGER ${quote(trigger.name)}`);
      }
      const rows: Array<{ tenant_id: string; slug: string; moved: number }> = await runner.query(
        `WITH moved AS (
           UPDATE spend_items SET ${reverse ? 'notes = description, description = NULL' : 'description = notes, notes = NULL'}
            WHERE nature = 'capex'
              AND NULLIF(btrim(${reverse ? 'notes' : 'description'}), '') IS NULL
              ${reverse ? '' : "AND NULLIF(btrim(notes), '') IS NOT NULL"}
           RETURNING tenant_id
         ), counts AS (SELECT tenant_id, count(*)::int AS moved FROM moved GROUP BY tenant_id)
         SELECT t.id AS tenant_id, t.slug, COALESCE(c.moved, 0)::int AS moved
           FROM tenants t LEFT JOIN counts c ON c.tenant_id = t.id ORDER BY t.slug`,
      );
      const enable: Record<string, string> = { O: 'ENABLE', A: 'ENABLE ALWAYS', R: 'ENABLE REPLICA' };
      for (const trigger of triggers) {
        if (trigger.state !== 'D') await runner.query(`ALTER TABLE spend_items ${enable[trigger.state]} TRIGGER ${quote(trigger.name)}`);
      }
      if (security.enabled) await runner.query('ALTER TABLE spend_items ENABLE ROW LEVEL SECURITY');
      await runner.query(`ALTER TABLE spend_items ${security.forced ? 'FORCE' : 'NO FORCE'} ROW LEVEL SECURITY`);
      if (ownTransaction) await runner.commitTransaction();
      else await runner.query('RELEASE SAVEPOINT capex_description_move');
      for (const row of rows) {
        console.log(`[Migration] CapexNotesToDescription: ${row.slug} (${row.tenant_id}): ${row.moved} line(s) ${reverse ? 'returned to notes' : 'moved to description'}`);
      }
      console.log(`[Migration] CapexNotesToDescription: total ${rows.reduce((sum, row) => sum + row.moved, 0)} line(s)`);
    } catch (error) {
      if (ownTransaction) await runner.rollbackTransaction();
      else {
        await runner.query('ROLLBACK TO SAVEPOINT capex_description_move');
        await runner.query('RELEASE SAVEPOINT capex_description_move');
      }
      throw error;
    }
  }
}
