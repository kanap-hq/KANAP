// @database-spec: uses the PostgreSQL transaction harness.
import { randomUUID } from 'node:crypto';
import { AiQueryExecutor } from '../query/ai-query.executor';
import { AiEntityService } from '../ai-entity.service';
import { getAiEntityRegistry } from '../query/registries';
import { itemService } from '../../spend/__tests__/cost-center.fixtures';
import { assert, inRolledBackTransaction, runSpecs } from '../../spend/__tests__/round-inputs.fixtures';
import { seedBudgetLines, budgetService } from '../../spend/__tests__/budget-lines.fixtures';
import { realAllocationCalculator } from '../../spend/__tests__/oracle/oracle-deps';

// The AI surface reads one budget line family in its native shape (`product_name` is the title,
// `description` the real description). The CAPEX historical shape (`description` as the title,
// `line_description` for the description) is gone from the AI surface; the CAPEX API keeps its
// alias for the CAPEX screens.
runSpecs('capex-line-description.integration.spec', [['AI budget lines read the native title and description', async () => {
  await inRolledBackTransaction(async (runner) => {
    const world = await seedBudgetLines(runner);
    const capex = world.lines[1];
    const services: any[] = Array.from({ length: 25 }, () => ({}));
    services[1] = budgetService(runner);
    services[6] = { listContractsForSpendItem: async () => ({ items: [] }), listContractsForCapexItem: async () => ({ items: [] }) };
    services[22] = realAllocationCalculator();
    services[23] = { canReadEntityType: async () => true, effectiveAccess: async () => ({ isAdmin: false, permissions: {} }) };
    const executor = new (AiQueryExecutor as any)(...services) as AiQueryExecutor;
    const context = { tenantId: world.tenantId, userId: randomUUID(), manager: runner.manager, surface: 'chat', isPlatformHost: false, authMethod: 'jwt' } as any;

    const registry = getAiEntityRegistry('budget_lines');
    assert.equal(registry.fields.product_name.grid, 'product_name', 'the title is product_name');
    assert.equal(registry.fields.description.grid, 'description', 'description is the real description');
    assert.equal(registry.fields.line_description, undefined, 'the CAPEX line_description field is gone');

    const list = await executor.execute(context, { entity_type: 'budget_lines', filters: { product_name: 'UniqueTitle7102' } });
    assert.equal(list.total, 1, JSON.stringify(list));
    assert.equal(list.items[0].label, 'UniqueTitle7102');
    assert.equal(list.items[0].summary, 'Native description 7102');
    assert.equal(list.items[0].metadata?.nature, 'capex');

    const described = await executor.execute(context, { entity_type: 'budget_lines', filters: { description: 'Native description 7102' } });
    assert.equal(described.total, 1, `a filter on the real description finds the CAPEX line: ${JSON.stringify(described)}`);
    const absent = await executor.execute(context, { entity_type: 'budget_lines', filters: { description: 'Other tenant only' } });
    assert.equal(absent.total, 0);
    const legacy = await executor.execute(context, { entity_type: 'budget_lines', filters: { line_description: 'Native description 7102' } });
    assert.equal(legacy.status, 'invalid_filter', 'line_description is no AI field any more');
    assert.deepEqual(legacy.filters_ignored, ['line_description']);

    const detail = await executor.executeDetail(context, { entity_type: 'budget_lines', entity_id: capex.itemId });
    assert.equal(detail.entity.summary, 'Native description 7102');
    assert.equal(detail.entity.metadata?.nature, 'capex');
    assert.equal(detail.data.product_name, 'UniqueTitle7102');
    assert.equal(detail.data.description, 'Native description 7102');
    assert.equal(detail.data.line_description, undefined);

    // The search index keeps two nature types; the AI answer is the one family, with its nature.
    const search = new (AiEntityService as any)({}, {
      listReadableEntityTypes: async (_context: unknown, requested: string[]) => requested,
    });
    const searched = await search.searchAll(context, { query: 'BL-7102', entity_types: ['budget_lines'], limit: 20 });
    assert.equal(searched.total, 1, `search: ${JSON.stringify(searched)}`);
    assert.equal(searched.items[0].type, 'budget_lines');
    assert.equal(searched.items[0].label, 'UniqueTitle7102');
    assert.equal(searched.items[0].metadata?.nature, 'capex');
    // A typed CPX-n is an input reference; the answer names the line by its own BL-n.
    const legacyRef = await search.searchAll(context, { query: 'CPX-21', entity_types: ['budget_lines'], limit: 20 });
    assert.equal(legacyRef.items[0]?.id, capex.itemId);
    assert.equal(legacyRef.items[0]?.ref, 'BL-7102');

    // The CAPEX API alias of the screens is unchanged.
    const alias = await itemService('capex').get(capex.itemId, { manager: runner.manager });
    assert.equal(alias.description, 'UniqueTitle7102');
    assert.ok(!('line_description' in alias), 'the API alias stays unchanged');
  });
}]]).catch((error) => { console.error(error); process.exit(1); });
