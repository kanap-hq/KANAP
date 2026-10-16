import { MigrationInterface, QueryRunner } from 'typeorm';
import { withRlsDisabled } from '../common/migration-rls';

/**
 * Task types get a nullable `code`: the shipped type a row started as (`task`, `bug`, `problem`,
 * `incident`), null for a type the tenant added. The frontend shows a coded type in the user's
 * language while its name is still the shipped English one; a rename keeps the code.
 *
 * Backfill, per tenant: a type whose name equals a shipped default, ignoring case, gets that
 * default's code. Renamed defaults and the tenant's own types keep no code. When several types of
 * a tenant match the same default ("Task" and "task"), the earliest (created_at, id) gets the code
 * and the others are logged and left without one. A code already held in a tenant is never handed
 * out again, so a rerun changes nothing. Then one code per tenant is enforced by a partial unique
 * index; rows that would break it (none can exist before this migration) lose their code first,
 * keeping the earliest.
 *
 * The migration succeeds on any data and logs its counts per tenant. The shipped names below are
 * a snapshot of DEFAULT_TASK_TYPES (`portfolio/portfolio-task-type.entity.ts`).
 */

const SHIPPED = [
  { code: 'task', name: 'Task' },
  { code: 'bug', name: 'Bug' },
  { code: 'problem', name: 'Problem' },
  { code: 'incident', name: 'Incident' },
] as const;

const INDEX = 'IDX_portfolio_task_types_tenant_code';
const PREFIX = '[Migration] TaskTypeCodes:';

type Candidate = {
  id: string;
  tenant_id: string;
  slug: string | null;
  name: string;
  code: string;
  shipped_name: string;
  rank: number;
  first_id: string;
};

const tenantLabel = (row: { tenant_id: string; slug: string | null }) => `tenant ${row.slug ?? '(unknown)'} (${row.tenant_id})`;

export class TaskTypeCodes1854130000000 implements MigrationInterface {
  name = 'TaskTypeCodes1854130000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const log = (line: string) => console.log(`${PREFIX} ${line}`);
    await queryRunner.query(`ALTER TABLE portfolio_task_types ADD COLUMN IF NOT EXISTS code text NULL`);

    await withRlsDisabled(queryRunner, ['portfolio_task_types'], async () => {
      // Repair: one code per tenant, keeping the earliest row.
      const cleared: Array<{ tenant_id: string; slug: string | null; code: string; n: number }> = await queryRunner.query(
        `WITH ranked AS (
           SELECT id, row_number() OVER (PARTITION BY tenant_id, code ORDER BY created_at, id) AS rank
             FROM portfolio_task_types WHERE code IS NOT NULL
         ), changed AS (
           UPDATE portfolio_task_types tt SET code = NULL
             FROM ranked WHERE ranked.id = tt.id AND ranked.rank > 1
           RETURNING tt.tenant_id, ranked.id
         )
         SELECT c.tenant_id, t.slug, count(*)::int AS n FROM changed c LEFT JOIN tenants t ON t.id = c.tenant_id
          GROUP BY c.tenant_id, t.slug`,
      );
      for (const row of cleared) log(`${tenantLabel(row)}: ${row.n} task type(s) sharing a code lost it, the earliest kept it`);

      // Backfill: the types still named as a shipped default, in a tenant that holds no row with that code.
      const candidates: Candidate[] = await queryRunner.query(
        `WITH shipped AS (
           SELECT unnest($1::text[]) AS code, unnest($2::text[]) AS name
         ), matches AS (
           SELECT tt.id, tt.tenant_id, tt.name, s.code, s.name AS shipped_name,
                  row_number() OVER (PARTITION BY tt.tenant_id, s.code ORDER BY tt.created_at, tt.id)::int AS rank,
                  first_value(tt.id) OVER (PARTITION BY tt.tenant_id, s.code ORDER BY tt.created_at, tt.id) AS first_id
             FROM portfolio_task_types tt
             JOIN shipped s ON lower(tt.name) = lower(s.name)
            WHERE tt.code IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM portfolio_task_types o WHERE o.tenant_id = tt.tenant_id AND o.code = s.code
              )
         )
         SELECT m.*, t.slug FROM matches m LEFT JOIN tenants t ON t.id = m.tenant_id
          ORDER BY t.slug NULLS LAST, m.tenant_id, m.code, m.rank`,
        [SHIPPED.map((s) => s.code), SHIPPED.map((s) => s.name)],
      );
      const winners = candidates.filter((c) => c.rank === 1);
      if (winners.length > 0) {
        await queryRunner.query(
          `UPDATE portfolio_task_types tt SET code = w.code
             FROM unnest($1::uuid[], $2::text[]) AS w(id, code)
            WHERE tt.id = w.id AND tt.code IS NULL`,
          [winners.map((w) => w.id), winners.map((w) => w.code)],
        );
      }

      const perTenant = new Map<string, { row: Candidate; codes: string[] }>();
      for (const w of winners) {
        const entry = perTenant.get(w.tenant_id) ?? { row: w, codes: [] };
        entry.codes.push(w.code);
        perTenant.set(w.tenant_id, entry);
      }
      for (const { row, codes } of perTenant.values()) {
        log(`${tenantLabel(row)}: ${codes.length} task type(s) given their code (${codes.join(', ')})`);
      }
      const duplicates = candidates.filter((c) => c.rank > 1);
      for (const d of duplicates) {
        log(`${tenantLabel(d)}: task type ${d.id} "${d.name}" also matches the shipped "${d.shipped_name}", left without a code (kept by ${d.first_id})`);
      }
      log(`${winners.length} task type(s) given a code in ${perTenant.size} tenant(s); ${duplicates.length} duplicate(s) left without one`);
    });

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "${INDEX}" ON portfolio_task_types (tenant_id, code) WHERE code IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "${INDEX}"`);
    await queryRunner.query(`ALTER TABLE portfolio_task_types DROP COLUMN IF EXISTS code`);
  }
}
