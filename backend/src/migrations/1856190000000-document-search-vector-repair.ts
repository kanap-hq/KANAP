import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Documents keep their search vector: the trigger is the only writer of
 * `documents.search_vector`, and the documents whose vector is missing or out
 * of date are repaired.
 *
 * The expression of the vector moves into `documents_search_vector_compute()`,
 * which the trigger calls (same text, same weights, same configurations as
 * 1852900000000). It is the single definition: this repair and the specs call
 * it to recompute a vector, rather than copying the expression.
 *
 * Repair: every document whose vector differs from the recomputed one (NULL
 * or stale) gets it again. The entity used to write the vector back after a
 * versioned save (`Document.search_vector` is no longer written by TypeORM),
 * so such documents exist on every installation.
 *
 * Migrations run without app.current_tenant and documents is under FORCE ROW
 * LEVEL SECURITY, so the update runs tenant by tenant with a
 * transaction-local `app.current_tenant`: the `search_index` trigger on
 * documents (`trg_search_index_documents`, any UPDATE) refreshes the search
 * entries of the repaired rows, and it writes tenant tables. The update names
 * only search_vector: the vector trigger and the incident review trigger,
 * which fire on title, summary or content_plain, stay quiet.
 *
 * The count of repaired documents is logged per tenant (tenant id and count).
 * A second run finds nothing to repair and updates no row.
 *
 * down() puts the expression back inline in the trigger function and drops
 * the helper. Repaired vectors stay: they are what the trigger computes.
 */
export class DocumentSearchVectorRepair1856190000000 implements MigrationInterface {
  name = 'DocumentSearchVectorRepair1856190000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION documents_search_vector_compute(p_title text, p_summary text, p_content_plain text)
      RETURNS tsvector
      LANGUAGE sql
      STABLE
      PARALLEL SAFE
      AS $$
        SELECT
          setweight(to_tsvector('kanap_fr', coalesce(p_title, '')), 'A') ||
          setweight(to_tsvector('kanap_en', coalesce(p_title, '')), 'A') ||
          setweight(to_tsvector('kanap_fr', coalesce(p_summary, '')), 'A') ||
          setweight(to_tsvector('kanap_en', coalesce(p_summary, '')), 'A') ||
          setweight(to_tsvector('kanap_fr', coalesce(p_content_plain, '')), 'B') ||
          setweight(to_tsvector('kanap_en', coalesce(p_content_plain, '')), 'B')
      $$
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION documents_search_vector_sync()
      RETURNS trigger AS $$
      BEGIN
        NEW.search_vector := documents_search_vector_compute(NEW.title, NEW.summary, NEW.content_plain);
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql
    `);

    // The tenant setting is transaction-local: without the migration
    // transaction, it would be gone before the update and the update would
    // silently see no row.
    const ownTransaction = !queryRunner.isTransactionActive;
    if (ownTransaction) await queryRunner.startTransaction();
    try {
      const [previous] = await queryRunner.query(
        `SELECT coalesce(current_setting('app.current_tenant', true), '') AS value`,
      );
      const tenants: Array<{ id: string }> = await queryRunner.query(
        `SELECT id FROM tenants ORDER BY created_at ASC, id ASC`,
      );
      let total = 0;
      for (const tenant of tenants) {
        await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);
        const [row] = await queryRunner.query(
          `WITH repaired AS (
             UPDATE documents
                SET search_vector = documents_search_vector_compute(title, summary, content_plain)
              WHERE tenant_id = $1
                AND search_vector IS DISTINCT FROM documents_search_vector_compute(title, summary, content_plain)
             RETURNING 1
           )
           SELECT count(*)::int AS count FROM repaired`,
          [tenant.id],
        );
        const count = Number(row?.count ?? 0);
        if (count > 0) {
          total += count;
          console.log(`[${this.name}] tenant ${tenant.id}: ${count} document search vector(s) repaired`);
        }
      }
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [previous?.value ?? '']);
      console.log(`[${this.name}] ${total} document search vector(s) repaired in ${tenants.length} tenant(s)`);
      if (ownTransaction) await queryRunner.commitTransaction();
    } catch (err) {
      if (ownTransaction) await queryRunner.rollbackTransaction();
      throw err;
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION documents_search_vector_sync()
      RETURNS trigger AS $$
      BEGIN
        NEW.search_vector :=
          setweight(to_tsvector('kanap_fr', coalesce(NEW.title, '')), 'A') ||
          setweight(to_tsvector('kanap_en', coalesce(NEW.title, '')), 'A') ||
          setweight(to_tsvector('kanap_fr', coalesce(NEW.summary, '')), 'A') ||
          setweight(to_tsvector('kanap_en', coalesce(NEW.summary, '')), 'A') ||
          setweight(to_tsvector('kanap_fr', coalesce(NEW.content_plain, '')), 'B') ||
          setweight(to_tsvector('kanap_en', coalesce(NEW.content_plain, '')), 'B');
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`DROP FUNCTION IF EXISTS documents_search_vector_compute(text, text, text)`);
  }
}
