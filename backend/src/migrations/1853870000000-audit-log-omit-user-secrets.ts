import { MigrationInterface, QueryRunner } from 'typeorm';

const LOG_PREFIX = '[Migration] AuditLogOmitUserSecrets:';

/** Keys removed from `before_json` and `after_json`, at any depth (as AuditService.log does). */
const OMITTED_KEYS = ['password_hash', 'mfa_secret'] as const;

/** A helper function of this migration only, dropped before it returns. */
const OMIT_FUNCTION = 'audit_log_omit_user_secrets_1853870000000';

type CleanedCount = { table_name: string; rows: number };

/**
 * Removes the user password hash and MFA secret keys from audit_log.before_json and
 * after_json. Some user updates (enable, disable, invite) wrote the whole user row there;
 * AuditService.log now leaves these keys out of every new row.
 *
 * 1. A helper function returns a JSON value without the keys, at any depth of objects and
 *    arrays; every other key and value is kept exactly (numbers keep their precision).
 * 2. With row level security disabled on audit_log (migrations run without
 *    app.current_tenant and FORCE binds the owner, so the update would see no row),
 *    restored afterwards to the state found, one UPDATE rewrites the rows whose JSON holds
 *    one of the keys, and only those: a row is changed only when the helper returns a
 *    different value. The boot log gives the count per table.
 * 3. The helper function is dropped.
 *
 * Idempotent: a second run finds no row to change and logs it. down() restores nothing:
 * the removed values are not kept anywhere.
 */
export class AuditLogOmitUserSecrets1853870000000 implements MigrationInterface {
  name = 'AuditLogOmitUserSecrets1853870000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const keyList = OMITTED_KEYS.map((key) => `'${key}'`).join(', ');
    const keyPattern = `"(${OMITTED_KEYS.join('|')})":`;
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION ${OMIT_FUNCTION}(doc jsonb) RETURNS jsonb
      LANGUAGE plpgsql IMMUTABLE AS $fn$
      DECLARE
        result jsonb;
      BEGIN
        IF doc IS NULL THEN
          RETURN NULL;
        END IF;
        IF jsonb_typeof(doc) = 'object' THEN
          SELECT COALESCE(jsonb_object_agg(entry.key, ${OMIT_FUNCTION}(entry.value)), '{}'::jsonb)
            INTO result
            FROM jsonb_each(doc) AS entry
           WHERE entry.key NOT IN (${keyList});
          RETURN result;
        END IF;
        IF jsonb_typeof(doc) = 'array' THEN
          SELECT COALESCE(jsonb_agg(${OMIT_FUNCTION}(item.elem) ORDER BY item.ord), '[]'::jsonb)
            INTO result
            FROM jsonb_array_elements(doc) WITH ORDINALITY AS item(elem, ord);
          RETURN result;
        END IF;
        RETURN doc;
      END
      $fn$
    `);

    const cleaned: CleanedCount[] = await withoutRowSecurity(queryRunner, 'audit_log', () =>
      queryRunner.query(
        `WITH cleaned AS (
           UPDATE audit_log
              SET before_json = ${OMIT_FUNCTION}(before_json),
                  after_json = ${OMIT_FUNCTION}(after_json)
            WHERE (before_json::text ~ $1 AND ${OMIT_FUNCTION}(before_json) IS DISTINCT FROM before_json)
               OR (after_json::text ~ $1 AND ${OMIT_FUNCTION}(after_json) IS DISTINCT FROM after_json)
           RETURNING table_name
         )
         SELECT table_name, count(*)::int AS rows FROM cleaned GROUP BY table_name ORDER BY table_name`,
        [keyPattern],
      ),
    );

    await queryRunner.query(`DROP FUNCTION IF EXISTS ${OMIT_FUNCTION}(jsonb)`);
    logCleaned(cleaned);
  }

  public async down(): Promise<void> {
    // The removed values are not restored.
  }
}

/**
 * Runs `fn` with row level security off on the table, then restores what was found, also
 * when `fn` fails. After a failed statement the transaction is aborted and refuses the
 * restore: its rollback restores the state then, and the error of `fn` is the one reported.
 */
async function withoutRowSecurity<T>(queryRunner: QueryRunner, table: string, fn: () => Promise<T>): Promise<T> {
  const [state] = await queryRunner.query(
    `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = $1::regclass`,
    [table],
  );
  if (state?.enabled) await queryRunner.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
  let failed = false;
  try {
    return await fn();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      if (state?.enabled) await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      if (state?.forced) await queryRunner.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    } catch (restoreError) {
      if (!failed) throw restoreError;
    }
  }
}

function logCleaned(cleaned: CleanedCount[]) {
  const total = cleaned.reduce((sum, row) => sum + Number(row.rows), 0);
  if (total === 0) {
    console.log(`${LOG_PREFIX} no audit row holds ${OMITTED_KEYS.join(' or ')}, nothing changed`);
    return;
  }
  console.log(`${LOG_PREFIX} ${total} audit row(s) cleaned of ${OMITTED_KEYS.join(' and ')}`);
  for (const row of cleaned) {
    console.log(`  ${row.table_name}: ${row.rows} row(s)`);
  }
}
