import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { EntityManager, QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { DEFAULT_CLASSIFICATION_CATALOG } from '../../it-ops-settings/classification-catalog';
import { Asset } from '../../assets/asset.entity';
import { Connection } from '../connection.entity';
import { ConnectionLeg } from '../connection-leg.entity';
import { ConnectionProtocol } from '../connection-protocol.entity';
import { ConnectionServer } from '../connection-server.entity';
import { ConnectionsListService } from '../services/connections-list.service';
import { ConnectionsService } from '../services/connections.service';
import { AiAggregateExecutor } from '../../ai/query/ai-aggregate.executor';
import { AiQueryExecutor } from '../../ai/query/ai-query.executor';
import { seedApps, seedInterface, seedTenant, setCurrentTenant } from '../../interfaces/__tests__/interface-seed-helpers';

// The connections list filters, sorts and pages on the effective risk values (a derived
// connection takes the highest classification of its linked interfaces), computed in SQL
// with the tenant catalog's ranks; the rows show the same values. Each axis takes its own
// maximum, and an interface outside the catalog marks the result incomplete.
//
// Tenant isolation: the spec runs as the `app` role, so row level security already hides
// tenant B's rows from tenant A's session. The tenant B assertions below therefore hold with
// or without the explicit tenant predicates inside the aggregate; only the `crossed` call
// (tenant B asked for in tenant A's session) proves the explicit `c.tenant_id` predicate.

// Ranks deliberately disagree with the alphabetical order of the codes.
const CATALOG = {
  ...DEFAULT_CLASSIFICATION_CATALOG,
  businessCriticalityLevels: [
    { code: 'alpha_top', label: 'Top', description: '', rank: 40, maxMtdMinutes: 60 },
    { code: 'zulu_low', label: 'Low', description: '', rank: 10, maxMtdMinutes: null },
  ],
  dataClasses: [
    { code: 'secret', label: 'Secret', description: '', rank: 90 },
    { code: 'open', label: 'Open', description: '', rank: 3 },
  ],
};

function service(manager: EntityManager) {
  const settings = {
    getClassificationCatalog: async () => CATALOG,
    getSettings: async () => ({ entities: [], connectionTypes: [] }),
  };
  return new ConnectionsListService(
    manager.getRepository(Connection),
    manager.getRepository(ConnectionServer),
    manager.getRepository(ConnectionProtocol),
    manager.getRepository(ConnectionLeg),
    manager.getRepository(Asset),
    settings as any,
  );
}

async function seedConnection(
  runner: QueryRunner,
  tenantId: string,
  name: string,
  values: { risk_mode: 'manual' | 'derived'; criticality: string | null; data_class?: string | null; contains_pii?: boolean },
): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO connections (tenant_id, name, topology, risk_mode, criticality, data_class, contains_pii)
     VALUES ($1, $2, 'server_to_server', $3, $4, $5, $6) RETURNING id`,
    [tenantId, name, values.risk_mode, values.criticality, values.data_class ?? null, values.contains_pii ?? false],
  );
  return row.id;
}

async function link(runner: QueryRunner, tenantId: string, bindingId: string, connectionId: string) {
  await runner.query(
    `INSERT INTO interface_connection_links (tenant_id, interface_binding_id, connection_id) VALUES ($1, $2, $3)`,
    [tenantId, bindingId, connectionId],
  );
}

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantA = await seedTenant(runner, 'conn-a');
    const apps = await seedApps(runner, tenantA);
    // The top criticality and the top data class sit on two different interfaces.
    const topCrit = await seedInterface(runner, tenantA, apps, { name: 'Top open feed', criticality: 'alpha_top', data_class: 'open', contains_pii: true });
    const topClass = await seedInterface(runner, tenantA, apps, { name: 'Low secret feed', criticality: 'zulu_low', data_class: 'secret' });
    const low = await seedInterface(runner, tenantA, apps, { name: 'Low open feed', criticality: 'zulu_low', data_class: 'open' });
    const unclassified = await seedInterface(runner, tenantA, apps, { name: 'Unclassified feed', criticality: null, data_class: 'unknown' });

    // Derived, stored "low / open", linked to both: effective top (from one interface), secret
    // (from the other), PII.
    const derivedTop = await seedConnection(runner, tenantA, 'Derived top', { risk_mode: 'derived', criticality: 'zulu_low', data_class: 'open' });
    await link(runner, tenantA, topCrit.bindingId, derivedTop);
    await link(runner, tenantA, topClass.bindingId, derivedTop);
    // Derived, one interface in the catalog and one outside it: the known codes, incomplete.
    const derivedPartial = await seedConnection(runner, tenantA, 'Derived partial', { risk_mode: 'derived', criticality: 'alpha_top', data_class: 'secret' });
    await link(runner, tenantA, low.bindingId, derivedPartial);
    await link(runner, tenantA, unclassified.bindingId, derivedPartial);
    // Derived, stored "top", no link: effective unknown.
    const derivedBare = await seedConnection(runner, tenantA, 'Derived bare', { risk_mode: 'derived', criticality: 'alpha_top', data_class: 'secret' });
    // Derived with an interface outside the catalog: unknown and incomplete.
    const derivedIncomplete = await seedConnection(runner, tenantA, 'Derived incomplete', { risk_mode: 'derived', criticality: 'zulu_low', data_class: 'open' });
    await link(runner, tenantA, unclassified.bindingId, derivedIncomplete);
    // Manual connections keep their stored values, links or not.
    const manualLow = await seedConnection(runner, tenantA, 'Manual low', { risk_mode: 'manual', criticality: 'zulu_low', data_class: 'open' });
    await link(runner, tenantA, topCrit.bindingId, manualLow);
    await seedConnection(runner, tenantA, 'Manual top', { risk_mode: 'manual', criticality: 'alpha_top', data_class: 'open' });
    await seedConnection(runner, tenantA, 'Manual historical', { risk_mode: 'manual', criticality: 'historical-class', data_class: 'historical-data' });

    // Tenant B links its own top interface to A's bare derived connection (foreign keys do
    // not carry the tenant, so the row can exist) and to a connection of its own.
    const tenantB = await seedTenant(runner, 'conn-b');
    const appsB = await seedApps(runner, tenantB);
    const topB = await seedInterface(runner, tenantB, appsB, { name: 'Tenant B feed', criticality: 'alpha_top', data_class: 'secret', contains_pii: true });
    await link(runner, tenantB, topB.bindingId, derivedBare);
    const connectionB = await seedConnection(runner, tenantB, 'Tenant B derived', { risk_mode: 'derived', criticality: null });
    await link(runner, tenantB, topB.bindingId, connectionB);

    await setCurrentTenant(runner, tenantA);
    const svc = service(runner.manager);
    const opts = { manager: runner.manager };
    const list = (filters: Record<string, unknown>, sort = 'name:ASC') =>
      svc.list(tenantA, { filters: JSON.stringify(filters), sort, limit: 100 }, opts);
    const ids = (filters: Record<string, unknown>, sort = 'name:ASC') =>
      svc.listIds(tenantA, { filters: JSON.stringify(filters), sort }, opts);
    const names = (result: { items: Array<{ name: string }> }) => result.items.map((item) => item.name);

    // Rows carry the effective values.
    const all = await list({});
    assert.equal(all.total, 7, 'tenant B rows never appear');
    const byName = new Map(all.items.map((item: any) => [item.name, item]));
    const top1 = byName.get('Derived top') as any;
    assert.equal(top1.effective_criticality, 'alpha_top');
    assert.equal(top1.effective_data_class, 'secret');
    assert.equal(top1.effective_contains_pii, true);
    assert.equal(top1.derived_interface_count, 2);
    assert.equal(top1.classification_incomplete, false);
    const partial = byName.get('Derived partial') as any;
    assert.equal(partial.effective_criticality, 'zulu_low', 'the known code wins over the unknown one');
    assert.equal(partial.effective_data_class, 'open');
    assert.equal(partial.derived_interface_count, 2);
    assert.equal(partial.classification_incomplete, true);
    const bare = byName.get('Derived bare') as any;
    assert.equal(bare.effective_criticality, null, 'tenant B interface does not reach a tenant A connection');
    assert.equal(bare.effective_data_class, null);
    assert.equal(bare.effective_contains_pii, false);
    assert.equal(bare.derived_interface_count, 0);
    assert.equal(bare.classification_incomplete, true);
    const incomplete = byName.get('Derived incomplete') as any;
    assert.equal(incomplete.effective_criticality, null);
    assert.equal(incomplete.effective_data_class, null);
    assert.equal(incomplete.classification_incomplete, true);
    const manualRow = byName.get('Manual low') as any;
    assert.equal(manualRow.effective_criticality, 'zulu_low', 'a manual connection ignores its links');
    assert.equal(manualRow.effective_contains_pii, false);
    assert.equal(manualRow.derived_interface_count, 1);
    assert.equal(manualRow.classification_incomplete, false);
    const historical = byName.get('Manual historical') as any;
    assert.equal(historical.effective_criticality, 'historical-class');
    assert.equal(historical.effective_data_class, 'historical-data');
    assert.equal(historical.classification_incomplete, false);

    // The derived connection is found by its effective criticality only.
    assert.deepEqual(names(await list({ criticality: { filterType: 'set', values: ['alpha_top'] } })), ['Derived top', 'Manual top']);
    assert.deepEqual(names(await list({ criticality: { filterType: 'set', values: ['zulu_low'] } })), ['Derived partial', 'Manual low']);
    assert.deepEqual(
      names(await list({ criticality: { filterType: 'set', values: [null] } })),
      ['Derived bare', 'Derived incomplete'],
    );
    assert.deepEqual(names(await list({ data_class: { filterType: 'set', values: ['secret'] } })), ['Derived top']);
    assert.deepEqual(names(await list({ contains_pii: { filterType: 'set', values: ['true'] } })), ['Derived top']);
    assert.deepEqual(names(await list({ criticality: { filterType: 'set', values: [] } })), [], 'an empty set matches nothing');
    // Two values return both.
    assert.deepEqual(
      names(await list({ criticality: { filterType: 'set', values: ['alpha_top', 'zulu_low'] } })),
      ['Derived partial', 'Derived top', 'Manual low', 'Manual top'],
    );

    // listIds applies the same filters and order as list.
    const filtered = { criticality: { filterType: 'set', values: ['alpha_top', 'zulu_low'] } };
    const filteredList = await list(filtered, 'criticality:DESC');
    const filteredIds = await ids(filtered, 'criticality:DESC');
    assert.deepEqual(filteredIds.ids, filteredList.items.map((item: any) => item.id));
    assert.equal(filteredIds.total, filteredList.total);

    // Sorting by criticality follows the effective value's catalog rank, unknown values last.
    const rank = (code: string | null) => CATALOG.businessCriticalityLevels.find((level) => level.code === code)?.rank ?? null;
    const ascending = (await list({}, 'criticality:ASC')).items.map((item: any) => rank(item.effective_criticality));
    assert.deepEqual(ascending, [10, 10, 40, 40, null, null, null]);
    const descending = (await list({}, 'criticality:DESC')).items.map((item: any) => rank(item.effective_criticality));
    assert.deepEqual(descending, [40, 40, 10, 10, null, null, null]);
    const derivedTopFirst = (await list({ risk_mode: { filterType: 'set', values: ['derived'] } }, 'criticality:DESC')).items[0] as any;
    assert.equal(derivedTopFirst.id, derivedTop, 'the stored "low" value does not drive the sort');

    // Paging walks the sorted set without overlap.
    const page1 = await svc.list(tenantA, { sort: 'criticality:DESC', limit: 4, page: 1 }, opts);
    const page2 = await svc.list(tenantA, { sort: 'criticality:DESC', limit: 4, page: 2 }, opts);
    const paged = [...page1.items, ...page2.items].map((item: any) => item.id);
    assert.deepEqual(paged, (await ids({}, 'criticality:DESC')).ids);
    assert.equal(new Set(paged).size, 7);

    // The workspace, the asset view and the map read the same values for the ids they ask for,
    // and the aggregate only covers those ids.
    const subset = await (svc as any).computeEffectiveRiskForConnections(tenantA, [{ id: derivedTop }, { id: derivedPartial }], runner.manager);
    assert.deepEqual([...subset.keys()].sort(), [derivedTop, derivedPartial].sort());
    for (const [id, risk] of subset as Map<string, any>) {
      const row = all.items.find((item: any) => item.id === id) as any;
      assert.deepEqual(risk, {
        effective_criticality: row.effective_criticality,
        effective_data_class: row.effective_data_class,
        effective_contains_pii: row.effective_contains_pii,
        derived_interface_count: row.derived_interface_count,
        classification_incomplete: row.classification_incomplete,
      });
    }

    // The AI aggregate groups and the AI filter discovery read the same effective values.
    const facade = new ConnectionsService(svc, {} as any, {} as any, {} as any);
    // Only the connections service is used on these paths; it sits 21st in both constructors.
    const unused = Array.from({ length: 20 }, () => ({}) as any);
    const aggregate = new (AiAggregateExecutor as any)(...unused, facade, {}) as AiAggregateExecutor;
    const discovery = new (AiQueryExecutor as any)(...unused, facade, {}, {}) as AiQueryExecutor;
    const aiContext = { tenantId: tenantA, isPlatformHost: false, surface: 'chat', authMethod: 'jwt', manager: runner.manager } as any;
    const groups = async (groupBy: string, filters?: Record<string, unknown>) =>
      (await aggregate.execute(aiContext, { entity_type: 'connections', group_by: groupBy, filters: filters as any })).groups;
    assert.deepEqual(await groups('criticality'), [
      { key: 'alpha_top', count: 2 },
      { key: 'zulu_low', count: 2 },
      { key: null, count: 2 },
      { key: 'historical-class', count: 1 },
    ]);
    // Stored values would put "Derived top" under zulu_low.
    assert.deepEqual(await groups('criticality', { criticality: ['alpha_top'] }), [{ key: 'alpha_top', count: 2 }]);
    assert.deepEqual(await groups('data_class', { criticality: ['alpha_top'] }), [{ key: 'open', count: 1 }, { key: 'secret', count: 1 }]);
    assert.deepEqual(await groups('contains_pii'), [{ key: 'false', count: 6 }, { key: 'true', count: 1 }]);
    assert.deepEqual(await groups('lifecycle'), [{ key: 'active', count: 7 }], 'other fields keep the SQL path');
    const discovered = await discovery.executeFilterValues(aiContext, { entity_type: 'connections', fields: ['criticality', 'data_class', 'contains_pii'] });
    assert.deepEqual(discovered.values.criticality, ['alpha_top', 'historical-class', 'zulu_low', null]);
    assert.deepEqual(discovered.values.data_class, ['historical-data', 'open', 'secret', null], 'derived connections without a value offer blank');
    assert.deepEqual(discovered.values.contains_pii, ['true', 'false']);

    // The explicit tenant predicate: asking for tenant B in tenant A's session returns nothing.
    const crossed = await svc.list(tenantB, { limit: 100 }, opts);
    assert.equal(crossed.total, 0);
    assert.deepEqual(crossed.items, []);

    // Tenant B sees its own derived connection with its own interface.
    await setCurrentTenant(runner, tenantB);
    const listB = await svc.list(tenantB, { limit: 100 }, opts);
    assert.deepEqual(listB.items.map((item: any) => [item.name, item.effective_criticality, item.derived_interface_count]), [
      ['Tenant B derived', 'alpha_top', 1],
    ]);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
}

run()
  .then(() => console.log('connections effective filter integration tests passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
