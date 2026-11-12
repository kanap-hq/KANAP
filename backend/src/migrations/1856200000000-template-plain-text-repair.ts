import { MigrationInterface, QueryRunner } from 'typeorm';
import { markdownToSearchText } from '../common/markdown-search-text';

/**
 * The seeded templates of the Templates library get their body indexed.
 *
 * Until 26.11.7 the template seed (`knowledge/integrated-document-seed.ts`) inserted its templates
 * with an empty `content_plain`, so the body of the templates that ship one (incident review,
 * interface specification) never reached the search vector. The seed now derives the plain text;
 * this repair derives it for the templates seeded before, on every installation.
 *
 * Rows repaired: the documents of the `templates` library whose `content_plain` is empty while
 * their `content_markdown` is not. A template edited since has its plain text from the save and is
 * left alone. Nothing safer marks a seeded template: the slot settings point at it only while no
 * one has picked another template for the slot, and a seeded template moved off its slot keeps the
 * defect. The plain text is `markdownToSearchText`, the function of the seed and of every save
 * (the save runs it in the Markdown workers; a migration runs before the API serves and calls it
 * directly, which the markdown-worker-imports spec allows for `migrations/`). A body whose plain
 * text is empty stays as it is.
 *
 * Migrations run without app.current_tenant and documents is under FORCE ROW LEVEL SECURITY: the
 * repair runs tenant by tenant with a transaction-local `app.current_tenant`, because the update of
 * content_plain fires the vector trigger and the `search_index` triggers, which write tenant
 * tables. The count of repaired templates is logged per tenant; a second run finds nothing to
 * repair and updates no row. `updated_at` is kept: the content did not change.
 *
 * down() changes nothing: the plain text is what the seed now writes.
 */
export class TemplatePlainTextRepair1856200000000 implements MigrationInterface {
  name = 'TemplatePlainTextRepair1856200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The tenant setting is transaction-local: without the migration transaction, it would be
    // gone before the update and the update would silently see no row.
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
        const templates: Array<{ id: string; content_markdown: string }> = await queryRunner.query(
          `SELECT d.id, d.content_markdown
             FROM documents d
             JOIN document_libraries dl ON dl.id = d.library_id AND dl.tenant_id = d.tenant_id
            WHERE d.tenant_id = $1
              AND dl.slug = 'templates'
              AND coalesce(d.content_plain, '') = ''
              AND coalesce(d.content_markdown, '') <> ''
            ORDER BY d.created_at ASC, d.id ASC`,
          [tenant.id],
        );
        let count = 0;
        for (const template of templates) {
          const contentPlain = markdownToSearchText(template.content_markdown);
          if (!contentPlain) continue;
          const [row] = await queryRunner.query(
            `WITH repaired AS (
               UPDATE documents SET content_plain = $3
                WHERE id = $1 AND tenant_id = $2 AND coalesce(content_plain, '') = ''
               RETURNING 1
             )
             SELECT count(*)::int AS count FROM repaired`,
            [template.id, tenant.id, contentPlain],
          );
          count += Number(row?.count ?? 0);
        }
        if (count > 0) {
          total += count;
          console.log(`[${this.name}] tenant ${tenant.id}: ${count} template(s) repaired`);
        }
      }
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [previous?.value ?? '']);
      console.log(`[${this.name}] ${total} template(s) repaired in ${tenants.length} tenant(s)`);
      if (ownTransaction) await queryRunner.commitTransaction();
    } catch (err) {
      if (ownTransaction) await queryRunner.rollbackTransaction();
      throw err;
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Nothing to undo: the plain text is the one the seed writes.
  }
}
