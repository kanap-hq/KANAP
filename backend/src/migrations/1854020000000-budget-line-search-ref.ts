import { MigrationInterface, QueryRunner } from 'typeorm';

// Frozen SQL from 1853950000000 and 1853980000000. down() restores the previous
// deployed function bodies byte for byte; the dormant capex_* tables stay untouched.
const ANALYTICS_EXTRA = `CASE WHEN la.analytics_display IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('analytics', la.analytics_display) END`;
const ANALYTICS_VECTOR = `search_index_tsv('B', la.analytics_text)`;
const UPSERT = `ON CONFLICT (tenant_id, entity_type, entity_id) DO UPDATE SET
        ref_prefix = EXCLUDED.ref_prefix,
        ref_number = EXCLUDED.ref_number,
        label = EXCLUDED.label,
        summary = EXCLUDED.summary,
        status = EXCLUDED.status,
        extra_json = EXCLUDED.extra_json,
        search_vector = EXCLUDED.search_vector,
        source_updated_at = EXCLUDED.source_updated_at,
        indexed_at = EXCLUDED.indexed_at`;

/**
 * `search_index_refresh_spend_items` as 1853940000000 generates it; with `opexOnly`, the entries
 * of type `spend_items` are the lines of nature `opex` only: the upsert reads those, and the purge
 * removes an entry whose line is gone or of another nature. Nothing else differs, so down() puts
 * back the body of 1853940000000 to the character (a spec compares them). No SET clause, as
 * before: PL/pgSQL keeps each path's plan for the session (1853940000000).
 */
function spendRefreshSql(opexOnly: boolean, select: string, upsertClause: string = UPSERT): string {
  const nature = (alias: string) => (opexOnly ? ` AND ${alias}.nature = 'opex'` : '');
  const byIds = (ids: boolean, column: string) => (ids ? `\n           AND ${column} = ANY (p_ids)` : '');
  const purge = (ids: boolean) => `DELETE FROM search_index si_del
         WHERE si_del.tenant_id = p_tenant
           AND si_del.entity_type = 'spend_items'${byIds(ids, 'si_del.entity_id')}
           AND NOT EXISTS (
             SELECT 1 FROM spend_items src
             WHERE src.id = si_del.entity_id AND src.tenant_id = p_tenant${nature('src')}
           );`;
  const upsert = (ids: boolean) => `INSERT INTO search_index (
          tenant_id, entity_type, entity_id, ref_prefix, ref_number,
          label, summary, status, extra_json, search_vector, source_updated_at, indexed_at
        )
        ${select}
        ${SPEND_FROM}
         WHERE si.tenant_id = p_tenant${nature('si')}${byIds(ids, 'si.id')}
        ${upsertClause};`;
  return `
    CREATE OR REPLACE FUNCTION search_index_refresh_spend_items(p_tenant uuid, p_ids uuid[] DEFAULT NULL)
    RETURNS void LANGUAGE plpgsql AS $fn$
    BEGIN
      IF p_ids IS NULL THEN
        ${purge(false)}
        ${upsert(false)}
      ELSE
        ${purge(true)}
        ${upsert(true)}
      END IF;
    END
    $fn$
  `;
}

const SPEND_SELECT = `SELECT si.tenant_id,
             'spend_items',
             si.id,
             'OPX',
             si.item_number,
             si.product_name,
             COALESCE(
               NULLIF(si.description, ''),
               NULLIF(CONCAT_WS(' | ', sup.name, comp.name, NULLIF(TRIM(CONCAT_WS(' ', acc.account_number::text, acc.account_name)), '')), '')
             ),
             si.status::text,
             jsonb_build_object(
               'supplier', sup.name,
               'paying_company', comp.name,
               'account', NULLIF(TRIM(CONCAT_WS(' ', acc.account_number::text, acc.account_name)), ''),
               'contract', (
                 SELECT c.name
                 FROM contract_spend_items csi
                 JOIN contracts c ON c.id = csi.contract_id AND c.tenant_id = si.tenant_id
                 WHERE csi.spend_item_id = si.id
                 ORDER BY csi.created_at DESC
                 LIMIT 1
               )
             ) || ${ANALYTICS_EXTRA},
             search_index_tsv('A', CONCAT_WS(' ', 'OPX-' || si.item_number::text, si.product_name))
               || search_index_tsv('B', si.currency)
               || ${ANALYTICS_VECTOR}
               || search_index_tsv('C', CONCAT_WS(' ', si.description, sup.name, comp.name, acc.account_name, acc.account_number::text, si.notes, (
                 SELECT string_agg(c.name, ' ')
                 FROM contract_spend_items csi
                 JOIN contracts c ON c.id = csi.contract_id AND c.tenant_id = si.tenant_id
                 WHERE csi.spend_item_id = si.id
               ))),
             si.updated_at,
             now()`;

const SPEND_FROM = `FROM spend_items si
        LEFT JOIN suppliers sup ON sup.id = si.supplier_id AND sup.tenant_id = si.tenant_id
        LEFT JOIN companies comp ON comp.id = si.paying_company_id AND comp.tenant_id = si.tenant_id
        LEFT JOIN accounts acc ON acc.id = si.account_id AND acc.tenant_id = si.tenant_id
        LEFT JOIN LATERAL search_index_line_analytics(si.tenant_id, 'opex', si.id) la ON true`;

const CPX_NUMBER = (alias: string) => `COALESCE((substring(${alias}.legacy_number FROM '^CPX-([0-9]+)$'))::int, ${alias}.item_number)`;

/** 1853960000000's `refreshFunctionSql` for the CAPEX lines of `spend_items`. */
function capexRefreshSql(select: string, upsertClause: string = UPSERT): string {
  const table = 'spend_items';
  const lineWhere = `nature = 'capex'`;
  const alias = 'ci';
  const from = `FROM spend_items ci
        LEFT JOIN companies comp ON comp.id = ci.paying_company_id AND comp.tenant_id = ci.tenant_id
        LEFT JOIN suppliers sup ON sup.id = ci.supplier_id AND sup.tenant_id = ci.tenant_id
        LEFT JOIN LATERAL search_index_line_analytics(ci.tenant_id, 'capex', ci.id) la ON true`;
  const byIds = (ids: boolean, column: string) => (ids ? `\n           AND ${column} = ANY (p_ids)` : '');
  const purge = (ids: boolean) => `DELETE FROM search_index si_del
         WHERE si_del.tenant_id = p_tenant
           AND si_del.entity_type = 'capex_items'${byIds(ids, 'si_del.entity_id')}
           AND NOT EXISTS (
             SELECT 1 FROM ${table} src
             WHERE src.id = si_del.entity_id AND src.tenant_id = p_tenant AND src.${lineWhere}
           );`;
  const upsert = (ids: boolean) => `INSERT INTO search_index (
          tenant_id, entity_type, entity_id, ref_prefix, ref_number,
          label, summary, status, extra_json, search_vector, source_updated_at, indexed_at
        )
        ${select}
        ${from}
         WHERE ${alias}.tenant_id = p_tenant AND ${alias}.${lineWhere}${byIds(ids, `${alias}.id`)}
        ${upsertClause};`;
  return `
    CREATE OR REPLACE FUNCTION search_index_refresh_capex_items(p_tenant uuid, p_ids uuid[] DEFAULT NULL)
    RETURNS void LANGUAGE plpgsql AS $fn$
    BEGIN
      IF p_ids IS NULL THEN
        ${purge(false)}
        ${upsert(false)}
      ELSE
        ${purge(true)}
        ${upsert(true)}
      END IF;
    END
    $fn$
  `;
}

/** The entry's columns; `criteria` adds the three CAPEX enums to the summary and the B terms (lot Z1's body). */
function capexEntrySelect(criteria: boolean): string {
  const summaryCriteria = criteria ? ', ci.ppe_type::text, ci.investment_type' : '';
  const termCriteria = criteria ? 'ci.ppe_type::text, ci.investment_type, ci.priority, ' : '';
  return `SELECT ci.tenant_id,
             'capex_items',
             ci.id,
             'CPX',
             ${CPX_NUMBER('ci')},
             ci.product_name,
             NULLIF(CONCAT_WS(' | ', comp.name, sup.name${summaryCriteria}), ''),
             ci.status::text,
             jsonb_build_object('paying_company', comp.name, 'supplier', sup.name) || ${ANALYTICS_EXTRA},
             search_index_tsv('A', CONCAT_WS(' ', 'CPX-' || ${CPX_NUMBER('ci')}::text, ci.product_name))
               || search_index_tsv('B', CONCAT_WS(' ', ${termCriteria}ci.currency))
               || ${ANALYTICS_VECTOR}
               || search_index_tsv('C', CONCAT_WS(' ', ci.notes, comp.name, sup.name)),
             ci.updated_at,
             now()`;
}


const OPEX_PREVIOUS = spendRefreshSql(true, SPEND_SELECT);
const CAPEX_PREVIOUS = capexRefreshSql(capexEntrySelect(false));

/** Preserve indexed_at on a rerun when the indexed content and source freshness agree. */
const CHANGED_UPSERT = UPSERT + `
        WHERE (search_index.ref_prefix, search_index.ref_number, search_index.label,
               search_index.summary, search_index.status, search_index.extra_json,
               search_index.search_vector, search_index.source_updated_at)
          IS DISTINCT FROM
              (EXCLUDED.ref_prefix, EXCLUDED.ref_number, EXCLUDED.label,
               EXCLUDED.summary, EXCLUDED.status, EXCLUDED.extra_json,
               EXCLUDED.search_vector, EXCLUDED.source_updated_at)`;

function nativeSelect(previous: string, alias: string): string {
  const capex = alias === 'ci';
  return previous
    .replace(capex ? "             'CPX'," : "             'OPX',", "             'BL',")
    .replace(capex ? `             ${CPX_NUMBER(alias)},` : `             ${alias}.item_number,`, `             ${alias}.item_number,`)
    .replace(` || ${ANALYTICS_EXTRA},`, ` || jsonb_build_object('legacy_number', ${alias}.legacy_number) || ${ANALYTICS_EXTRA},`)
    .replace(capex ? `'CPX-' || ${CPX_NUMBER(alias)}::text` : `'OPX-' || ${alias}.item_number::text`,
      `'BL-' || ${alias}.item_number::text, ${alias}.legacy_number`);
}

export class BudgetLineSearchRef1854020000000 implements MigrationInterface {
  name = 'BudgetLineSearchRef1854020000000';

  up(runner: QueryRunner): Promise<void> { return this.reindex(runner, false); }
  down(runner: QueryRunner): Promise<void> { return this.reindex(runner, true); }

  private async reindex(runner: QueryRunner, reverse: boolean): Promise<void> {
    const ownTransaction = !runner.isTransactionActive;
    if (ownTransaction) await runner.startTransaction();
    else await runner.query('SAVEPOINT budget_line_search_ref');
    try {
      // Block line writers for the snapshot and keep every user trigger's original mode.
      await runner.query('LOCK TABLE spend_items, search_index IN SHARE ROW EXCLUSIVE MODE');
      const triggers: Array<{ table: string; name: string; state: string }> = await runner.query(
        `SELECT c.relname AS table, t.tgname AS name, t.tgenabled::text AS state
           FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
          WHERE t.tgrelid IN ('spend_items'::regclass, 'search_index'::regclass)
            AND NOT t.tgisinternal ORDER BY c.relname, t.tgname`,
      );
      const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
      for (const trigger of triggers) {
        if (trigger.state !== 'D') await runner.query(`ALTER TABLE ${quote(trigger.table)} DISABLE TRIGGER ${quote(trigger.name)}`);
      }
      await runner.query(reverse ? OPEX_PREVIOUS : spendRefreshSql(true, nativeSelect(SPEND_SELECT, 'si'), CHANGED_UPSERT));
      await runner.query(reverse ? CAPEX_PREVIOUS : capexRefreshSql(nativeSelect(capexEntrySelect(false), 'ci'), CHANGED_UPSERT));
      const [{ tenant }] = await runner.query(`SELECT current_setting('app.current_tenant', true) AS tenant`);
      const tenants: Array<{ id: string; slug: string }> = await runner.query('SELECT id, slug FROM tenants ORDER BY created_at, id');
      const logs: string[] = [];
      for (const t of tenants) {
        await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [t.id]);
        await runner.query('SELECT search_index_refresh_spend_items($1), search_index_refresh_capex_items($1)', [t.id]);
        const [{ opex, capex }] = await runner.query(
          `SELECT count(*) FILTER (WHERE nature = 'opex')::int AS opex,
                  count(*) FILTER (WHERE nature = 'capex')::int AS capex
             FROM spend_items WHERE tenant_id = $1 AND nature IN ('opex', 'capex')`, [t.id],
        );
        logs.push(`[Migration] BudgetLineSearchRef: ${t.slug} (${t.id}): ${opex} OPEX, ${capex} CAPEX line(s) reindexed as ${reverse ? 'OPX/CPX' : 'BL'}`);
      }
      await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant ?? '']);
      const enable: Record<string, string> = { O: 'ENABLE', A: 'ENABLE ALWAYS', R: 'ENABLE REPLICA' };
      for (const trigger of triggers) {
        if (trigger.state !== 'D') await runner.query(`ALTER TABLE ${quote(trigger.table)} ${enable[trigger.state]} TRIGGER ${quote(trigger.name)}`);
      }
      if (ownTransaction) await runner.commitTransaction();
      else await runner.query('RELEASE SAVEPOINT budget_line_search_ref');
      logs.forEach((line) => console.log(line));
    } catch (error) {
      // DDL, function replacements, tenant context and reindex writes are all transactional.
      // Rollback restores the trigger modes even when the failing SQL aborted the transaction.
      if (ownTransaction) await runner.rollbackTransaction();
      else {
        await runner.query('ROLLBACK TO SAVEPOINT budget_line_search_ref');
        await runner.query('RELEASE SAVEPOINT budget_line_search_ref');
      }
      throw error;
    }
  }
}
