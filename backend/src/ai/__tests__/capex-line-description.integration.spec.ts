// @database-spec: uses the PostgreSQL transaction harness.
import { randomUUID } from 'node:crypto';
import { AiQueryExecutor } from '../query/ai-query.executor';
import { AiEntityService } from '../ai-entity.service';
import { capexItemsRegistry } from '../query/registries/capex-items.registry';
import { itemService } from '../../spend/__tests__/cost-center.fixtures';
import { assert, inRolledBackTransaction, runSpecs } from '../../spend/__tests__/round-inputs.fixtures';
import { seedBudgetLines } from '../../spend/__tests__/budget-lines.fixtures';

runSpecs('capex-line-description.integration.spec', [['AI CAPEX list, filters, detail and search read the native description', async () => {
  await inRolledBackTransaction(async (runner) => {
    const world = await seedBudgetLines(runner);
    const capex = world.lines[1];
    const service = itemService('capex');
    const services = Array.from({ length: 23 }, () => ({}));
    services[17] = service;
    services[6] = { listContractsForCapexItem: async () => ({ items: [] }) };
    const executor = new (AiQueryExecutor as any)(...services) as AiQueryExecutor;
    const context = { tenantId: world.tenantId, userId: randomUUID(), manager: runner.manager, surface: 'chat', isPlatformHost: false, authMethod: 'jwt' } as any;
    assert.equal(capexItemsRegistry.fields.description.grid, 'description');
    assert.equal(capexItemsRegistry.fields.line_description.grid, 'line_description');
    const list = await executor.execute(context, { entity_type: 'capex_items', filters: { line_description: 'Native description 7102' } });
    assert.equal(list.total, 1, JSON.stringify(list));
    assert.equal(list.items[0].label, 'UniqueTitle7102');
    assert.equal(list.items[0].summary, 'Native description 7102');
    assert.equal(list.items[0].metadata?.line_description, 'Native description 7102');
    const absent = await executor.execute(context, { entity_type: 'capex_items', filters: { line_description: 'Other tenant only' } });
    assert.equal(absent.total, 0);
    const title = await executor.execute(context, { entity_type: 'capex_items', filters: { description: 'UniqueTitle7102' } });
    assert.equal(title.total, 1);
    const detail = await executor.executeDetail(context, { entity_type: 'capex_items', entity_id: capex.itemId });
    assert.equal(detail.entity.summary, 'Native description 7102');
    assert.equal(detail.entity.metadata?.line_description, 'Native description 7102');
    assert.equal(detail.data.description, 'UniqueTitle7102');
    assert.equal(detail.data.line_description, 'Native description 7102');
    const search = new (AiEntityService as any)();
    const searched = await (search as any).searchCapexItems(context, 'Native description 7102', 20);
    assert.equal(searched.total, 1);
    assert.equal(searched.items[0].label, 'UniqueTitle7102');
    assert.equal(searched.items[0].summary, 'Native description 7102');
    const alias = await service.get(capex.itemId, { manager: runner.manager });
    assert.equal(alias.description, 'UniqueTitle7102');
    assert.ok(!('line_description' in alias), 'the API alias stays unchanged');
  });
}]]).catch((error) => { console.error(error); process.exit(1); });
