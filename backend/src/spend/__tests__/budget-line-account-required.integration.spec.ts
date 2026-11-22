// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { verifyCreationToken } from '../../common/creation/creation-token';
import { BUDGET_LINE_CREATION } from '../budget-line-creation';
import { BudgetLinesController } from '../budget-lines.controller';
import { BudgetLinesService } from '../budget-lines.service';
import { CapexItemsController } from '../capex-items.controller';
import { SpendItemsController } from '../spend-items.controller';
import { deps } from './budget-lines.fixtures';
import { itemService, refusal, seedCompany, seedUser } from './cost-center.fixtures';
import { inRolledBackTransaction, runSpecs, seedTenant } from './round-inputs.fixtures';

// A new budget line has an account, whatever the door (lot L3a, decisions D36 and D37): the write
// gate (`resolveItemWrite`) refuses a create without one, 400 `Account is required.`, on
// `POST /budget-lines` and on the legacy aliases `POST /spend-items` and `POST /capex-items`, for
// both types. With an account, `POST /budget-lines` hands its creator a creation token, as the
// families created from a draft; the aliases do not. No door is exempted: the screen creates a line
// from its draft through `POST /budget-lines` (pass B), and the creation at the title is gone. A line
// already stored without an account (inserted before this rule) still takes updates without being
// given one.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'budget-line-account-required-spec-secret';

const TODAY = new Date().toISOString().slice(0, 10);
const REQUIRED = 'Account is required.';

type Seed = { tenantId: string; userId: string; companyId: string; accountId: string };

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = await seedTenant(runner, 'account-required');
  const { companyId, accountId } = await seedCompany(runner, tenantId, `${tenantId.slice(0, 8)} company`);
  const userId = await seedUser(runner, tenantId, `creator-${tenantId.slice(0, 8)}@example.com`);
  return { tenantId, userId, companyId, accountId };
}

function doors(runner: QueryRunner) {
  const audit = new AuditService(runner.manager.getRepository(AuditLog));
  const opex = itemService('opex', audit);
  const capex = itemService('capex', audit);
  const svc = new BudgetLinesService(deps.allocationCalculator as any, deps.fxRates as any, undefined as any, undefined as any, opex, capex, audit as any);
  const lines = Object.assign(Object.create(BudgetLinesController.prototype), { svc }) as BudgetLinesController;
  const spendItems = Object.assign(Object.create(SpendItemsController.prototype), { svc: opex }) as SpendItemsController;
  const capexItems = Object.assign(Object.create(CapexItemsController.prototype), { svc: capex }) as CapexItemsController;
  return { svc, lines, spendItems, capexItems };
}

function ctx(s: Seed, runner: QueryRunner) {
  return { tenantId: s.tenantId, userId: s.userId, isAdmin: false, manager: runner.manager } as any;
}

function lineBody(s: Seed, nature: 'opex' | 'capex', name: string, extra: Record<string, unknown> = {}) {
  return { nature, product_name: name, currency: 'EUR', effective_start: TODAY, paying_company_id: s.companyId, ...extra };
}

async function assertAccountRequired(runner: QueryRunner, label: string, fn: () => Promise<unknown>) {
  const error: any = await refusal(runner, fn);
  assert.equal(error?.getStatus?.(), 400, `${label}: 400 expected, got ${error?.message}`);
  assert.equal(error.message, REQUIRED, label);
}

async function testBudgetLinesNeedAnAccountAndHandAToken() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner);
    const { lines } = doors(runner);
    for (const nature of ['opex', 'capex'] as const) {
      await assertAccountRequired(runner, `POST /budget-lines ${nature} without account`, () => lines.create(lineBody(s, nature, `No account ${nature}`), ctx(s, runner)));
      await assertAccountRequired(runner, `POST /budget-lines ${nature} with an empty account`, () => lines.create(lineBody(s, nature, `Empty account ${nature}`, { account_id: null }), ctx(s, runner)));

      const created: any = await lines.create(lineBody(s, nature, `With account ${nature}`, { account_id: s.accountId }), ctx(s, runner));
      assert.equal(created.account_id, s.accountId, `${nature}: the line holds its account`);
      assert.equal(created.nature, nature);
      assert.equal(typeof created.creation_token, 'string', `${nature}: POST /budget-lines hands a creation token`);
      assert.equal(
        verifyCreationToken(created.creation_token, { tenantId: s.tenantId, family: BUDGET_LINE_CREATION, recordId: created.id, userId: s.userId }),
        true,
        `${nature}: the token opens the creation routes of this line for its creator`,
      );
    }
  });
}

async function testAliasesNeedAnAccountWithoutToken() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner);
    const { spendItems, capexItems } = doors(runner);
    const opexBody = { product_name: 'Alias OPEX', currency: 'EUR', effective_start: TODAY, paying_company_id: s.companyId };
    const capexBody = { description: 'Alias CAPEX', currency: 'EUR', effective_start: TODAY, paying_company_id: s.companyId };
    await assertAccountRequired(runner, 'POST /spend-items without account', () => spendItems.create(opexBody as any, ctx(s, runner)));
    await assertAccountRequired(runner, 'POST /capex-items without account', () => capexItems.create(capexBody as any, ctx(s, runner)));

    const opex: any = await spendItems.create({ ...opexBody, account_id: s.accountId } as any, ctx(s, runner));
    const capex: any = await capexItems.create({ ...capexBody, account_id: s.accountId } as any, ctx(s, runner));
    assert.deepEqual([opex.account_id, capex.account_id], [s.accountId, s.accountId], 'the aliases create a line with its account');
    assert.equal('creation_token' in opex, false, 'POST /spend-items hands no token');
    assert.equal('creation_token' in capex, false, 'POST /capex-items hands no token');
  });
}

async function testNoDoorIsExempted() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner);
    const { lines } = doors(runner);
    assert.equal(typeof (lines as any).createAtTitle, 'undefined', 'no creation at the title');
    const body = { nature: 'opex', product_name: 'At its title', currency: 'EUR', effective_start: TODAY, paying_company_id: s.companyId };
    const refused = await refusal(runner, () => lines.create(body, ctx(s, runner)));
    assert.equal(refused.message, REQUIRED, 'the screen\'s create needs the account like every door');
  });
}

async function testStoredLineWithoutAccountStillUpdates() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner);
    const { svc } = doors(runner);
    for (const nature of ['opex', 'capex'] as const) {
      const id = randomUUID();
      // A line created by the API or by Kad before this version: a company, no account.
      await runner.query(
        `INSERT INTO spend_items (id, tenant_id, nature, product_name, currency, effective_start, item_number, paying_company_id)
         VALUES ($1, $2, $3, $4, 'EUR', '2026-01-01', (SELECT COALESCE(MAX(item_number), 0) + 1 FROM spend_items WHERE tenant_id = $2), $5)`,
        [id, s.tenantId, nature, `Stored ${nature}`, s.companyId],
      );
      const updated: any = await svc.update(id, { notes: `Edited ${nature}` }, s.userId, { manager: runner.manager });
      assert.deepEqual([updated.notes, updated.account_id ?? null], [`Edited ${nature}`, null], `${nature}: updated, still without account`);
    }
  });
}

runSpecs('budget-line-account-required', [
  ['POST /budget-lines needs an account, OPEX and CAPEX, and hands a creation token', testBudgetLinesNeedAnAccountAndHandAToken],
  ['the legacy aliases need an account and hand no token', testAliasesNeedAnAccountWithoutToken],
  ['no door creates a line without account', testNoDoorIsExempted],
  ['a stored line without account still takes updates', testStoredLineWithoutAccountStillUpdates],
]);
