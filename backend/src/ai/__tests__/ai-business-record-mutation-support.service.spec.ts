import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { Tenant } from '../../tenants/tenant.entity';
import { Location } from '../../locations/location.entity';
import { AiExecutionContextWithManager } from '../ai.types';
import { AiBusinessRecordMutationSupportService } from '../mutation/ai-business-record-mutation-support.service';

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const APP_ID = '11111111-1111-4111-8111-111111111111';
const SPEND_ID = '22222222-2222-4222-8222-222222222222';

const applicationCategories = [
  { code: 'line_of_business', label: 'Business Applications' },
  { code: 'development', label: 'Development' },
  { code: 'infrastructure', label: 'Infrastructure' },
  { code: 'integration', label: 'Integration' },
  { code: 'productivity', label: 'Productivity' },
  { code: 'security', label: 'Security' },
];

function createHarness() {
  const calls = {
    managerQueries: [] as string[],
  };
  const tenantRepo = {
    findOne: async ({ where }: any) => {
      if (where?.id !== TENANT_ID) return null;
      return {
        id: TENANT_ID,
        metadata: {
          it_ops: {
            application_categories: applicationCategories,
          },
        },
      };
    },
  };
  const locationRepo = {
    find: async () => [],
  };
  const manager = {
    getRepository: (entity: any) => {
      if (entity === Location) return locationRepo;
      if (entity === Tenant) return tenantRepo;
      return tenantRepo;
    },
    query: async (sql: string, params: unknown[]) => {
      calls.managerQueries.push(sql);
      if (sql.includes('FROM spend_items') && String(params[1]).toLowerCase() === 'hosting') {
        return [{
          id: SPEND_ID,
          tenant_id: TENANT_ID,
          nature: 'opex',
          item_number: 42,
          product_name: 'Hosting',
          status: 'enabled',
          disabled_at: null,
        }];
      }
      if (sql.includes('FROM applications') && String(params[1]).toLowerCase() === 'payroll') {
        return [{
          id: APP_ID,
          tenant_id: TENANT_ID,
          sequential_id: 'APP-1',
          name: 'Payroll',
          category: 'productivity',
          status: 'enabled',
        }];
      }
      if (sql.includes('FROM connections') && String(params[1]).toLowerCase() === 'con-1') {
        return [{ id: '33333333-3333-4333-8333-333333333333', connection_reference: 'CON-1', name: 'CON-1 - DB link' }];
      }
      if (sql.includes('FROM interfaces') && String(params[1]).toLowerCase() === 'int-7') {
        return [{ id: '44444444-4444-4444-8444-444444444444', interface_reference: 'INT-7', name: 'INT-7 - Orders' }];
      }
      if (sql.includes('FROM applications') && String(params[1]).toLowerCase() === 'app-36') {
        return [{ id: '55555555-5555-4555-8555-555555555555', sequential_id: 'APP-36', name: 'APP-36 - CheeseTrack' }];
      }
      if (sql.includes('FROM assets') && String(params[1]).toLowerCase() === 'ast-12') {
        return [{ id: '66666666-6666-4666-8666-666666666666', asset_reference: 'AST-12', name: 'AST-12 - srv-cheese-01' }];
      }
      if (sql.includes('FROM portfolio_projects')) {
        return [{ id: '77777777-7777-4777-8777-777777777777', item_number: 2, name: 'PRJ-2 - Affinage' }];
      }
      if (sql.includes('FROM portfolio_requests')) {
        return [{ id: '88888888-8888-4888-8888-888888888888', item_number: 4, name: 'REQ-4 - New cave' }];
      }
      return [];
    },
  };
  const itOpsSettings = new ItOpsSettingsService(tenantRepo as any, locationRepo as any, {} as any);
  const service = new AiBusinessRecordMutationSupportService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    itOpsSettings,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
  const context: AiExecutionContextWithManager = {
    tenantId: TENANT_ID,
    userId: USER_ID,
    isPlatformHost: false,
    surface: 'chat',
    authMethod: 'jwt',
    conversationId: 'conv-1',
    manager: manager as any,
  };
  return { service, context, calls };
}

async function testCreateAcceptsConfiguredCategoryCode() {
  const { service, context } = createHarness();
  const prepared = await service.prepareCreatePreview(context, {
    entity_type: 'applications',
    fields: {
      name: 'Office Suite',
      category: 'productivity',
    },
  });

  assert.equal((prepared.mutationInput.fields as Record<string, unknown>).category, 'productivity');
  assert.equal((prepared.mutationInput.display_values as Record<string, unknown>).category, 'Productivity');
}

async function testCreateResolvesConfiguredCategoryLabel() {
  const { service, context } = createHarness();
  const prepared = await service.prepareCreatePreview(context, {
    entity_type: 'applications',
    fields: {
      name: 'Office Suite',
      category: 'Productivity',
    },
  });

  assert.equal((prepared.mutationInput.fields as Record<string, unknown>).category, 'productivity');
}

async function testUpdateResolvesConfiguredBusinessApplicationsLabel() {
  const { service, context } = createHarness();
  const prepared = await service.prepareUpdatePreview(context, {
    entity_type: 'applications',
    ref: 'Payroll',
    fields: {
      category: 'Business Applications',
    },
  });

  assert.equal(prepared.targetEntityId, APP_ID);
  assert.equal((prepared.mutationInput.fields as Record<string, unknown>).category, 'line_of_business');
  assert.ok(prepared.currentValues, 'an update preview must expose the current values');
  assert.deepEqual(prepared.currentValues.values, {
    category: 'productivity',
  });
}

async function testCreateRejectsCategoryOutsideTenantSettings() {
  const { service, context } = createHarness();
  await assert.rejects(
    () => service.prepareCreatePreview(context, {
      entity_type: 'applications',
      fields: {
        name: 'Legacy Collaboration',
        category: 'other',
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      assert.match(String((error as Error).message), /Invalid application category "other"/);
      assert.match(String((error as Error).message), /line_of_business \(Business Applications\)/);
      assert.match(String((error as Error).message), /productivity \(Productivity\)/);
      return true;
    },
  );
}

async function testCreateDoesNotUseObservedApplicationValuesAsAllowedValues() {
  const { service, context, calls } = createHarness();
  await assert.rejects(
    () => service.prepareCreatePreview(context, {
      entity_type: 'applications',
      fields: {
        name: 'Observed Legacy App',
        category: 'other',
      },
    }),
    BadRequestException,
  );

  assert.equal(calls.managerQueries.length, 0);
}

async function updateHosting(fields: Record<string, unknown>) {
  const { service, context } = createHarness();
  const prepared = await service.prepareUpdatePreview(context, { entity_type: 'budget_lines', ref: 'Hosting', fields });
  return {
    fields: prepared.mutationInput.fields as Record<string, unknown>,
    labels: prepared.mutationInput.field_labels as Record<string, unknown>,
  };
}

async function testEffectiveEndIsAnAliasOfTheEndOfValidity() {
  const legacy = await updateHosting({ effective_end: '2031-06-30' });
  assert.deepEqual(legacy.fields, { disabled_at: '2031-06-30T12:00:00.000Z' }, 'effective_end alone sets the end of validity at noon UTC');
  assert.equal(legacy.labels.disabled_at, 'End of validity');

  const both = await updateHosting({ effective_end: '2031-06-30', disabled_at: '2031-09-30' });
  assert.deepEqual(both.fields, { disabled_at: '2031-09-30T12:00:00.000Z' }, 'a given disabled_at wins over the alias');

  const named = await updateHosting({ end_of_validity: '2031-01-31T21:59:00.000Z' });
  assert.deepEqual(named.fields, { disabled_at: '2031-01-31T21:59:00.000Z' }, 'end_of_validity is accepted, a full timestamp is kept');

  await assert.rejects(
    () => updateHosting({ effective_end: null }),
    /At least one writable field is required/,
    'a blank alias never clears the end of validity',
  );
  await assert.rejects(() => updateHosting({ effective_end: '2031-02-30' }), /End of validity must be a valid date/);
}

async function testRecordLabelNamesTheReferenceOnce() {
  const { service, context } = createHarness();
  // The name already carries its reference: the label does not add it a second time.
  const connection = await service.resolveRecordReference(context, 'connections', 'CON-1');
  assert.equal(connection.ref, 'CON-1');
  assert.equal(connection.label, 'CON-1 - DB link');
  const iface = await service.resolveRecordReference(context, 'interfaces', 'INT-7');
  assert.equal(iface.ref, 'INT-7');
  assert.equal(iface.label, 'INT-7 - Orders');
  const application = await service.resolveRecordReference(context, 'applications', 'APP-36');
  assert.equal(application.ref, 'APP-36');
  assert.equal(application.label, 'APP-36 - CheeseTrack');
  const asset = await service.resolveRecordReference(context, 'assets', 'AST-12');
  assert.equal(asset.ref, 'AST-12');
  assert.equal(asset.label, 'AST-12 - srv-cheese-01');
  const project = await service.resolveRecordReference(context, 'projects', 'PRJ-2');
  assert.equal(project.ref, 'PRJ-2');
  assert.equal(project.label, 'PRJ-2 - Affinage');
  const request = await service.resolveRecordReference(context, 'requests', 'REQ-4');
  assert.equal(request.ref, 'REQ-4');
  assert.equal(request.label, 'REQ-4 - New cave');
  const payroll = await service.resolveRecordReference(context, 'applications', 'Payroll');
  assert.equal(payroll.label, 'APP-1 - Payroll', 'a name that does not start with the reference keeps it once');
  console.log('  reference label: OK');
}

async function testAssetNeedsItsSite() {
  const { service, context } = createHarness();
  const base = { name: 'srv-new', kind: 'vm', provider: 'other', environment: 'prod' };
  for (const location_id of [undefined, null, '']) {
    await assert.rejects(
      () => service.prepareCreatePreview(context, { entity_type: 'assets', fields: { ...base, location_id } }),
      /Location (is required for asset creation|cannot be empty)/,
      `create with location_id ${JSON.stringify(location_id)}`,
    );
  }
  for (const location_id of [null, '']) {
    await assert.rejects(
      () => service.prepareUpdatePreview(context, { entity_type: 'assets', ref: 'AST-12', fields: { location_id } }),
      /Location cannot be empty/,
      `update with location_id ${JSON.stringify(location_id)}`,
    );
  }
  console.log('  asset site required: OK');
}

async function main() {
  await testCreateAcceptsConfiguredCategoryCode();
  await testCreateResolvesConfiguredCategoryLabel();
  await testUpdateResolvesConfiguredBusinessApplicationsLabel();
  await testCreateRejectsCategoryOutsideTenantSettings();
  await testCreateDoesNotUseObservedApplicationValuesAsAllowedValues();
  await testEffectiveEndIsAnAliasOfTheEndOfValidity();
  await testRecordLabelNamesTheReferenceOnce();
  await testAssetNeedsItsSite();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
