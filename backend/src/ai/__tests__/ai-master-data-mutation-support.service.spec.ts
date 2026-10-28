import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { AiMasterDataMutationSupportService } from '../mutation/ai-master-data-mutation-support.service';
import { AiMutationPreview } from '../ai-mutation-preview.entity';
import { AiExecutionContextWithManager } from '../ai.types';

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const CREATED_COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const DEPARTMENT_ID = '66666666-6666-4666-8666-666666666666';
const CREATED_DEPARTMENT_ID = '77777777-7777-4777-8777-777777777777';
const LOCATION_ID = '88888888-8888-4888-8888-888888888888';

function createHarness() {
  const calls: any = {
    companyCreates: [],
    companyUpdates: [],
    companyMetricUpserts: [],
    departmentCreates: [],
    departmentUpdates: [],
    departmentMetricUpserts: [],
  };
  let company = {
    id: COMPANY_ID,
    tenant_id: TENANT_ID,
    name: 'Acme',
    country_iso: 'FR',
    city: 'Paris',
    notes: null,
    status: 'enabled',
    disabled_at: null,
  };
  let createdCompany = {
    id: CREATED_COMPANY_ID,
    tenant_id: TENANT_ID,
    name: 'NewCo',
    country_iso: 'DE',
    city: 'Berlin',
    notes: null,
    status: 'enabled',
    disabled_at: null,
  };
  let companyMetric: any = {
    id: '44444444-4444-4444-8444-444444444444',
    company_id: COMPANY_ID,
    fiscal_year: 2026,
    headcount: 100,
    it_users: 80,
    turnover: '12.345',
  };
  let department = {
    id: DEPARTMENT_ID,
    tenant_id: TENANT_ID,
    company_id: COMPANY_ID,
    company_name: 'Acme',
    name: 'IT',
    description: null,
    status: 'enabled',
    disabled_at: null,
  };
  let createdDepartment = {
    id: CREATED_DEPARTMENT_ID,
    tenant_id: TENANT_ID,
    company_id: COMPANY_ID,
    company_name: 'Acme',
    name: 'Operations',
    description: null,
    status: 'enabled',
    disabled_at: null,
  };
  let departmentMetric: any = {
    id: '88888888-8888-4888-8888-888888888888',
    department_id: DEPARTMENT_ID,
    fiscal_year: 2026,
    headcount: 10,
  };

  const companies = {
    get: async (id: string) => {
      if (id === COMPANY_ID) return { ...company };
      if (id === CREATED_COMPANY_ID) return { ...createdCompany };
      throw new Error('Company not found');
    },
    create: async (body: any, userId: string, opts: any) => {
      calls.companyCreates.push({ body, userId, opts });
      createdCompany = { ...createdCompany, ...body };
      return { ...createdCompany };
    },
    update: async (id: string, body: any, userId: string, opts: any) => {
      calls.companyUpdates.push({ id, body, userId, opts });
      company = { ...company, ...body };
      return { ...company };
    },
  };

  const companyMetrics = {
    getForCompany: async (companyId: string, year: number) => {
      if (companyId === COMPANY_ID && year === 2026 && companyMetric) return { ...companyMetric };
      return null;
    },
    upsertForCompany: async (companyId: string, year: number, body: any, userId: string, opts: any) => {
      calls.companyMetricUpserts.push({ companyId, year, body, userId, opts });
      companyMetric = {
        ...(companyId === COMPANY_ID && year === 2026 && companyMetric ? companyMetric : {}),
        id: companyId === COMPANY_ID ? companyMetric?.id : '55555555-5555-4555-8555-555555555555',
        company_id: companyId,
        fiscal_year: year,
        ...body,
      };
      return { ...companyMetric };
    },
  };

  const departments = {
    get: async (id: string) => {
      if (id === DEPARTMENT_ID) return { ...department };
      if (id === CREATED_DEPARTMENT_ID) return { ...createdDepartment };
      throw new Error('Department not found');
    },
    create: async (body: any, userId: string, opts: any) => {
      calls.departmentCreates.push({ body, userId, opts });
      createdDepartment = { ...createdDepartment, ...body };
      return { ...createdDepartment };
    },
    update: async (id: string, body: any, userId: string, opts: any) => {
      calls.departmentUpdates.push({ id, body, userId, opts });
      department = { ...department, ...body };
      return { ...department };
    },
  };

  const departmentMetrics = {
    getForDepartment: async (departmentId: string, year: number) => {
      if (departmentId === DEPARTMENT_ID && year === 2026 && departmentMetric) return { ...departmentMetric };
      return null;
    },
    upsertForDepartment: async (departmentId: string, year: number, body: any, userId: string, opts: any) => {
      calls.departmentMetricUpserts.push({ departmentId, year, body, userId, opts });
      departmentMetric = {
        ...(departmentId === DEPARTMENT_ID && year === 2026 && departmentMetric ? departmentMetric : {}),
        id: departmentId === DEPARTMENT_ID ? departmentMetric?.id : '99999999-9999-4999-8999-999999999999',
        department_id: departmentId,
        fiscal_year: year,
        ...body,
      };
      return { ...departmentMetric };
    },
  };

  const manager = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM companies') && String(params[1]).toLowerCase() === 'acme') {
        return [{ ...company }];
      }
      if (sql.includes('FROM departments') && String(params[1]).toLowerCase() === 'it') {
        return [{ ...department }];
      }
      if (sql.includes('FROM locations') && String(params[1]).toLowerCase() === 'loc-1') {
        return [{ id: LOCATION_ID, location_reference: 'LOC-1', name: 'LOC-1 - Paris DC', hosting_type: 'cloud' }];
      }
      return [];
    },
  };

  const service = new AiMasterDataMutationSupportService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    companies as any,
    companyMetrics as any,
    {} as any,
    departments as any,
    departmentMetrics as any,
    {} as any,
    {} as any,
    {} as any,
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

function createPreview(overrides: Partial<AiMutationPreview>): AiMutationPreview {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    tenant_id: TENANT_ID,
    conversation_id: 'conv-1',
    user_id: USER_ID,
    tool_name: 'create_master_data_record',
    target_entity_type: 'companies',
    target_entity_id: null,
    mutation_input: {},
    current_values: {},
    status: 'pending',
    approved_at: null,
    rejected_at: null,
    executed_at: null,
    expires_at: new Date('2099-01-01T00:00:00.000Z'),
    error_message: null,
    created_at: new Date('2026-05-03T00:00:00.000Z'),
    ...overrides,
  } as AiMutationPreview;
}

async function testPrepareCreatePreviewNormalizesCompanyFields() {
  const { service, context } = createHarness();
  const prepared = await service.prepareCreatePreview(context, {
    entity_type: 'companies',
    fields: {
      name: ' NewCo ',
      country: 'de',
      city: ' Berlin ',
    },
  });

  assert.equal(prepared.targetEntityType, 'companies');
  assert.equal(prepared.targetEntityId, null);
  assert.deepEqual(prepared.mutationInput.fields, {
    name: 'NewCo',
    country_iso: 'DE',
    city: 'Berlin',
  });

  const presentation = service.presentPreview(createPreview({
    mutation_input: prepared.mutationInput,
    current_values: prepared.currentValues,
  }));
  assert.equal(presentation.summary, 'Create company "NewCo".');
  assert.equal(presentation.changes.country_iso.to, 'DE');
}

async function testExecuteCreateRoutesThroughDomainServiceWithPreviewAudit() {
  const { service, context, calls } = createHarness();
  const preview = createPreview({
    mutation_input: {
      action: 'create',
      entity_type: 'companies',
      fields: { name: 'NewCo', country_iso: 'DE', city: 'Berlin' },
      display_values: { name: 'NewCo', country_iso: 'DE', city: 'Berlin' },
      field_labels: { name: 'Name', country_iso: 'Country', city: 'City' },
    },
    current_values: {
      target_ref: null,
      target_title: 'NewCo',
      values: null,
      display_values: null,
    },
  });

  await service.executePreview(context, preview);

  assert.equal(calls.companyCreates.length, 1);
  assert.equal(calls.companyCreates[0].userId, USER_ID);
  assert.deepEqual(calls.companyCreates[0].opts.audit, {
    source: 'ai_chat',
    sourceRef: preview.id,
  });
  assert.equal(preview.target_entity_id, CREATED_COMPANY_ID);
  assert.equal((preview.current_values as any).target_title, 'NewCo');
}

async function testExecuteCreateCanSeedCompanyMetricsWithPreviewAudit() {
  const { service, context, calls } = createHarness();
  const prepared = await service.prepareCreatePreview(context, {
    entity_type: 'companies',
    fields: {
      name: 'NewCo',
      country_iso: 'DE',
      city: 'Berlin',
      metrics_year: 2026,
      headcount: 25,
      it_users: 20,
      turnover: 1.25,
    },
  });

  assert.deepEqual(prepared.mutationInput.fields, {
    name: 'NewCo',
    country_iso: 'DE',
    city: 'Berlin',
    metrics_year: 2026,
    headcount: 25,
    it_users: 20,
    turnover: 1.25,
  });

  const preview = createPreview({
    mutation_input: prepared.mutationInput,
    current_values: prepared.currentValues,
  });
  await service.executePreview(context, preview);

  assert.equal(calls.companyCreates.length, 1);
  assert.deepEqual(calls.companyCreates[0].body, {
    name: 'NewCo',
    country_iso: 'DE',
    city: 'Berlin',
  });
  assert.equal(calls.companyMetricUpserts.length, 1);
  assert.equal(calls.companyMetricUpserts[0].companyId, CREATED_COMPANY_ID);
  assert.equal(calls.companyMetricUpserts[0].year, 2026);
  assert.deepEqual(calls.companyMetricUpserts[0].body, {
    headcount: 25,
    it_users: 20,
    turnover: 1.25,
  });
  assert.deepEqual(calls.companyMetricUpserts[0].opts.audit, {
    source: 'ai_chat',
    sourceRef: preview.id,
  });
}

async function testPrepareAndExecuteUpdatePreview() {
  const { service, context, calls } = createHarness();
  const prepared = await service.prepareUpdatePreview(context, {
    entity_type: 'companies',
    ref: COMPANY_ID,
    fields: { city: 'Lyon' },
  });

  assert.equal(prepared.targetEntityId, COMPANY_ID);
  assert.deepEqual(prepared.currentValues?.values, { city: 'Paris' });
  assert.deepEqual(prepared.mutationInput.fields, { city: 'Lyon' });

  const preview = createPreview({
    tool_name: 'update_master_data_record',
    target_entity_id: COMPANY_ID,
    mutation_input: prepared.mutationInput,
    current_values: prepared.currentValues,
  });
  await service.executePreview(context, preview);

  assert.equal(calls.companyUpdates.length, 1);
  assert.equal(calls.companyUpdates[0].id, COMPANY_ID);
  assert.deepEqual(calls.companyUpdates[0].body, { city: 'Lyon' });
  assert.deepEqual(calls.companyUpdates[0].opts.audit, {
    source: 'ai_chat',
    sourceRef: preview.id,
  });
}

async function testPrepareExecuteAndReverseCompanyMetricUpdate() {
  const { service, context, calls } = createHarness();
  const prepared = await service.prepareUpdatePreview(context, {
    entity_type: 'companies',
    ref: COMPANY_ID,
    fields: {
      metrics_year: 2026,
      headcount: 120,
      turnover: 15.5,
    },
  });

  assert.equal(prepared.targetEntityId, COMPANY_ID);
  assert.deepEqual(prepared.currentValues?.values, {
    headcount: 100,
    turnover: 12.345,
  });
  assert.equal((prepared.currentValues as any).metric_year, 2026);
  assert.deepEqual(prepared.mutationInput.fields, {
    headcount: 120,
    turnover: 15.5,
  });
  assert.equal((prepared.mutationInput as any).metric_year, 2026);

  const preview = createPreview({
    tool_name: 'update_master_data_record',
    target_entity_id: COMPANY_ID,
    mutation_input: prepared.mutationInput,
    current_values: prepared.currentValues,
  });
  await service.executePreview(context, preview);

  assert.equal(calls.companyUpdates.length, 0);
  assert.equal(calls.companyMetricUpserts.length, 1);
  assert.deepEqual(calls.companyMetricUpserts[0].body, {
    headcount: 120,
    it_users: 80,
    turnover: 15.5,
  });
  assert.deepEqual(calls.companyMetricUpserts[0].opts.audit, {
    source: 'ai_chat',
    sourceRef: preview.id,
  });

  const reversal = await service.prepareReverseUpdatePreview(context, {
    ...preview,
    status: 'executed',
  });
  assert.deepEqual(reversal.mutationInput.fields, {
    headcount: 100,
    turnover: 12.345,
  });
  assert.equal((reversal.mutationInput as any).metric_year, 2026);
}

async function testUpdatePreviewRejectsNoOp() {
  const { service, context } = createHarness();
  await assert.rejects(
    () => service.prepareUpdatePreview(context, {
      entity_type: 'companies',
      ref: COMPANY_ID,
      fields: { city: 'Paris' },
    }),
    BadRequestException,
  );
}

async function testCompanyMetricUpdateRequiresExistingMetricRow() {
  const { service, context } = createHarness();
  await assert.rejects(
    () => service.prepareUpdatePreview(context, {
      entity_type: 'companies',
      ref: COMPANY_ID,
      fields: {
        metrics_year: 2025,
        headcount: 120,
      },
    }),
    BadRequestException,
  );
}

async function testDepartmentCreateResolvesCompanyName() {
  const { service, context } = createHarness();
  const prepared = await service.prepareCreatePreview(context, {
    entity_type: 'departments',
    fields: {
      company: 'Acme',
      name: 'IT',
    },
  });

  assert.equal((prepared.mutationInput.fields as any).company_id, COMPANY_ID);
  assert.equal((prepared.mutationInput.display_values as any).company_id, 'Acme');
}

async function testExecuteCreateCanSeedDepartmentMetricsWithPreviewAudit() {
  const { service, context, calls } = createHarness();
  const prepared = await service.prepareCreatePreview(context, {
    entity_type: 'departments',
    fields: {
      company: 'Acme',
      name: 'Operations',
      metrics_year: 2026,
      headcount: 15,
    },
  });

  assert.deepEqual(prepared.mutationInput.fields, {
    company_id: COMPANY_ID,
    name: 'Operations',
    metrics_year: 2026,
    headcount: 15,
  });

  const preview = createPreview({
    target_entity_type: 'departments',
    mutation_input: prepared.mutationInput,
    current_values: prepared.currentValues,
  });
  await service.executePreview(context, preview);

  assert.equal(calls.departmentCreates.length, 1);
  assert.deepEqual(calls.departmentCreates[0].body, {
    company_id: COMPANY_ID,
    name: 'Operations',
  });
  assert.equal(calls.departmentMetricUpserts.length, 1);
  assert.equal(calls.departmentMetricUpserts[0].departmentId, CREATED_DEPARTMENT_ID);
  assert.equal(calls.departmentMetricUpserts[0].year, 2026);
  assert.deepEqual(calls.departmentMetricUpserts[0].body, {
    headcount: 15,
  });
  assert.deepEqual(calls.departmentMetricUpserts[0].opts.audit, {
    source: 'ai_chat',
    sourceRef: preview.id,
  });
}

async function testPrepareExecuteAndReverseDepartmentMetricUpdate() {
  const { service, context, calls } = createHarness();
  const prepared = await service.prepareUpdatePreview(context, {
    entity_type: 'departments',
    ref: DEPARTMENT_ID,
    fields: {
      metrics_year: 2026,
      headcount: 18,
    },
  });

  assert.equal(prepared.targetEntityId, DEPARTMENT_ID);
  assert.deepEqual(prepared.currentValues?.values, {
    headcount: 10,
  });
  assert.equal((prepared.currentValues as any).metric_year, 2026);
  assert.deepEqual(prepared.mutationInput.fields, {
    headcount: 18,
  });
  assert.equal((prepared.mutationInput as any).metric_year, 2026);

  const preview = createPreview({
    tool_name: 'update_master_data_record',
    target_entity_type: 'departments',
    target_entity_id: DEPARTMENT_ID,
    mutation_input: prepared.mutationInput,
    current_values: prepared.currentValues,
  });
  await service.executePreview(context, preview);

  assert.equal(calls.departmentUpdates.length, 0);
  assert.equal(calls.departmentMetricUpserts.length, 1);
  assert.deepEqual(calls.departmentMetricUpserts[0].body, {
    headcount: 18,
  });
  assert.deepEqual(calls.departmentMetricUpserts[0].opts.audit, {
    source: 'ai_chat',
    sourceRef: preview.id,
  });

  const reversal = await service.prepareReverseUpdatePreview(context, {
    ...preview,
    status: 'executed',
  });
  assert.deepEqual(reversal.mutationInput.fields, {
    headcount: 10,
  });
  assert.equal((reversal.mutationInput as any).metric_year, 2026);
}

async function testDepartmentMetricUpdateRequiresExistingMetricRow() {
  const { service, context } = createHarness();
  await assert.rejects(
    () => service.prepareUpdatePreview(context, {
      entity_type: 'departments',
      ref: DEPARTMENT_ID,
      fields: {
        metrics_year: 2025,
        headcount: 18,
      },
    }),
    BadRequestException,
  );
}

async function testLocationLabelNamesTheReferenceOnce() {
  const { service, context } = createHarness();
  // The location name already carries its reference: the label does not add it a second time.
  const found = await service.resolveRecordReference(context, 'locations', 'LOC-1');
  assert.equal(found.ref, 'LOC-1');
  assert.equal(found.label, 'LOC-1 - Paris DC');
  console.log('  location reference label: OK');
}

async function main() {
  await testLocationLabelNamesTheReferenceOnce();
  await testPrepareCreatePreviewNormalizesCompanyFields();
  await testExecuteCreateRoutesThroughDomainServiceWithPreviewAudit();
  await testExecuteCreateCanSeedCompanyMetricsWithPreviewAudit();
  await testPrepareAndExecuteUpdatePreview();
  await testPrepareExecuteAndReverseCompanyMetricUpdate();
  await testUpdatePreviewRejectsNoOp();
  await testCompanyMetricUpdateRequiresExistingMetricRow();
  await testDepartmentCreateResolvesCompanyName();
  await testExecuteCreateCanSeedDepartmentMetricsWithPreviewAudit();
  await testPrepareExecuteAndReverseDepartmentMetricUpdate();
  await testDepartmentMetricUpdateRequiresExistingMetricRow();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
