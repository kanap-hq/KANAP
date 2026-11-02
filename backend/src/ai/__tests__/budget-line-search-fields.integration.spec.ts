// @database-spec
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { BudgetLineSearchFields1855960000000 } from '../../migrations/1855960000000-budget-line-search-fields';
import { runSpecs, seedTenant, setCurrentTenant, withRollback } from '../../analytics/__tests__/analytics-test-helpers';
import { AiEntityService } from '../ai-entity.service';

/**
 * A CAPEX line is found by a word of its description, and by its account, the same
 * weight-C text an OPEX line already indexes (migration 1855960000000).
 */

const migration = new BudgetLineSearchFields1855960000000();
const service = new AiEntityService({} as any, {
  listReadableEntityTypes: async (_context: unknown, requested: string[]) => requested,
  adminFamiliesGap: async () => 'right',
  canReadEntityType: async () => true,
  canReadKnowledge: async () => true,
  assertEntityTypeReadAccess: async () => undefined,
} as any);

const DESCRIPTION_WORD = 'quartzledger';
const ACCOUNT_WORD = 'xylophoneaccount';
const OPEX_WORD = 'opalharbor';

async function search(runner: QueryRunner, tenantId: string, query: string) {
  await setCurrentTenant(runner, tenantId);
  return service.searchAll(
    { tenantId, surface: 'chat', manager: runner.manager } as any,
    { query, entity_types: ['budget_lines'], limit: 20 },
  );
}

/** True when the line's vector matches the query the way global search does (both dictionaries). */
async function vectorMatches(runner: QueryRunner, tenantId: string, id: string, query: string): Promise<boolean> {
  await setCurrentTenant(runner, tenantId);
  const [row] = await runner.query(
    `SELECT COALESCE(bool_or(search_vector @@ (websearch_to_tsquery('kanap_fr', $3) || websearch_to_tsquery('kanap_en', $3))), false) AS hit
     FROM search_index WHERE tenant_id = $1 AND entity_id = $2`,
    [tenantId, id, query],
  );
  return row?.hit === true;
}

async function capexFoundByDescription() {
  const previous = process.env.AI_SEARCH_INDEX_ENABLED;
  process.env.AI_SEARCH_INDEX_ENABLED = 'true';
  try {
    await withRollback(async (runner) => {
      await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
      await migration.down(runner);

      const tenantId = await seedTenant(runner, 'blsf');
      const [chart] = await runner.query(
        `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'BLSF', 'Search chart', 'FR') RETURNING id`,
        [tenantId],
      );
      const [account] = await runner.query(
        `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name) VALUES ($1, $2, 884422, $3) RETURNING id`,
        [tenantId, chart.id, ACCOUNT_WORD],
      );
      const capexId = randomUUID();
      await runner.query(
        `INSERT INTO spend_items (
           id, tenant_id, nature, item_number, legacy_number, product_name, description, notes,
           currency, effective_start, account_id, ppe_type, investment_type, priority
         ) VALUES ($1, $2, 'capex', 910001, 'CPX-910001', 'Plain vessel', $3, 'Workshop notes',
                   'EUR', '2026-01-01', $4, 'hardware', 'replacement', 'medium')`,
        [capexId, tenantId, `A ${DESCRIPTION_WORD} renewal`, account.id],
      );
      const opexId = randomUUID();
      await runner.query(
        `INSERT INTO spend_items (id, tenant_id, nature, item_number, product_name, description, notes, currency, effective_start)
         VALUES ($1, $2, 'opex', 910002, 'Plain vessel', $3, 'Workshop notes', 'EUR', '2026-01-01')`,
        [opexId, tenantId, `An ${OPEX_WORD} subscription`],
      );

      assert.equal(await vectorMatches(runner, tenantId, capexId, DESCRIPTION_WORD), false, 'the previous CAPEX vector skips the description');
      assert.equal(await vectorMatches(runner, tenantId, capexId, ACCOUNT_WORD), false, 'the previous CAPEX vector skips the account');
      assert.equal((await search(runner, tenantId, DESCRIPTION_WORD)).items.some((item) => item.id === capexId), false);
      const opexBefore = await search(runner, tenantId, OPEX_WORD);
      assert.equal(opexBefore.items.some((item) => item.id === opexId), true, 'an OPEX description stays searchable');

      await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
      await migration.up(runner);
      await migration.up(runner);

      assert.equal(await vectorMatches(runner, tenantId, capexId, DESCRIPTION_WORD), true, 'the shared vector keeps the description');
      assert.equal(await vectorMatches(runner, tenantId, capexId, ACCOUNT_WORD), true, 'the shared vector keeps the account name');
      assert.equal(await vectorMatches(runner, tenantId, capexId, '884422'), true, 'the shared vector keeps the account number');

      const byDescription = await search(runner, tenantId, DESCRIPTION_WORD);
      const capexHit = byDescription.items.find((item) => item.id === capexId);
      assert.ok(capexHit, 'search finds the CAPEX line by a word of its description');
      assert.equal(capexHit.type, 'budget_lines');
      assert.equal(capexHit.metadata?.nature, 'capex');
      const byAccount = await search(runner, tenantId, ACCOUNT_WORD);
      assert.equal(byAccount.items.some((item) => item.id === capexId), true, 'search finds the CAPEX line by its account');
      const opexAfter = await search(runner, tenantId, OPEX_WORD);
      assert.equal(opexAfter.items.some((item) => item.id === opexId), true, 'an OPEX description is still found');

      const [fn] = await runner.query(
        `SELECT prosecdef AS definer, proconfig AS config FROM pg_proc WHERE oid = to_regprocedure('search_index_refresh_capex_items(uuid,uuid[])')`,
      );
      const config = Array.isArray(fn?.config) ? fn.config.join(' ') : String(fn?.config ?? '');
      assert.equal(fn?.definer, true, 'the refresh function stays security definer');
      assert.match(config, /search_path/);
    });
  } finally {
    if (previous === undefined) delete process.env.AI_SEARCH_INDEX_ENABLED;
    else process.env.AI_SEARCH_INDEX_ENABLED = previous;
  }
}

void runSpecs('budget-line-search-fields', [capexFoundByDescription]);
