import { MigrationInterface, QueryRunner } from 'typeorm';

const FUNCTION = 'search_index_refresh_capex_items(uuid,uuid[])';

/**
 * Weight C of a CAPEX line before this migration: notes, paying company, supplier.
 * An OPEX line also indexes its description, its account and the names of its contracts.
 */
const OLD_VECTOR = `search_index_tsv('C', CONCAT_WS(' ', ci.notes, comp.name, sup.name))`;
/** The same weight-C text an OPEX line indexes, on the shared `spend_items` columns. */
const NEW_VECTOR = `search_index_tsv('C', CONCAT_WS(' ', ci.description, sup.name, comp.name, acc.account_name, acc.account_number::text, ci.notes, (SELECT string_agg(c.name, ' ') FROM contract_spend_items csi JOIN contracts c ON c.id = csi.contract_id AND c.tenant_id = ci.tenant_id WHERE csi.spend_item_id = ci.id)))`;

const SUPPLIER_JOIN = `LEFT JOIN suppliers sup ON sup.id = ci.supplier_id AND sup.tenant_id = ci.tenant_id`;
const ACCOUNT_JOIN = `${SUPPLIER_JOIN}\n        LEFT JOIN accounts acc ON acc.id = ci.account_id AND acc.tenant_id = ci.tenant_id`;

/**
 * Both natures of a budget line index the same text (one table, `spend_items`).
 *
 * The CAPEX refresh function gains the description, the account name and number and the
 * linked contract names that the OPEX function already indexes, and each tenant's CAPEX
 * lines are reindexed in this migration. The deployed function is read back and patched,
 * so its security definer and search path stay. Idempotent. down() restores the previous
 * vector and reindexes again.
 */
export class BudgetLineSearchFields1855960000000 implements MigrationInterface {
  name = 'BudgetLineSearchFields1855960000000';

  async up(runner: QueryRunner): Promise<void> {
    await this.apply(runner, false);
  }

  async down(runner: QueryRunner): Promise<void> {
    await this.apply(runner, true);
  }

  private async apply(runner: QueryRunner, reverse: boolean): Promise<void> {
    const ownTransaction = !runner.isTransactionActive;
    if (ownTransaction) await runner.startTransaction();
    try {
      // Hold line writers until the new vector is the one their trigger will call.
      await runner.query('LOCK TABLE spend_items, search_index IN SHARE ROW EXCLUSIVE MODE');
      const changed = await replaceVector(runner, reverse);
      await reindexCapex(runner, reverse, changed);
      if (ownTransaction) await runner.commitTransaction();
    } catch (error) {
      if (ownTransaction) await runner.rollbackTransaction();
      throw error;
    }
  }
}

/** Patches the deployed function. Returns false when it already has the requested vector. */
async function replaceVector(runner: QueryRunner, reverse: boolean): Promise<boolean> {
  const rows: Array<{ body: string | null }> = await runner.query(
    `SELECT CASE WHEN to_regprocedure($1) IS NULL THEN NULL ELSE pg_get_functiondef(to_regprocedure($1)) END AS body`,
    [FUNCTION],
  );
  const body = rows[0]?.body;
  if (!body) throw new Error(`[Migration] BudgetLineSearchFields: ${FUNCTION} is missing`);
  const from = reverse ? NEW_VECTOR : OLD_VECTOR;
  const to = reverse ? OLD_VECTOR : NEW_VECTOR;
  const joinFrom = reverse ? ACCOUNT_JOIN : SUPPLIER_JOIN;
  const joinTo = reverse ? SUPPLIER_JOIN : ACCOUNT_JOIN;
  if (!body.includes(from)) {
    if (body.includes(to) && body.includes(joinTo)) return false;
    throw new Error(`[Migration] BudgetLineSearchFields: ${FUNCTION} has an unexpected vector; nothing was changed`);
  }
  if (body.split(from).length - 1 !== 2 || body.split(joinFrom).length - 1 !== 2) {
    throw new Error(`[Migration] BudgetLineSearchFields: ${FUNCTION} does not contain the vector and the supplier join twice`);
  }
  await runner.query(body.split(from).join(to).split(joinFrom).join(joinTo));
  const [fn] = await runner.query(
    `SELECT prosecdef AS definer, proconfig AS config FROM pg_proc WHERE oid = to_regprocedure($1)`,
    [FUNCTION],
  );
  const config = Array.isArray(fn?.config) ? fn.config.join(' ') : String(fn?.config ?? '');
  if (fn?.definer !== true || !config.includes('search_path')) {
    throw new Error(`[Migration] BudgetLineSearchFields: ${FUNCTION} lost its security definer or its search path`);
  }
  return true;
}

/** Rebuilds each tenant's CAPEX entries with the function just installed. */
async function reindexCapex(runner: QueryRunner, reverse: boolean, changed: boolean): Promise<void> {
  const [{ tenant }] = await runner.query(`SELECT current_setting('app.current_tenant', true) AS tenant`);
  const tenants: Array<{ id: string; slug: string }> = await runner.query(
    'SELECT id, slug FROM tenants ORDER BY created_at, id',
  );
  const direction = reverse ? 'restored to notes, company and supplier' : 'indexed with the shared fields';
  for (const t of tenants) {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [t.id]);
    await runner.query('SELECT search_index_refresh_capex_items($1)', [t.id]);
    const [{ n }] = await runner.query(
      `SELECT count(*)::int AS n FROM spend_items WHERE tenant_id = $1 AND nature = 'capex'`,
      [t.id],
    );
    console.log(`[Migration] BudgetLineSearchFields: ${t.slug} (${t.id}): ${n} CAPEX line(s) ${direction}`);
  }
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant ?? '']);
  if (!changed) console.log('[Migration] BudgetLineSearchFields: function already had this vector; entries refreshed');
}
