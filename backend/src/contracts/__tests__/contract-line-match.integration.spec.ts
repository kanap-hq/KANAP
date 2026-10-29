// @database-spec
import 'dotenv/config';
import { BadRequestException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import { applyDataAccess } from '../../data-access/data-access';
import { seedNodes, seedPerson, seedRole, type PgClient } from '../../data-access/__tests__/data-access-test-helpers';
import { listContractBudgetLines } from '../contract-relations';
import {
  budgetLineContractConsistency,
  contractBudgetLineConsistency,
  contractLineMismatches,
  type ContractLineMismatch,
} from '../contract-line-match';
import { readBudgetLineRelations } from '../../spend/budget-line-relations';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';

/**
 * A linked budget line and its contract are compared when the link is read (issue #1070):
 * paying company, cost center (a group covers its descendants, anything else is equality),
 * supplier (skipped when the line has none) and currency. Nothing is stored. A person who
 * cannot read the other record gets no row and no label from it.
 */

const LINE_ACCESS = { projects: false, applications: false, technologies: false, contracts: true, assets: false };

function clientOf(runner: QueryRunner): PgClient {
  return { query: async (sql: string, params?: unknown[]) => ({ rows: await runner.query(sql, params as any[]) }) } as unknown as PgClient;
}

function fields(rows: ContractLineMismatch[]): string[] {
  return rows.map((row) => row.field);
}

async function testChecks() {
  await inRolledBackTransaction(async (runner) => {
    const q = (sql: string, params?: unknown[]) => runner.query(sql, params as any[]);
    const one = async (sql: string, params?: unknown[]) => (await q(sql, params))[0];
    const tenantId = await seedTenant(runner, 'line-match');
    const company = async (name: string) => (await one(
      `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, $2, 'FR', 'Lyon') RETURNING id`,
      [tenantId, name],
    )).id as string;
    const supplier = async (name: string) => (await one(
      `INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`,
      [tenantId, name],
    )).id as string;
    const center = async (code: string, name: string, kind: 'group' | 'cost_center', parent: string | null, companyId: string | null, status = 'enabled') => (await one(
      `INSERT INTO cost_centers (tenant_id, code, kind, name, parent_id, company_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7::status_state) RETURNING id`,
      [tenantId, code, kind, name, parent, companyId, status],
    )).id as string;

    const sa = await company('Fromage SA');
    const italia = await company('Fromage Italia');
    const dairyOne = await supplier('Dairy One');
    const dairyTwo = await supplier('Dairy Two');
    const hiddenDairy = await supplier('Hidden Dairy Token');
    const secretSupplier = await supplier('Secret Supplier Token');

    const group = await center('GRP', 'Group', 'group', null, null);
    const nested = await center('NEST', 'Nested', 'group', group, null);
    const inside = await center('CC-IN', 'Inside', 'cost_center', group, sa);
    const deep = await center('CC-DEEP', 'Deep', 'cost_center', nested, sa);
    const disabled = await center('CC-OFF', 'Off', 'cost_center', group, sa, 'disabled');
    const outside = await center('CC-OUT', 'Outside', 'cost_center', null, sa);
    const leaf = await center('CC-LEAF', 'Leaf', 'cost_center', null, sa);
    // A center may have a child in the database. Only a group counts that child as inside.
    const child = await center('CC-CHILD', 'Child', 'cost_center', leaf, sa);

    const contract = async (name: string, companyId: string, supplierId: string, costCenterId: string | null, currency = 'EUR') => (await one(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, cost_center_id, start_date, currency)
       VALUES ($1, $2, $3, $4, $5, '2026-01-01', $6) RETURNING id`,
      [tenantId, name, companyId, supplierId, costCenterId, currency],
    )).id as string;
    let n = 1;
    const line = async (
      name: string,
      fields: { company?: string | null; center?: string | null; supplier?: string | null; currency?: string },
    ) => (await one(
      `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, paying_company_id, cost_center_id, supplier_id)
       VALUES ($1, $2, $3, '2026-01-01', $4, $5, $6, $7) RETURNING id`,
      [tenantId, name, fields.currency ?? 'EUR', n++, fields.company ?? null, fields.center ?? null, fields.supplier ?? null],
    )).id as string;
    const link = (contractId: string, lineId: string) => q(
      `INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES ($1, $2, $3)`,
      [tenantId, contractId, lineId],
    );

    const framework = await contract('Framework', sa, dairyOne, group);
    const open = await contract('Open', sa, dairyOne, null);
    const leafContract = await contract('Leaf contract', sa, dairyOne, leaf);
    const lowerCase = await contract('Lower currency', sa, dairyOne, null, 'eur');
    const secret = await contract('Secret framework', italia, secretSupplier, null);

    const matching = await line('Matching line', { company: sa, center: inside, supplier: dairyOne });
    const otherCompany = await line('Other company', { company: italia, center: inside, supplier: dairyOne });
    const otherCenter = await line('Other center', { company: sa, center: outside, supplier: dairyOne });
    const deepLine = await line('Deep line', { company: sa, center: deep, supplier: dairyOne });
    const disabledLine = await line('Disabled center', { company: sa, center: disabled, supplier: dairyOne });
    const otherSupplier = await line('Other supplier', { company: sa, center: inside, supplier: dairyTwo });
    const noSupplier = await line('No supplier', { company: sa, center: inside, supplier: null });
    const otherCurrency = await line('Other currency', { company: sa, center: inside, supplier: dairyOne, currency: 'USD' });
    const noCompany = await line('No paying company', { company: null, center: inside, supplier: dairyOne });
    const allFour = await line('All four', { company: italia, center: outside, supplier: dairyTwo, currency: 'USD' });
    const openLine = await line('Open line', { company: sa, center: inside, supplier: dairyOne });
    const childLine = await line('Child of a center', { company: sa, center: child, supplier: dairyOne });
    const padded = await line('Padded currency', { company: sa, supplier: dairyOne, currency: 'EUR' });
    const willChange = await line('Will change', { company: sa, supplier: dairyOne });
    const hiddenLine = await line('Hidden line token', { company: italia, supplier: hiddenDairy, currency: 'USD' });

    for (const id of [matching, otherCompany, otherCenter, deepLine, disabledLine, otherSupplier, noSupplier, otherCurrency, noCompany, allFour]) {
      await link(framework, id);
    }
    await link(open, openLine);
    await link(leafContract, childLine);
    await link(lowerCase, padded);
    const changeable = await contract('Changeable', sa, dairyOne, null);
    await link(changeable, willChange);
    await link(framework, hiddenLine);
    await link(secret, hiddenLine);

    const listed = await listContractBudgetLines(runner.manager, { id: framework, tenant_id: tenantId });
    const byName = new Map(listed.items.map((row) => [row.product_name, row.mismatches]));
    assert.deepEqual(byName.get('Matching line'), [], 'a line inside the contract group agrees');
    assert.deepEqual(byName.get('Deep line'), [], 'a center under a nested group is inside the contract group');
    assert.deepEqual(byName.get('Disabled center'), [], 'a disabled center under the group is still inside it');
    assert.deepEqual(fields(byName.get('Other company')!), ['paying_company']);
    assert.deepEqual(byName.get('Other company'), [{ field: 'paying_company', line_value: 'Fromage Italia', contract_value: 'Fromage SA' }]);
    assert.deepEqual(byName.get('Other center'), [{ field: 'cost_center', line_value: 'CC-OUT · Outside', contract_value: 'GRP · Group' }]);
    assert.deepEqual(byName.get('Other supplier'), [{ field: 'supplier', line_value: 'Dairy Two', contract_value: 'Dairy One' }]);
    assert.deepEqual(byName.get('No supplier'), [], 'a line with no supplier skips the supplier check');
    assert.deepEqual(byName.get('Other currency'), [{ field: 'currency', line_value: 'USD', contract_value: 'EUR' }]);
    assert.deepEqual(byName.get('No paying company'), [{ field: 'paying_company', line_value: null, contract_value: 'Fromage SA' }]);
    assert.deepEqual(fields(byName.get('All four')!), ['paying_company', 'cost_center', 'supplier', 'currency']);

    const openList = await listContractBudgetLines(runner.manager, { id: open, tenant_id: tenantId });
    assert.deepEqual(openList.items[0].mismatches, [], 'no cost center on the contract: the line center is not checked');
    const leafList = await listContractBudgetLines(runner.manager, { id: leafContract, tenant_id: tenantId });
    assert.deepEqual(leafList.items[0].mismatches, [{
      field: 'cost_center', line_value: 'CC-CHILD · Child', contract_value: 'CC-LEAF · Leaf',
    }], 'a center matches by equality: a child is not inside it');
    const paddedList = await listContractBudgetLines(runner.manager, { id: lowerCase, tenant_id: tenantId });
    assert.deepEqual(paddedList.items[0].mismatches, [], 'eur and EUR are the same currency');

    const before = await listContractBudgetLines(runner.manager, { id: changeable, tenant_id: tenantId });
    assert.deepEqual(before.items[0].mismatches, []);
    await q(`UPDATE contracts SET company_id = $2 WHERE tenant_id = $1 AND id = $3`, [tenantId, italia, changeable]);
    const after = await listContractBudgetLines(runner.manager, { id: changeable, tenant_id: tenantId });
    assert.deepEqual(after.items[0].mismatches, [{ field: 'paying_company', line_value: 'Fromage SA', contract_value: 'Fromage Italia' }]);
    const fromLine = await readBudgetLineRelations(runner.manager, willChange, { access: LINE_ACCESS });
    assert.deepEqual(fromLine.contracts?.[0].mismatches, after.items[0].mismatches, 'the line sees the same difference after the contract changes');

    const noBudget = await listContractBudgetLines(runner.manager, { id: framework, tenant_id: tenantId }, false);
    assert.deepEqual(noBudget, { items: [], hidden: 0 });
    assert.equal(JSON.stringify(noBudget).includes('Hidden line token'), false);
    assert.equal(JSON.stringify(noBudget).includes('Hidden Dairy Token'), false);
    const noBudgetPicker = await contractBudgetLineConsistency(runner.manager, { id: framework, tenant_id: tenantId }, `${matching},${hiddenLine}`, false);
    assert.deepEqual(noBudgetPicker, { items: [] });
    assert.equal(JSON.stringify(noBudgetPicker).includes('Hidden Dairy Token'), false, 'no budget right: no value from the line');

    const noContracts = await budgetLineContractConsistency(runner.manager, willChange, `${changeable},${secret}`, false);
    assert.deepEqual(noContracts, { items: [] });
    assert.equal(JSON.stringify(noContracts).includes('Secret Supplier Token'), false, 'no contracts right: no value from the contract');
    const picker = await contractBudgetLineConsistency(runner.manager, { id: framework, tenant_id: tenantId }, hiddenLine, true);
    assert.equal(picker.items.some((row) => row.id === hiddenLine), true, 'an unscoped reader sees the linked line');

    await assert.rejects(
      () => contractBudgetLineConsistency(runner.manager, { id: framework, tenant_id: tenantId }, 'not-a-uuid', true),
      (error: unknown) => error instanceof BadRequestException,
    );

    // Both paying companies unset agree. A missing center row is equality only and has no label.
    assert.deepEqual(contractLineMismatches(
      { id: 'l', paying_company_id: null, paying_company_name: null, cost_center_id: 'c', cost_center_code: 'CC', cost_center_name: 'Center', supplier_id: null, supplier_name: null, currency: 'eur' },
      { id: 'k', company_id: null, company_name: null, cost_center_id: 'missing', cost_center_code: null, cost_center_name: null, cost_center_kind: null, supplier_id: 's', supplier_name: 'S', currency: 'EUR' },
      () => new Set(['c', 'missing']),
    ), [{ field: 'cost_center', line_value: 'CC · Center', contract_value: null }]);

    const roleThere = (await q(`SELECT to_regrole('kanap_data_limited') IS NOT NULL AS present`))[0].present === true;
    if (!roleThere) {
      if (process.env.CI) assert.fail('CI installs kanap_data_limited before the migrations');
      console.log('  contract line match: kanap_data_limited is not installed, data-access half skipped');
      return;
    }

    const client = clientOf(runner);
    const roleId = await seedRole(client, tenantId, 'Limited reader');
    const person = await seedPerson(client, tenantId, 'limited', roleId);
    await seedNodes(client, tenantId, person, [{ type: 'company', id: sa, access: 'read' }]);
    await runner.query('SAVEPOINT person');
    try {
      await applyDataAccess(runner, person);
      const seen = await listContractBudgetLines(runner.manager, { id: framework, tenant_id: tenantId });
      assert.equal(seen.items.some((row) => row.id === hiddenLine), false, 'the line of the other company is absent');
      assert.equal(seen.items.some((row) => row.id === matching), true, 'the line of the company she reads stays');
      assert.ok(seen.hidden >= 1, 'the hidden link is counted');
      const seenJson = JSON.stringify(seen);
      assert.equal(seenJson.includes('Hidden line token'), false);
      assert.equal(seenJson.includes('Hidden Dairy Token'), false);
      assert.equal(seenJson.includes(hiddenLine), false);
      const candidates = await contractBudgetLineConsistency(
        runner.manager,
        { id: framework, tenant_id: tenantId },
        `${matching},${hiddenLine}`,
        true,
      );
      assert.deepEqual(candidates.items.map((row) => row.id), [matching]);
      assert.equal(JSON.stringify(candidates).includes('Hidden Dairy Token'), false, 'a line she cannot read gives no mark and no value');
      const contracts = await budgetLineContractConsistency(runner.manager, matching, `${framework},${secret}`, true);
      assert.equal(contracts.items.some((row) => row.id === secret), false);
      assert.equal(JSON.stringify(contracts).includes('Secret Supplier Token'), false, 'a contract she cannot read gives no mark and no value');
      const lineSide = await readBudgetLineRelations(runner.manager, matching, { access: LINE_ACCESS });
      assert.equal(JSON.stringify(lineSide).includes('Secret Supplier Token'), false);
    } finally {
      await runner.query('ROLLBACK TO SAVEPOINT person');
    }
  });
}

runSpecs('contract line match', [['the four checks, a group, a later edit and a hidden record', testChecks]]);
