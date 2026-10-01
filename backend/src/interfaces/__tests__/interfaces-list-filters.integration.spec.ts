import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { EntityManager } from 'typeorm';
import dataSource from '../../data-source';
import { Application } from '../../applications/application.entity';
import { InterfaceBinding } from '../../interface-bindings/interface-binding.entity';
import { InterfaceEntity } from '../interface.entity';
import { InterfaceLeg } from '../interface-leg.entity';
import { InterfaceMiddlewareApplication } from '../interface-middleware-application.entity';
import { InterfacesListService } from '../services/interfaces-list.service';
import { seedApps, seedInterface, seedTenant, setCurrentTenant } from './interface-seed-helpers';

// The interfaces list compiles the grid's filter model column by column: a set filter
// keeps every selected value (it used to keep the first one), an empty set matches
// nothing, and the prev/next ids walk exactly the rows the list returns.

function service(manager: EntityManager) {
  return new InterfacesListService(
    manager.getRepository(InterfaceEntity),
    manager.getRepository(InterfaceLeg),
    manager.getRepository(InterfaceMiddlewareApplication),
    manager.getRepository(Application),
    manager.getRepository(InterfaceBinding),
    {} as any,
  );
}

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantA = await seedTenant(runner, 'intf-a');
    const apps = await seedApps(runner, tenantA);
    const [billing] = await runner.query(`INSERT INTO business_processes (tenant_id, name) VALUES ($1, 'Billing') RETURNING id`, [tenantA]);
    const [payroll] = await runner.query(`INSERT INTO business_processes (tenant_id, name) VALUES ($1, 'Payroll') RETURNING id`, [tenantA]);
    await seedInterface(runner, tenantA, apps, {
      name: 'Invoices', lifecycle: 'active', criticality: 'business_critical', data_category: 'transactional',
      contains_pii: true, business_process_id: billing.id,
    });
    await seedInterface(runner, tenantA, apps, {
      name: 'Payslips', lifecycle: 'deprecated', criticality: 'high', data_category: 'master_data',
      contains_pii: true, business_process_id: payroll.id,
    });
    await seedInterface(runner, tenantA, apps, {
      name: 'Rates', lifecycle: 'proposed', criticality: 'low', data_category: 'reference_data',
    });

    // Another tenant's interface with the same values never shows.
    const tenantB = await seedTenant(runner, 'intf-b');
    const appsB = await seedApps(runner, tenantB);
    await seedInterface(runner, tenantB, appsB, { name: 'Invoices B', lifecycle: 'active', criticality: 'business_critical' });

    await setCurrentTenant(runner, tenantA);
    const svc = service(runner.manager);
    const opts = { manager: runner.manager };
    const query = (filters: Record<string, unknown>) => ({ filters: JSON.stringify(filters), sort: 'name:ASC', limit: 100 });
    const names = async (filters: Record<string, unknown>) => {
      const result = await svc.list(query(filters), opts);
      const ids = await svc.listIds(query(filters), opts);
      // list and listIds apply the same filters and order.
      assert.deepEqual(ids.ids, result.items.map((item: any) => item.id), `ids for ${JSON.stringify(filters)}`);
      assert.equal(ids.total, result.total);
      assert.equal(result.total, result.items.length);
      return result.items.map((item: any) => item.name);
    };
    const set = (...values: Array<string | null>) => ({ filterType: 'set', values });

    assert.deepEqual(await names({}), ['Invoices', 'Payslips', 'Rates']);

    // Two values return both.
    assert.deepEqual(await names({ lifecycle: set('active', 'deprecated') }), ['Invoices', 'Payslips']);
    assert.deepEqual(await names({ criticality: set('business_critical', 'low') }), ['Invoices', 'Rates']);
    assert.deepEqual(await names({ data_category: set('master_data', 'reference_data') }), ['Payslips', 'Rates']);
    assert.deepEqual(await names({ business_process_id: set(billing.id, payroll.id) }), ['Invoices', 'Payslips']);
    assert.deepEqual(await names({ business_process_id: set(null) }), ['Rates']);
    assert.deepEqual(await names({ contains_pii: set('false') }), ['Rates']);
    assert.deepEqual(await names({ contains_pii: set('true', 'false') }), ['Invoices', 'Payslips', 'Rates']);

    // The prev/next id list honours its limit even though the query joins other tables.
    const capped = await svc.listIds({ sort: 'name:ASC', limit: 2 }, opts);
    assert.equal(capped.total, 3);
    assert.equal(capped.ids.length, 2);

    // An empty set returns none.
    assert.deepEqual(await names({ lifecycle: set() }), []);
    assert.deepEqual(await names({ criticality: set() }), []);

    // Filters combine; text and environment filters still apply.
    assert.deepEqual(await names({ lifecycle: set('active', 'deprecated'), contains_pii: set('true'), criticality: set('high') }), ['Payslips']);
    assert.deepEqual(await names({ name: { filterType: 'text', type: 'contains', filter: 'slip' } }), ['Payslips']);
    assert.deepEqual(await names({ binding_environments: { filterType: 'text', type: 'contains', filter: 'pro' } }), ['Invoices', 'Payslips', 'Rates']);
    assert.deepEqual(await names({ binding_environments: { filterType: 'text', type: 'contains', filter: 'qa' } }), []);

    // The business process filter offers the processes in use, and blank for none.
    const values = await svc.businessProcessFilterValues(opts);
    assert.deepEqual(values, [
      { value: null, label: null },
      { value: billing.id, label: 'Billing' },
      { value: payroll.id, label: 'Payroll' },
    ]);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
}

run()
  .then(() => console.log('interfaces list filter integration tests passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
