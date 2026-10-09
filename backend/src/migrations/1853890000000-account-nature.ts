import { MigrationInterface, QueryRunner } from 'typeorm';
import { parseString } from '@fast-csv/parse';
import { writeToString } from '@fast-csv/format';

const LOG_PREFIX = '[Migration] AccountNature:';
const CONSTRAINT = 'accounts_nature_check';
const NATURE = 'nature';
const CONSOLIDATION_NUMBER = 'consolidation_account_number';

/**
 * Tables the backfill reads or writes: the accounts, the search index their trigger refreshes,
 * the charts, and the OPEX and CAPEX lines (read under FORCE RLS without a tenant, they would
 * show no row).
 */
const TABLES = ['accounts', 'search_index', 'chart_of_accounts', 'spend_items', 'capex_items'];

type Nature = 'opex' | 'capex';
type TenantCount = { tenant_id: string; count: number };
type TenantLine = { tenant_id: string; slug: string | null; fromLines: number; fromIfrs: number; fromConsolidation: number; left: number };

/** A CSV payload as read: its rows of raw cells, and how it was written (kept on rewrite). */
type CsvPayload = { bom: boolean; rows: string[][]; rowDelimiter: string; endsWithNewline: boolean };

/**
 * The OPEX/CAPEX nature of an account (plan planning/opex-capex-transfer.md §13.1): which
 * budget lines may use it. `opex`: OPEX lines only; `capex`: CAPEX lines only; NULL: both.
 *
 * 1. `accounts.nature text NULL` with the CHECK `accounts_nature_check` (`opex`, `capex`).
 * 2. Templates (`coa_templates`, global, no RLS): a payload whose header has no `nature`
 *    column gets one, last, its value derived from each row's consolidation account number
 *    (1000 to 1199: capex; 2000 to 2999: opex; anything else: empty). The payload is read and
 *    written with a CSV parser, keeping its BOM, separator, line endings and every other cell,
 *    so edits made in the platform admin are kept.
 * 3. With row level security disabled on the tables above (migrations run without
 *    app.current_tenant), restored to the state found afterwards, the accounts whose nature is
 *    NULL, in this order:
 *    a. used by OPEX lines only: opex; by CAPEX lines only: capex; by both: NULL (all statuses);
 *    b. unused accounts of a consolidation chart whose code is IFRS: the nature of the account of
 *       the same number in the global IFRS template (highest version), as step 2 left it;
 *    c. unused accounts whose consolidation number matches an account of their tenant's
 *       consolidation chart that now has a nature: that nature.
 *    `updated_at` is left alone, no audit line is written. The counts are logged per tenant.
 *    A value outside the CHECK (only a column added by hand can hold one) is cleared first.
 *
 * A second run transforms and sets nothing. down() drops the constraint and the column, and
 * strips the `nature` column from the template payloads.
 */
export class AccountNature1853890000000 implements MigrationInterface {
  name = 'AccountNature1853890000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS nature text`);

    const transformed = await transformTemplates(queryRunner);
    const ifrs = await ifrsTemplateNatures(queryRunner);

    const { cleared, fromLines, fromIfrs, fromConsolidation, left } = await withoutRowSecurity(queryRunner, TABLES, async () => {
      const repaired = await clearInvalid(queryRunner);
      await queryRunner.query(`DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint c JOIN pg_class t ON c.conrelid = t.oid
          WHERE t.relname = 'accounts' AND c.conname = '${CONSTRAINT}'
        ) THEN
          ALTER TABLE accounts ADD CONSTRAINT ${CONSTRAINT} CHECK (nature IN ('opex', 'capex'));
        END IF;
      END $$;`);
      return {
        cleared: repaired,
        fromLines: await natureFromLines(queryRunner),
        fromIfrs: await natureFromIfrsTemplate(queryRunner, ifrs),
        fromConsolidation: await natureFromConsolidationAccount(queryRunner),
        left: await leftForBoth(queryRunner),
      };
    });

    const total = (rows: TenantCount[]) => rows.reduce((sum, row) => sum + row.count, 0);
    console.log(
      `${LOG_PREFIX} ${transformed.count} template(s) given the nature column, `
        + `${total(fromLines)} account(s) set from their lines, `
        + `${total(fromIfrs)} from the IFRS template, `
        + `${total(fromConsolidation)} from their consolidation account, `
        + `${total(left)} left for OPEX and CAPEX`
        + (total(cleared) > 0 ? `, ${total(cleared)} invalid value(s) cleared` : ''),
    );
    for (const skipped of transformed.skipped) console.log(`  template ${skipped}`);
    const lines = await tenantLines(queryRunner, { fromLines, fromIfrs, fromConsolidation, left });
    for (const line of lines) {
      console.log(
        `  tenant ${line.slug ?? '(unknown)'} (${line.tenant_id}): ${line.fromLines} from their lines, `
          + `${line.fromIfrs} from the IFRS template, ${line.fromConsolidation} from their consolidation account, `
          + `${line.left} left for OPEX and CAPEX`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE accounts DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
    await queryRunner.query(`ALTER TABLE accounts DROP COLUMN IF EXISTS nature`);
    const templates: Array<{ id: string; csv_payload: string }> = await queryRunner.query(
      `SELECT id, csv_payload FROM coa_templates WHERE csv_payload IS NOT NULL ORDER BY id`,
    );
    for (const template of templates) {
      const stripped = await AccountNature1853890000000.withoutNatureColumn(template.csv_payload);
      if (stripped !== null) {
        await queryRunner.query(`UPDATE coa_templates SET csv_payload = $2 WHERE id = $1`, [template.id, stripped]);
      }
    }
  }

  /** The nature a template row takes from its consolidation account number (step 2). */
  static natureOf(consolidationNumber: string | null | undefined): Nature | '' {
    const text = (consolidationNumber ?? '').trim();
    if (!/^\d+$/.test(text)) return '';
    const number = Number(text);
    if (number >= 1000 && number <= 1199) return 'capex';
    if (number >= 2000 && number <= 2999) return 'opex';
    return '';
  }

  /**
   * The payload with a `nature` column appended (step 2), or null when it already has one or
   * holds no header. Throws when a row has more cells than the header (it cannot be placed).
   */
  static async withNatureColumn(csv: string): Promise<string | null> {
    const payload = await readPayload(csv);
    const [header, ...rows] = payload.rows;
    if (!header) return null;
    const names = header.map((name) => name.trim());
    if (names.includes(NATURE)) return null;
    const consolidationIndex = names.indexOf(CONSOLIDATION_NUMBER);
    const next = [[...header, NATURE]];
    rows.forEach((row, index) => {
      if (row.length > header.length) {
        throw new Error(`row ${index + 2} has ${row.length} cells for ${header.length} columns`);
      }
      const cells = [...row, ...Array(header.length - row.length).fill('')];
      next.push([...cells, consolidationIndex >= 0 ? AccountNature1853890000000.natureOf(cells[consolidationIndex]) : '']);
    });
    return writePayload({ ...payload, rows: next });
  }

  /** The payload without its `nature` column (down), or null when it has none. */
  static async withoutNatureColumn(csv: string): Promise<string | null> {
    const payload = await readPayload(csv);
    const [header] = payload.rows;
    if (!header) return null;
    const index = header.map((name) => name.trim()).indexOf(NATURE);
    if (index < 0) return null;
    return writePayload({ ...payload, rows: payload.rows.map((row) => row.filter((_, i) => i !== index)) });
  }
}

async function readPayload(csv: string): Promise<CsvPayload> {
  const bom = csv.startsWith('﻿');
  const text = bom ? csv.slice(1) : csv;
  const rows: string[][] = [];
  await new Promise<void>((resolve, reject) => {
    parseString(text, { headers: false, delimiter: ';', ignoreEmpty: true })
      .on('data', (row: string[]) => rows.push(row))
      .on('end', () => resolve())
      .on('error', (err) => reject(err));
  });
  return { bom, rows, rowDelimiter: text.includes('\r\n') ? '\r\n' : '\n', endsWithNewline: /\n$/.test(text) };
}

async function writePayload(payload: CsvPayload): Promise<string> {
  const body = await writeToString(payload.rows, {
    delimiter: ';',
    rowDelimiter: payload.rowDelimiter,
    includeEndRowDelimiter: payload.endsWithNewline,
  });
  return (payload.bom ? '﻿' : '') + body;
}

/** Step 2, template by template. A payload that cannot be placed is left as is and named. */
async function transformTemplates(queryRunner: QueryRunner): Promise<{ count: number; skipped: string[] }> {
  const templates: Array<{ id: string; template_code: string; version: string; csv_payload: string }> = await queryRunner.query(
    `SELECT id, template_code, version, csv_payload FROM coa_templates WHERE csv_payload IS NOT NULL ORDER BY template_code, version, id`,
  );
  let count = 0;
  const skipped: string[] = [];
  for (const template of templates) {
    let next: string | null;
    try {
      next = await AccountNature1853890000000.withNatureColumn(template.csv_payload);
    } catch (err) {
      skipped.push(`${template.template_code} ${template.version} (${template.id}) left without the nature column: ${(err as Error).message}`);
      continue;
    }
    if (next === null) continue;
    await queryRunner.query(`UPDATE coa_templates SET csv_payload = $2 WHERE id = $1`, [template.id, next]);
    count += 1;
  }
  return { count, skipped };
}

/** Numeric parts of a template version, compared part by part ("2.0" after "1.10" after "1.9"). */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((part) => Number(part));
  const pb = b.split('.').map((part) => Number(part));
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = Number.isFinite(pa[i]) ? pa[i] : 0;
    const y = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (x !== y) return x - y;
  }
  return a.localeCompare(b);
}

/**
 * The natures of the global IFRS template of the highest version holding a payload, by account
 * number. A payload without the `nature` column (step 2 could not place it) gives none: said in
 * the log, rule b then sets nothing.
 */
async function ifrsTemplateNatures(queryRunner: QueryRunner): Promise<{ numbers: number[]; natures: Nature[] }> {
  const templates: Array<{ id: string; version: string; csv_payload: string }> = await queryRunner.query(
    `SELECT id, version, csv_payload FROM coa_templates WHERE is_global AND template_code = 'IFRS' AND csv_payload IS NOT NULL`,
  );
  const latest = [...templates].sort((a, b) => compareVersions(b.version, a.version))[0];
  const empty = { numbers: [], natures: [] };
  if (!latest) return empty;
  const { rows } = await readPayload(latest.csv_payload);
  const [header, ...data] = rows;
  const names = (header ?? []).map((name) => name.trim());
  const numberIndex = names.indexOf('account_number');
  const natureIndex = names.indexOf(NATURE);
  if (numberIndex < 0 || natureIndex < 0) {
    console.log(
      `${LOG_PREFIX} the IFRS template ${latest.version} (${latest.id}) has no nature column: `
        + 'no account takes its nature from the IFRS template',
    );
    return empty;
  }
  const byNumber = new Map<number, Nature>();
  for (const row of data) {
    const number = (row[numberIndex] ?? '').trim();
    const nature = (row[natureIndex] ?? '').trim().toLowerCase();
    if (!/^\d+$/.test(number) || (nature !== 'opex' && nature !== 'capex')) continue;
    if (!byNumber.has(Number(number))) byNumber.set(Number(number), nature);
  }
  return { numbers: Array.from(byNumber.keys()), natures: Array.from(byNumber.values()) };
}

/** An account no OPEX or CAPEX line uses, whatever the line's status. */
const UNUSED = `NOT EXISTS (SELECT 1 FROM spend_items s WHERE s.tenant_id = a.tenant_id AND s.account_id = a.id)
        AND NOT EXISTS (SELECT 1 FROM capex_items x WHERE x.tenant_id = a.tenant_id AND x.account_id = a.id)`;

function counted(changed: string): string {
  return `${changed}
    SELECT tenant_id, COUNT(*)::int AS count FROM changed GROUP BY tenant_id`;
}

/** A value outside the CHECK, in a column added by hand before this migration: cleared. */
async function clearInvalid(queryRunner: QueryRunner): Promise<TenantCount[]> {
  return queryRunner.query(counted(`
    WITH changed AS (
      UPDATE accounts a SET nature = NULL
      WHERE a.nature IS NOT NULL AND a.nature NOT IN ('opex', 'capex')
      RETURNING a.tenant_id
    )`));
}

/** Rule a: the lines that use the account, of one type only. */
async function natureFromLines(queryRunner: QueryRunner): Promise<TenantCount[]> {
  return queryRunner.query(counted(`
    WITH usage AS (
      SELECT a.id, a.tenant_id,
             EXISTS (SELECT 1 FROM spend_items s WHERE s.tenant_id = a.tenant_id AND s.account_id = a.id) AS opex,
             EXISTS (SELECT 1 FROM capex_items x WHERE x.tenant_id = a.tenant_id AND x.account_id = a.id) AS capex
      FROM accounts a
      WHERE a.nature IS NULL
    ),
    changed AS (
      UPDATE accounts a SET nature = CASE WHEN u.opex THEN 'opex' ELSE 'capex' END
      FROM usage u
      WHERE u.id = a.id AND u.tenant_id = a.tenant_id AND u.opex <> u.capex
      RETURNING a.tenant_id
    )`));
}

/** Rule b: unused accounts of an IFRS consolidation chart take the IFRS template's nature. */
async function natureFromIfrsTemplate(queryRunner: QueryRunner, ifrs: { numbers: number[]; natures: Nature[] }): Promise<TenantCount[]> {
  if (ifrs.numbers.length === 0) return [];
  return queryRunner.query(counted(`
    WITH template(account_number, nature) AS (
      SELECT * FROM unnest($1::int[], $2::text[])
    ),
    changed AS (
      UPDATE accounts a SET nature = template.nature
      FROM chart_of_accounts c, template
      WHERE c.id = a.coa_id AND c.tenant_id = a.tenant_id
        AND c.is_consolidation AND upper(c.code) = 'IFRS'
        AND template.account_number = a.account_number
        AND a.nature IS NULL
        AND ${UNUSED}
      RETURNING a.tenant_id
    )`), [ifrs.numbers, ifrs.natures]);
}

/** Rule c: unused accounts take the nature of their consolidation account, when it has one. */
async function natureFromConsolidationAccount(queryRunner: QueryRunner): Promise<TenantCount[]> {
  return queryRunner.query(counted(`
    WITH source AS (
      SELECT ca.tenant_id, ca.account_number, ca.nature
      FROM accounts ca
      JOIN chart_of_accounts cc ON cc.id = ca.coa_id AND cc.tenant_id = ca.tenant_id
      WHERE cc.is_consolidation AND ca.nature IS NOT NULL
    ),
    changed AS (
      UPDATE accounts a SET nature = source.nature
      FROM source
      WHERE source.tenant_id = a.tenant_id
        AND source.account_number = a.consolidation_account_number
        AND a.nature IS NULL
        AND ${UNUSED}
      RETURNING a.tenant_id
    )`));
}

/** The accounts of each tenant left for OPEX and CAPEX lines (nature NULL). */
async function leftForBoth(queryRunner: QueryRunner): Promise<TenantCount[]> {
  return queryRunner.query(
    `SELECT a.tenant_id, COUNT(*)::int AS count FROM accounts a WHERE a.nature IS NULL GROUP BY a.tenant_id`,
  );
}

/** One line per tenant with an account: the counts of each rule and the accounts left, by slug. */
async function tenantLines(
  queryRunner: QueryRunner,
  counts: Record<'fromLines' | 'fromIfrs' | 'fromConsolidation' | 'left', TenantCount[]>,
): Promise<TenantLine[]> {
  const byTenant = new Map<string, TenantLine>();
  const lineOf = (tenantId: string) => {
    let line = byTenant.get(tenantId);
    if (!line) {
      line = { tenant_id: tenantId, slug: null, fromLines: 0, fromIfrs: 0, fromConsolidation: 0, left: 0 };
      byTenant.set(tenantId, line);
    }
    return line;
  };
  for (const key of ['fromLines', 'fromIfrs', 'fromConsolidation', 'left'] as const) {
    for (const row of counts[key]) lineOf(row.tenant_id)[key] += row.count;
  }
  if (byTenant.size === 0) return [];
  const slugs: Array<{ id: string; slug: string }> = await queryRunner.query(
    `SELECT id, slug FROM tenants WHERE id = ANY($1::uuid[])`,
    [Array.from(byTenant.keys())],
  );
  for (const row of slugs) lineOf(row.id).slug = row.slug;
  return Array.from(byTenant.values()).sort((a, b) =>
    (a.slug ?? '￿').localeCompare(b.slug ?? '￿') || a.tenant_id.localeCompare(b.tenant_id),
  );
}

/**
 * Runs `fn` with row level security off on the tables, then restores what was
 * found, also when `fn` fails. After a failed statement the transaction is
 * aborted and refuses the restore: its rollback restores the state then, and
 * the error of `fn` is the one reported.
 */
async function withoutRowSecurity<T>(queryRunner: QueryRunner, tables: string[], fn: () => Promise<T>): Promise<T> {
  const states: Array<{ table: string; enabled: boolean; forced: boolean }> = [];
  for (const table of tables) {
    const [state] = await queryRunner.query(
      `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = to_regclass($1)`,
      [table],
    );
    if (!state) continue;
    states.push({ table, enabled: !!state.enabled, forced: !!state.forced });
    if (state.enabled) await queryRunner.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
  }
  let failed = false;
  try {
    return await fn();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      for (const state of states) {
        if (state.enabled) await queryRunner.query(`ALTER TABLE ${state.table} ENABLE ROW LEVEL SECURITY`);
        if (state.forced) await queryRunner.query(`ALTER TABLE ${state.table} FORCE ROW LEVEL SECURITY`);
      }
    } catch (restoreError) {
      if (!failed) throw restoreError;
    }
  }
}
