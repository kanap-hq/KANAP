import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import { assert, inRolledBackTransaction, runSpecs, seedLine, seedTenant } from '../../__tests__/round-inputs.fixtures';
import { BUDGET_FILE_OPTIONS, budgetFileService, exportBudgetFile, withCell } from '../../__tests__/budget-file.fixtures';
import type { BudgetFileReport } from '../types';

// The budget file's messages name a column as the screen does, in the person's language: the
// workspace's name for it, else the product name in the language of the request. The English `message`
// keeps the English names; the parameters the screen and Kad's card translate carry the person's.
// @database-spec

const YEAR = new Date().getFullYear();

async function seed(runner: QueryRunner) {
  const tenantId = await seedTenant(runner, 'colnames');
  const [coa] = await runner.query(`INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'L', 'Local', 'FR') RETURNING id`, [tenantId]);
  const [tick] = await runner.query(
    `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name, quantity_price_expected) VALUES ($1, $2, 621100, 'Temporary staff', true) RETURNING id`,
    [tenantId, coa.id]);
  const [company] = await runner.query(`INSERT INTO companies (tenant_id, name, country_iso, city, coa_id) VALUES ($1, 'Paying Co', 'FR', 'Brest', $2) RETURNING id`, [tenantId, coa.id]);
  const line = await seedLine(runner, 'opex', tenantId, YEAR, { actual: Array(12).fill(100), expected_landing: Array(12).fill(100) }, 1);
  await runner.query(`UPDATE spend_items SET account_id = $2, paying_company_id = $3 WHERE id = $1`, [line.itemId, tick.id, company.id]);
  await runner.query(
    `INSERT INTO freeze_states (tenant_id, budget_year, scope, column_key, is_frozen) VALUES ($1, $2, 'opex', 'landing', true)`,
    [tenantId, YEAR]);
  const csv = await exportBudgetFile(runner.manager, 'opex', tenantId, [line.itemId], { columns: 'actual,landing' });
  return { tenantId, csv };
}

function preflight(runner: QueryRunner, tenantId: string, csv: string, language: string): Promise<BudgetFileReport> {
  return budgetFileService().preflight('opex', Buffer.from(csv, 'utf8'), { manager: runner.manager, tenantId, userId: null }, { ...BUDGET_FILE_OPTIONS, language });
}

/** The quantity and price warning of an Actuals cell changed, and the freeze error of an Expected landing cell changed. */
async function named(runner: QueryRunner, tenantId: string, csv: string, language: string) {
  const warned = await preflight(runner, tenantId, withCell(csv, `actual_${YEAR}`, '9999'), language);
  assert.equal(warned.ok, true, JSON.stringify(warned.errors));
  const warning: any = (warned.warnings.consistency ?? []).find((entry: any) => entry.code === 'BUDGET_FILE_QUANTITY_PRICE_EXPECTED');
  assert.ok(warning, `${language}: the quantity and price warning (${JSON.stringify(warned.warnings)})`);
  const frozen = await preflight(runner, tenantId, withCell(csv, `landing_${YEAR}`, '9999'), language);
  const error: any = (frozen.errors ?? []).find((entry: any) => entry.code === 'BUDGET_FILE_FROZEN');
  assert.ok(error, `${language}: the freeze error (${JSON.stringify(frozen.errors)})`);
  return { columns: warning.params.columns, warning: warning.message, frozen: error.params.label, error: error.message };
}

async function testColumnsInThePersonsLanguage() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, csv } = await seed(runner);
    const english = {
      warning: `Account 621100 expects quantity and price entry: complete Actuals ${YEAR} on the line's Budget tab.`,
      error: `Expected landing for ${YEAR} is frozen.`,
    };
    const cases: Array<[string, string, string]> = [
      ['en', 'Actuals', 'Expected landing'],
      ['fr', 'Réalisé', 'Atterrissage prévu'],
      ['de', 'Ist-Werte', 'Erwarteter Endwert'],
      ['es', 'Realizado', 'Aterrizaje previsto'],
    ];
    for (const [language, actual, landing] of cases) {
      assert.deepEqual(
        await named(runner, tenantId, csv, language),
        { columns: `${actual} ${YEAR}`, warning: english.warning, frozen: landing, error: english.error },
        `${language}: the parameters name the columns as the screen, the message stays English`,
      );
    }

    // A name the workspace gave a column wins in every language, in the message too.
    await runner.query(
      `UPDATE tenants SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{budget_columns}', $2::jsonb) WHERE id = $1`,
      [tenantId, JSON.stringify({ labels: { actual: 'Dépenses', expected_landing: 'Fin d’année' } })]);
    for (const language of ['en', 'fr', 'de', 'es']) {
      assert.deepEqual(
        await named(runner, tenantId, csv, language),
        {
          columns: `Dépenses ${YEAR}`,
          warning: `Account 621100 expects quantity and price entry: complete Dépenses ${YEAR} on the line's Budget tab.`,
          frozen: 'Fin d’année',
          error: `Fin d’année for ${YEAR} is frozen.`,
        },
        `${language}: the workspace's names win`,
      );
    }
    console.log('  the file names the columns in the person\'s language, the workspace\'s names first: OK');
  });
}

void runSpecs('budget-file-column-names.integration.spec', [
  ['the messages name the columns in the person\'s language', testColumnsInThePersonsLanguage],
]);
